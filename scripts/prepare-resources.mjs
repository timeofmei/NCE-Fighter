import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "yaml";

// Browser resources are always served by this site; never resolve a remote URL at runtime.
await mkdir("public/resources", { recursive: true });
await copyFile(
  "public/models/ONNX-Runtime-LICENSE",
  "public/resources/ONNX-Runtime-LICENSE",
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(
    `node_modules/pdfjs-dist/${directory}`,
    `public/resources/pdf/${directory}`,
    { recursive: true },
  );
await copyFile(
  "node_modules/pdfjs-dist/LICENSE",
  "public/resources/pdf/LICENSE",
);
const files = [
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];
const resources = [];
for (const name of files) {
  await copyFile(
    `node_modules/onnxruntime-web/dist/${name}`,
    `public/resources/${name}`,
  );
  resources.push(`/resources/${name}`);
}
resources.push(
  "/models/ppocr-tiny/inference.onnx",
  "/models/ppocr-tiny/dictionary.json",
);
const manifest = [];
for (const path of resources) {
  const bytes = await readFile(`public${path}`);
  manifest.push({
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
const previousManifest = await readFile(
  "app/adapters/ocr-manifest.json",
  "utf8",
).catch(() => undefined);
if (previousManifest !== manifestText)
  await writeFile("app/adapters/ocr-manifest.json", manifestText);
// Config is retained alongside the weight to audit the exact decoder and input shape.
const config = parse(
  await readFile("public/models/ppocr-tiny/inference.yml", "utf8"),
);
if (
  config.PostProcess.name !== "CTCLabelDecode" ||
  config.PreProcess.transform_ops[0].DecodeImage.img_mode !== "BGR"
)
  throw new Error("Unsupported OCR configuration");
console.log(
  `Prepared ${manifest.reduce((sum, r) => sum + r.bytes, 0)} bytes of local OCR resources`,
);
