import manifest from "./ocr-manifest.json";
export const OCR_NAME = "PP-OCRv6 tiny · 英语印刷体";
export const RESOURCE_CACHE = "nce-fighter-ocr-ort-1.30.0-ppocr-2612ab37";
export const sha256 = async (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export async function cachedResource(
  path: string,
): Promise<ArrayBuffer | undefined> {
  const resource = manifest.find((r) => r.path === path);
  if (!resource) throw new Error("资源路径未批准。");
  const cache = await caches.open(RESOURCE_CACHE);
  const response = await cache.match(path);
  if (!response) return;
  const bytes = await response.arrayBuffer();
  if (
    bytes.byteLength !== resource.bytes ||
    (await sha256(bytes)) !== resource.sha256
  ) {
    await cache.delete(path);
    return;
  }
  return bytes;
}
export async function missingResources() {
  const missing = [];
  for (const r of manifest)
    if (!(await cachedResource(r.path))) missing.push(r);
  return missing;
}
export async function downloadResources(
  signal: AbortSignal,
  progress: (bytes: number, total: number) => void,
) {
  const missing = await missingResources(),
    total = missing.reduce((n, r) => n + r.bytes, 0);
  let loaded = 0;
  const cache = await caches.open(RESOURCE_CACHE);
  for (const r of missing) {
    signal.throwIfAborted();
    const response = await fetch(r.path, {
      signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new Error("资源下载失败，请重试。");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > r.bytes) {
        await reader.cancel();
        throw new Error("资源大小不匹配。");
      }
      chunks.push(part.value);
      progress(loaded + size, total);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (size !== r.bytes || (await sha256(buffer.buffer)) !== r.sha256)
      throw new Error("资源校验失败，请重试。");
    signal.throwIfAborted();
    await cache.put(
      r.path,
      new Response(buffer, {
        headers: {
          "Content-Type": r.path.endsWith(".mjs")
            ? "text/javascript"
            : "application/octet-stream",
        },
      }),
    );
    loaded += size;
  }
}
export async function clearResources() {
  // All versions of model caches are removable without touching IndexedDB.
  for (const key of await caches.keys())
    if (key.startsWith("nce-fighter-ocr-")) await caches.delete(key);
  localStorage.removeItem("nce-fighter-ocr-device");
}
export { manifest as ocrResources };
