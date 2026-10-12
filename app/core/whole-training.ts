import { points, type Lesson } from "./lesson";
import type { TrainingLanguage } from "./comparison";
import type { Event, Session } from "./training";

export function reduceWhole(
  state: Session,
  event: Event,
  lesson: Lesson,
  module: TrainingLanguage,
  now: string,
): Session {
  const next = { ...state, version: state.version + 1, updatedAt: now };
  const retryStage = state.inputKind === "speech" ? "ready" : "collecting";
  if (event.kind === "record") {
    if (state.status !== "ready" || state.mode !== "recitation")
      throw new Error("不能开始录音。");
    next.status = "recording";
  } else if (event.kind === "recognize") {
    if (!["recording", "collecting"].includes(state.status) || !event.taskId)
      throw new Error("不能开始识别。");
    next.status = "recognizing";
    next.taskId = event.taskId;
  } else if (
    event.kind === "recognized" ||
    event.kind === "recognition-failed"
  ) {
    if (state.status !== "recognizing" || state.taskId !== event.taskId)
      return state;
    next.taskId = null;
    if (event.kind === "recognition-failed") next.status = retryStage;
    else {
      const r = event.recognition;
      if (
        r.languageId !== state.languageId ||
        r.wasEdited ||
        r.editedTranscript !== r.rawTranscript
      )
        throw new Error("识别语言或文本不一致。");
      next.recognition = structuredClone(r);
      next.input = r.rawTranscript;
      next.status = "confirming";
    }
  } else if (event.kind === "cancel-recognition") {
    if (!["recording", "recognizing", "confirming"].includes(state.status))
      throw new Error("没有可取消的识别任务。");
    next.taskId = null;
    next.status = retryStage;
  } else if (event.kind === "confirm-text") {
    if (state.status !== "confirming" || !state.recognition)
      throw new Error("请先识别并确认文本。");
    next.input = event.text;
    next.recognition = {
      ...state.recognition,
      editedTranscript: event.text,
      wasEdited: event.text !== state.recognition.rawTranscript,
    };
  } else if (event.kind === "input" || event.kind === "save-draft") {
    if (state.inputKind !== "keyboard" || state.status !== "answering")
      throw new Error("本次作答已提交或不支持键盘输入。");
    if (points(event.text).length > 20_000)
      throw new Error("输入超过 20,000 个字符，请缩短后重试。");
    next.input = event.text;
  } else if (event.kind === "submit") {
    if (
      state.status !==
      (state.inputKind === "keyboard" ? "answering" : "confirming")
    )
      throw new Error("请先确认输入，或本次作答已提交。");
    const input =
      state.inputKind === "keyboard"
        ? (event.text ?? state.input)
        : state.input;
    if (points(input).length > 20_000)
      throw new Error("输入超过 20,000 个字符，请缩短后重试。");
    const actual = module.prepare(input, [
      { id: "input", order: 0, start: 0, end: points(input).length },
    ]);
    if (!actual.units.length) throw new Error("请输入有效文字或数字后提交。");
    const result = module.comparePrepared(
      module.prepare(lesson.body, lesson.sentences),
      actual,
    );
    next.input = input;
    next.attempts = [
      {
        id: event.attemptId,
        requestId: event.requestId,
        sentenceId: null,
        rawText: state.recognition?.rawTranscript ?? input,
        confirmedText: input,
        hintUsed: false,
        answerSeenBeforeAttempt: false,
        status: "checked",
        inputKind: state.inputKind,
        recognition: state.recognition
          ? structuredClone(state.recognition)
          : null,
        createdAt: now,
        result,
      },
    ];
    next.status = "completed";
    next.completedAt = now;
    next.answerSeen = true;
  } else throw new Error("此操作不适用于整篇训练。");
  return next;
}
