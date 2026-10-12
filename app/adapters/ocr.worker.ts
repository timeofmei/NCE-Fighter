/// <reference lib="webworker" />
import type * as Ort from "onnxruntime-web";
let ort: typeof Ort, session: Ort.InferenceSession, dictionary: string[];
const urls: string[] = [];
const blobUrl = (bytes: ArrayBuffer, type: string) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  urls.push(url);
  return url;
};
self.onmessage = async (event: MessageEvent) => {
  const { id, kind } = event.data;
  try {
    if (kind === "init") {
      const started = performance.now();
      const { resources } = event.data as {
        resources: Record<string, ArrayBuffer>;
      };
      const runtimeUrl = blobUrl(
        resources["/resources/ort.wasm.min.mjs"],
        "text/javascript",
      );
      ort = await import(/* @vite-ignore */ runtimeUrl);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = {
        mjs: blobUrl(
          resources["/resources/ort-wasm-simd-threaded.mjs"],
          "text/javascript",
        ),
        wasm: blobUrl(
          resources["/resources/ort-wasm-simd-threaded.wasm"],
          "application/wasm",
        ),
      };
      dictionary = JSON.parse(
        new TextDecoder().decode(
          resources["/models/ppocr-tiny/dictionary.json"],
        ),
      );
      session = await ort.InferenceSession.create(
        resources["/models/ppocr-tiny/inference.onnx"],
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      );
      const initializedMs = performance.now() - started;
      const warm = performance.now();
      const input = new ort.Tensor(
        "float32",
        new Float32Array(3 * 48 * 320),
        [1, 3, 48, 320],
      );
      const output = await session
        .run({ [session.inputNames[0]]: input })
        .finally(() => input.dispose());
      const result = output[session.outputNames[0]];
      if (result.dims.length !== 3 || result.dims[2] !== dictionary.length)
        throw new Error("模型输出与词表不匹配。");
      Object.values(output).forEach((t) => t.dispose());
      self.postMessage({
        id,
        result: {
          backend: "wasm",
          initializedMs,
          warmupMs: performance.now() - warm,
        },
      });
    } else if (kind === "line") {
      const { rgba, width, height } = event.data as {
        rgba: Uint8ClampedArray;
        width: number;
        height: number;
      };
      const canvas = new OffscreenCanvas(width, height);
      canvas
        .getContext("2d")!
        .putImageData(
          new ImageData(new Uint8ClampedArray(rgba), width, height),
          0,
          0,
        );
      const resizedWidth = Math.max(1, Math.ceil((48 * width) / height));
      if (resizedWidth > 3200) throw new Error("文字行过长，请拆分区域。");
      const targetWidth = Math.max(320, resizedWidth);
      const target = new OffscreenCanvas(targetWidth, 48),
        ctx = target.getContext("2d")!;
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, targetWidth, 48);
      ctx.drawImage(canvas, 0, 0, resizedWidth, 48);
      const pixels = ctx.getImageData(0, 0, targetWidth, 48).data;
      const data = new Float32Array(3 * 48 * targetWidth),
        area = 48 * targetWidth;
      // Official DecodeImage uses BGR; normalization is (pixel / 255 - .5) / .5.
      for (let c = 0; c < 3; c++)
        for (let p = 0; p < area; p++)
          data[c * area + p] = pixels[p * 4 + (2 - c)] / 127.5 - 1;
      const input = new ort.Tensor("float32", data, [1, 3, 48, targetWidth]);
      const started = performance.now();
      const output = await session
        .run({ [session.inputNames[0]]: input })
        .finally(() => input.dispose());
      const result = output[session.outputNames[0]],
        scores = result.data as Float32Array;
      const classes = result.dims[2];
      let previous = -1,
        text = "";
      for (let step = 0; step < result.dims[1]; step++) {
        let best = 0;
        for (let c = 1; c < classes; c++)
          if (scores[step * classes + c] > scores[step * classes + best])
            best = c;
        if (best && best !== previous) text += dictionary[best];
        previous = best;
      }
      Object.values(output).forEach((t) => t.dispose());
      canvas.width = target.width = 1;
      self.postMessage({
        id,
        result: { text, inferenceMs: performance.now() - started },
      });
    } else if (kind === "close") {
      await session?.release();
      urls.forEach((url) => URL.revokeObjectURL(url));
      self.close();
    }
  } catch {
    // Never return or log input pixels, model outputs or user text in an error.
    self.postMessage({
      id,
      error:
        kind === "init"
          ? "本地 OCR 初始化或预热失败，请重新检测。"
          : "文字行识别失败，请调整区域后重试。",
    });
  }
};
