import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
const browserServer = await chromium.launchServer();
const browser = await chromium.connect(browserServer.wsEndpoint());
let peakWorkingSetBytes = 0,
  sampling = true;
const run = promisify(execFile),
  browserPid = browserServer.process().pid;
const sampler = (async () => {
  while (sampling) {
    if (process.platform === "win32") {
      const command = `$taskBrowserProcesses=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize; $taskBrowserIds=[System.Collections.Generic.HashSet[uint32]]::new(); [void]$taskBrowserIds.Add(${browserPid}); do { $taskBrowserAdded=$false; foreach($taskBrowserProcess in $taskBrowserProcesses){ if($taskBrowserIds.Contains($taskBrowserProcess.ParentProcessId) -and $taskBrowserIds.Add($taskBrowserProcess.ProcessId)){ $taskBrowserAdded=$true } } } while($taskBrowserAdded); ($taskBrowserProcesses | Where-Object { $taskBrowserIds.Contains($_.ProcessId) } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
      const { stdout } = await run(
        "powershell",
        ["-NoProfile", "-Command", command],
        { windowsHide: true },
      );
      peakWorkingSetBytes = Math.max(
        peakWorkingSetBytes,
        Number(stdout.trim()) || 0,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
})();
const page = await browser.newPage();
await page.goto(`${process.argv[2] ?? "http://127.0.0.1:5180"}/library`);
await page.getByRole("heading", { name: "课文库", exact: true }).waitFor();
const results = [];
for (const name of [
  "text.pdf",
  "scan.pdf",
  "stress.pdf",
  "printed-cover.jpg",
  "handwriting.jpg",
]) {
  const bytes = (await readFile(`tests/fixtures/documents/${name}`)).toString(
    "base64",
  );
  results.push(
    await page.evaluate(
      async ({ name, bytes }) => {
        const { LocalDocument, lineRegions, cropRegion } =
          await import("/app/adapters/document.ts");
        const { downloadResources } =
          await import("/app/adapters/resources.ts");
        const { LocalOcr } = await import("/app/adapters/ocr.ts");
        const abort = new AbortController(),
          started = performance.now();
        const file = new File(
          [Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))],
          name,
          { type: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" },
        );
        const doc = new LocalDocument([file], "en");
        await doc.read(abort.signal, () => {});
        const readMs = performance.now() - started;
        await downloadResources(abort.signal, () => {});
        const engine = new LocalOcr(abort.signal);
        const device = await engine.initialize();
        let maximumBufferBytes = 0,
          inferenceMs = 0;
        const pages = [];
        const processStart = performance.now();
        try {
          for (let i = 0; i < doc.pages.length; i++) {
            const page = doc.pages[i];
            const start = performance.now();
            let text = page.text;
            if (page.mode === "ocr") {
              const canvas = await doc.render(i);
              maximumBufferBytes = Math.max(
                maximumBufferBytes,
                canvas.width * canvas.height * 4,
              );
              const image = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height);
              const rectangles =
                name === "handwriting.jpg"
                  ? [{ x: 0.38, y: 0.115, width: 0.48, height: 0.05 }]
                  : name === "printed-cover.jpg"
                    ? [{ x: 0.05, y: 0.08, width: 0.52, height: 0.1 }]
                    : lineRegions(image);
              const output = [];
              for (const rect of rectangles) {
                const result = await engine.line(cropRegion(canvas, rect));
                output.push(result.text);
                inferenceMs += result.inferenceMs;
              }
              text = output.join("\n");
              canvas.width = canvas.height = 1;
            }
            pages.push({
              page: i + 1,
              ms: performance.now() - start,
              ...(i < 2 ? { text } : {}),
            });
          }
          return {
            name,
            readMs,
            device,
            pages,
            totalMs: performance.now() - processStart,
            inferenceMs,
            maximumBufferBytes,
          };
        } finally {
          engine.close();
          doc.close();
        }
      },
      { name, bytes },
    ),
  );
}
sampling = false;
await sampler;
console.log(
  JSON.stringify(
    {
      environment: {
        os: os.release(),
        cpu: os.cpus()[0].model,
        ramBytes: os.totalmem(),
      },
      peakWorkingSetBytes,
      results,
    },
    null,
    2,
  ),
);
await browser.close();
await browserServer.close();
