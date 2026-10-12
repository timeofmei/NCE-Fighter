import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type { FileBatch, Source, TextBlock } from "../core/document";
import { sha256 } from "./resources";
export interface DocumentPage {
  source: Source;
  text: string;
  mode: "text" | "ocr";
  regions: Source["rect"][];
}
export class LocalDocument {
  batch: FileBatch;
  pages: DocumentPage[] = [];
  private pdf?: PDFDocumentProxy;
  private task?: PDFDocumentLoadingTask;
  private destroyed = false;
  constructor(
    private files: File[],
    languageId: string,
  ) {
    this.batch = {
      id: crypto.randomUUID(),
      languageId,
      createdAt: new Date().toISOString(),
      files: [],
      sources: [],
    };
  }
  async read(signal: AbortSignal, progress: (message: string) => void) {
    if (!this.files.length) throw new Error("请选择 PDF 或图片。");
    const isPdf =
      this.files[0].type === "application/pdf" ||
      /\.pdf$/i.test(this.files[0].name);
    if (isPdf && this.files.length !== 1)
      throw new Error("每批只能选择一个 PDF。");
    if (
      !isPdf &&
      this.files.some((f) => !/^image\/(png|jpeg|webp)$/.test(f.type))
    )
      throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
    signal.addEventListener("abort", () => this.close(), { once: true });
    for (const file of this.files) {
      signal.throwIfAborted();
      progress(`读取 ${file.name}`);
      const bytes = await file.arrayBuffer();
      signal.throwIfAborted();
      this.batch.files.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        sha256: await sha256(bytes),
        kind: isPdf ? "pdf" : "image",
      });
      if (isPdf) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href;
        const task = pdfjs.getDocument({
          data: bytes,
          useSystemFonts: true,
          cMapUrl: "/resources/pdf/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/resources/pdf/standard_fonts/",
          wasmUrl: "/resources/pdf/wasm/",
          iccUrl: "/resources/pdf/iccs/",
          verbosity: 0,
        });
        this.task = task;
        const abort = () => {
          void task.destroy();
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          this.pdf = await task.promise;
        } catch {
          throw new Error("PDF 无法读取；请检查文件是否损坏、加密或不受支持。");
        }
        for (let page = 1; page <= this.pdf.numPages; page++) {
          signal.throwIfAborted();
          progress(`读取第 ${page} / ${this.pdf.numPages} 页`);
          const pdfPage = await this.pdf.getPage(page);
          const content = await pdfPage.getTextContent();
          const items = content.items.filter((i): i is TextItem => "str" in i);
          const text = readPdfText(
            items,
            pdfPage.getViewport({ scale: 1 }).width,
          );
          this.addPage(this.batch.files[0].id, page, text);
          pdfPage.cleanup();
        }
      } else {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        this.addPage(this.batch.files.at(-1)!.id, 1, "");
      }
    }
    signal.throwIfAborted();
  }
  private addPage(fileId: string, page: number, text: string) {
    const source: Source = {
      id: crypto.randomUUID(),
      fileId,
      page,
      order: this.pages.length,
      rotation: 0,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    };
    this.batch.sources.push(source);
    this.pages.push({
      source,
      text,
      mode: text.trim() ? "text" : "ocr",
      regions: [],
    });
  }
  async render(index: number): Promise<HTMLCanvasElement> {
    if (this.destroyed) throw new Error("原文件已释放，请重新选择。");
    const item = this.pages[index],
      canvas = document.createElement("canvas");
    if (this.pdf) {
      const page = await this.pdf.getPage(item.source.page);
      const viewport = page.getViewport({
        scale: 2,
        rotation: item.source.rotation,
      });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
    } else {
      const bitmap = await createImageBitmap(
        this.files[
          this.batch.files.findIndex((f) => f.id === item.source.fileId)
        ],
      );
      try {
        const swap = item.source.rotation % 180 !== 0;
        canvas.width = swap ? bitmap.height : bitmap.width;
        canvas.height = swap ? bitmap.width : bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((item.source.rotation * Math.PI) / 180);
        ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      } finally {
        bitmap.close();
      }
    }
    if (this.destroyed) {
      canvas.width = 1;
      throw new Error("原文件已释放。");
    }
    return canvas;
  }
  async matches(batch: FileBatch) {
    return (
      batch.files.length === this.batch.files.length &&
      batch.files.every(
        (f, i) =>
          f.sha256 === this.batch.files[i].sha256 &&
          f.size === this.batch.files[i].size,
      )
    );
  }
  close() {
    this.destroyed = true;
    void this.task?.destroy();
    this.pdf = undefined;
    this.files = [];
  }
}

