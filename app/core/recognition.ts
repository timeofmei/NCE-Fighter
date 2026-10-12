import { validateRecognition } from "./training-validation";
import type { Event, InputKind, Recognition } from "./training";

export interface RecognitionAdapter {
  recognize(
    input: {
      sourceRef: string;
      languageId: string;
      inputKind: Exclude<InputKind, "keyboard">;
      taskId: string;
    },
    signal: AbortSignal,
  ): Promise<Recognition>;
}

export async function recognizeInput(
  adapter: RecognitionAdapter,
  input: Parameters<RecognitionAdapter["recognize"]>[0],
  signal: AbortSignal,
): Promise<{ event: Event; error?: string }> {
  try {
    if (signal.aborted) throw new Error("CANCELLED");
    const recognition = await adapter.recognize(input, signal);
    if (signal.aborted) throw new Error("CANCELLED");
    validateRecognition(recognition, input.languageId);
    if (recognition.sourceRef !== input.sourceRef || recognition.wasEdited)
      throw new Error("RECOGNITION_FAILED");
    return { event: { kind: "recognized", taskId: input.taskId, recognition } };
  } catch (error) {
    return {
      event: { kind: "recognition-failed", taskId: input.taskId },
      error: signal.aborted
        ? "CANCELLED"
        : `RECOGNITION_FAILED: ${error instanceof Error ? error.message : "识别失败"}`,
    };
  }
}
