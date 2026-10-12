import { cachedResource, ocrResources } from "./resources";
export interface DeviceResult {
  backend: string;
  initializedMs: number;
  warmupMs: number;
  testedAt: string;
  environment: string;
  model: string;
}
export class LocalOcr {
  private worker = new Worker(new URL("./ocr.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(private signal: AbortSignal) {
    signal.addEventListener("abort", () => this.close(), { once: true });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = () => this.close();
  }
  private call<T>(kind: string, data = {}): Promise<T> {
    this.signal.throwIfAborted();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ id, kind, ...data });
    });
  }
  async initialize(): Promise<DeviceResult> {
    const resources: Record<string, ArrayBuffer> = {};
    for (const r of ocrResources) {
      const bytes = await cachedResource(r.path);
      if (!bytes) throw new Error("OCR 资源缺失或损坏，请重新下载。");
      resources[r.path] = bytes;
    }
    const result = await this.call<
      Omit<DeviceResult, "testedAt" | "environment" | "model">
    >("init", { resources });
    const device = {
      ...result,
      testedAt: new Date().toISOString(),
      environment: navigator.userAgent,
      model: "ppocr-2612ab37-ort-1.30.0-fp32",
    };
    localStorage.setItem("nce-fighter-ocr-device", JSON.stringify(device));
    return device;
  }
  line(image: ImageData) {
    return this.call<{ text: string; inferenceMs: number }>("line", {
      rgba: image.data,
      width: image.width,
      height: image.height,
    });
  }
  close() {
    this.worker.terminate();
    for (const p of this.pending.values())
      p.reject(new Error("OCR 已停止，请重试。"));
    this.pending.clear();
  }
}