export function readPdfText(
  items: Pick<TextItem, "str" | "transform" | "width" | "height">[],
  pageWidth: number,
) {
  const rows: {
    y: number;
    x: number;
    end: number;
    height: number;
    text: string;
  }[] = [];
  const sorted = items
    .filter((i) => i.str.trim())
    .sort(
      (a, b) =>
        b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
    );
  for (const item of sorted) {
    const [x, y] = [item.transform[4], item.transform[5]];
    const previous = [...rows]
      .reverse()
      .find(
        (r) =>
          Math.abs(r.y - y) < Math.max(2, item.height * 0.35) &&
          x >= r.x &&
          x - r.end < pageWidth * 0.12,
      );
    if (previous) {
      previous.text += `${x - previous.end > 1 ? " " : ""}${item.str}`;
      previous.end = x + item.width;
    } else
      rows.push({
        x,
        y,
        end: x + item.width,
        height: item.height,
        text: item.str,
      });
  }
  // A vertical gutter separates columns; spanning headings are read before columns.
  const left = rows.filter((r) => r.end < pageWidth * 0.52),
    right = rows.filter((r) => r.x > pageWidth * 0.48);
  if (left.length > 1 && right.length > 1) {
    const other = rows.filter((r) => !left.includes(r) && !right.includes(r));
    return [
      ...other.sort((a, b) => b.y - a.y),
      ...left.sort((a, b) => b.y - a.y),
      ...right.sort((a, b) => b.y - a.y),
    ]
      .map((r) => r.text)
      .join("\n");
  }
  return rows
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((r) => r.text)
    .join("\n");
}

// Horizontal projection only: no neural detection model. Regions are editable when
// projection is unsuitable for skewed text or complex layouts.
export function lineRegions(image: ImageData): Source["rect"][] {
  const { width, height, data } = image,
    occupied: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (data[p] + data[p + 1] + data[p + 2] < 450 && data[p + 3] > 128)
        dark++;
    }
    occupied.push(dark > Math.max(2, width * 0.002));
  }
  const regions: Source["rect"][] = [];
  let start = -1,
    last = -1;
  for (let y = 0; y <= height + 2; y++) {
    if (occupied[y]) {
      if (start < 0) start = y;
      last = y;
    } else if (start >= 0 && y - last > 2) {
      if (last - start >= 2) {
        let min = width,
          max = 0;
        for (let row = start; row <= last; row++)
          for (let x = 0; x < width; x++) {
            const p = (row * width + x) * 4;
            if (data[p] + data[p + 1] + data[p + 2] < 450) {
              min = Math.min(min, x);
              max = Math.max(max, x);
            }
          }
        const top = Math.max(0, start - 3),
          bottom = Math.min(height, last + 4),
          left = Math.max(0, min - 4),
          right = Math.min(width, max + 5);
        regions.push({
          x: left / width,
          y: top / height,
          width: (right - left) / width,
          height: (bottom - top) / height,
        });
      }
      start = -1;
    }
  }
  return regions;
}
export function cropRegion(
  canvas: HTMLCanvasElement,
  rect: Source["rect"],
): ImageData {
  const x = Math.floor(rect.x * canvas.width),
    y = Math.floor(rect.y * canvas.height);
  return canvas
    .getContext("2d")!
    .getImageData(
      x,
      y,
      Math.min(
        canvas.width - x,
        Math.max(1, Math.round(rect.width * canvas.width)),
      ),
      Math.min(
        canvas.height - y,
        Math.max(1, Math.round(rect.height * canvas.height)),
      ),
    );
}
export type PageOutcome = {
  blocks: TextBlock[];
  regions?: { key: string; text?: string; sourceRef: string; error?: string }[];
  status: "success" | "failed" | "skipped";
  error?: string;
};
