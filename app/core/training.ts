import { reduceWhole } from "./whole-training";
export { validateSession } from "./training-validation";
import { points, sameModuleRef, type Lesson, type ModuleRef } from "./lesson";
import type { DiffResult, TrainingLanguage } from "./comparison";

export type Mode = "sentence_dictation" | "full_dictation" | "recitation";
export type InputKind = "keyboard" | "handwriting" | "speech";
export interface Recognition {
  languageId: string;
  sourceRef: string;
  rawTranscript: string;
  editedTranscript: string;
  wasEdited: boolean;
  warnings: string[];
  providerMetadata: Record<string, string> | null;
}
export interface Attempt {
  id: string;
  requestId: string;
  sentenceId: string | null;
  rawText: string;
  confirmedText: string;
  hintUsed: boolean;
  answerSeenBeforeAttempt: boolean;
  status: "checked" | "skipped";
  inputKind: InputKind;
  recognition: Recognition | null;
  createdAt: string;
  result: DiffResult | null;
}
export interface Session {
  generation: number;
  schemaVersion: 1;
  id: string;
  lessonId: string;
  lessonRevisionId: string;
  languageId: string;
  moduleRef: ModuleRef;
  comparisonProfileId: string;
  textDirection: "ltr" | "rtl";
  mode: Mode;
  inputKind: InputKind;
  recognition: Recognition | null;
  taskId: string | null;
  status:
    | "ready"
    | "recording"
    | "collecting"
    | "recognizing"
    | "confirming"
    | "answering"
    | "checked"
    | "completed";
  sentenceIds: string[];
  index: number;
  input: string;
  hintVisible: boolean;
  hintUsed: boolean;
  answerSeen: boolean;
  attempts: Attempt[];
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceSessionId: string | null;
}
export type Event =
  | { kind: "input"; text: string }
  | { kind: "hint"; visible: boolean }
  | {
      kind: "submit" | "skip";
      requestId: string;
      attemptId: string;
      text?: string;
    }
  | { kind: "save-draft"; text: string }
  | { kind: "record" }
  | { kind: "recognize"; taskId: string }
  | { kind: "recognized"; taskId: string; recognition: Recognition }
  | { kind: "recognition-failed"; taskId: string }
  | { kind: "cancel-recognition" }
  | { kind: "confirm-text"; text: string }
  | { kind: "rewrite" }
  | { kind: "next" };
export function beginSession(
  lesson: Lesson,
  module: TrainingLanguage,
  host: { id: string; now: string },
  options: {
    mode?: Mode;
    inputKind?: InputKind;
    hint?: boolean;
    sentenceIds?: string[];
    sourceSessionId?: string;
  } = {},
): Session {
  if (
    lesson.languageId !== module.languageId ||
    !sameModuleRef(lesson.moduleRef, module.moduleRef)
  )
    throw new Error("课文所用的语言版本不可用。");
  const mode = options.mode ?? "sentence_dictation";
  const inputKind =
    options.inputKind ?? (mode === "recitation" ? "speech" : "keyboard");
  if (
    !["sentence_dictation", "full_dictation", "recitation"].includes(mode) ||
    !["keyboard", "handwriting", "speech"].includes(inputKind) ||
    (mode === "recitation" && inputKind !== "speech") ||
    (mode === "sentence_dictation" && inputKind !== "keyboard") ||
    (mode === "full_dictation" && inputKind === "speech") ||
    (mode !== "sentence_dictation" &&
      (options.sourceSessionId || options.sentenceIds || options.hint))
  )
    throw new Error("训练模式与输入方式不一致。");
  const ids = options.sentenceIds ?? lesson.sentences.map((s) => s.id);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id, i) =>
        !lesson.sentences.some((s) => s.id === id) ||
        (i > 0 &&
          lesson.sentences.findIndex((s) => s.id === id) <=
            lesson.sentences.findIndex((s) => s.id === ids[i - 1])),
    )
  )
    throw new Error("训练句子范围有误。");
  return {
    generation: 0,
    schemaVersion: 1,
    id: host.id,
    lessonId: lesson.lessonId,
    lessonRevisionId: lesson.revisionId,
    languageId: lesson.languageId,
    moduleRef: { ...module.moduleRef },
    comparisonProfileId: module.comparisonProfileId,
    textDirection: module.textDirection,
    mode,
    inputKind,
    recognition: null,
    taskId: null,
    status:
      mode === "recitation"
        ? "ready"
        : inputKind === "handwriting"
          ? "collecting"
          : "answering",
    sentenceIds: [...ids],
    index: 0,
    input: "",
    hintVisible: !!options.hint,
    hintUsed: !!options.hint,
    answerSeen: false,
    attempts: [],
    version: 0,
    createdAt: host.now,
    updatedAt: host.now,
    completedAt: null,
    sourceSessionId: options.sourceSessionId ?? null,
  };
}
export function sentenceText(lesson: Lesson, id: string) {
  const sentence = lesson.sentences.find((s) => s.id === id);
  if (!sentence) throw new Error("训练句子不存在。");
  return points(lesson.body).slice(sentence.start, sentence.end).join("");
}
export function reduceSession(
  state: Session,
  event: Event,
  lesson: Lesson,
  module: TrainingLanguage,
  now: string,
): Session {
  if (
    state.lessonRevisionId !== lesson.revisionId ||
    state.lessonId !== lesson.lessonId ||
    state.languageId !== lesson.languageId ||
    state.languageId !== module.languageId ||
    state.comparisonProfileId !== module.comparisonProfileId ||
    !sameModuleRef(state.moduleRef, module.moduleRef)
  )
    throw new Error("训练所用的语言版本不可用。");
  if (
    (event.kind === "submit" || event.kind === "skip") &&
    state.attempts.some((a) => a.requestId === event.requestId)
  )
    return state;
  if (state.status === "completed") throw new Error("本次训练已完成。");
  if (state.mode !== "sentence_dictation")
    return reduceWhole(state, event, lesson, module, now);
  const next = { ...state, version: state.version + 1, updatedAt: now };
  if (event.kind === "input" || event.kind === "hint") {
    if (state.status !== "answering") throw new Error("本句已提交。");
    if (event.kind === "input") {
      if (points(event.text).length > 20_000)
        throw new Error("输入超过 20,000 个字符，请缩短后重试。");
      next.input = event.text;
    } else {
      next.hintVisible = event.visible;
      next.hintUsed ||= event.visible;
    }
  } else if (event.kind === "rewrite") {
    if (state.status !== "checked") throw new Error("请先提交或跳过本句。");
    next.status = "answering";
    next.input = "";
    next.answerSeen = true;
    next.hintUsed = next.hintVisible;
  } else if (event.kind === "next") {
    if (state.status !== "checked") throw new Error("请先提交或跳过本句。");
    if (state.index === state.sentenceIds.length - 1) {
      next.status = "completed";
      next.completedAt = now;
    } else {
      next.index++;
      next.status = "answering";
      next.input = "";
      next.answerSeen = false;
      next.hintUsed = next.hintVisible;
    }
  } else if (event.kind === "submit" || event.kind === "skip") {
    if (state.status !== "answering") throw new Error("本句已提交。");
    const input = event.text ?? state.input;
    if (points(input).length > 20_000)
      throw new Error("输入超过 20,000 个字符，请缩短后重试。");
    next.input = input;
    const sentenceId = state.sentenceIds[state.index];
    const text = sentenceText(lesson, sentenceId);
    const reference = module.prepare(text, [
      { id: sentenceId, order: 0, start: 0, end: points(text).length },
    ]);
    const actual = module.prepare(input, [
      { id: sentenceId, order: 0, start: 0, end: points(input).length },
    ]);
    if (event.kind === "submit" && !actual.units.length)
      throw new Error("请输入有效文字或数字后提交。");
    const attempt: Attempt = {
      id: event.attemptId,
      requestId: event.requestId,
      sentenceId,
      rawText: input,
      confirmedText: input,
      hintUsed: state.hintUsed,
      answerSeenBeforeAttempt: state.answerSeen,
      status: event.kind === "skip" ? "skipped" : "checked",
      inputKind: "keyboard",
      recognition: null,
      createdAt: now,
      result:
        event.kind === "skip"
          ? null
          : module.comparePrepared(reference, actual),
    };
    next.attempts = [...state.attempts, attempt];
    next.status = "checked";
    next.answerSeen = true;
  } else throw new Error("此操作不适用于逐句默写。");
  return next;
}
export const correct = (attempt: Attempt) =>
  !!attempt.result &&
  attempt.result.S + attempt.result.D + attempt.result.I === 0;
export function summarize(session: Session) {
  const first = session.sentenceIds
    .map((id) => session.attempts.find((a) => a.sentenceId === id))
    .filter((a): a is Attempt => !!a);
  return {
    independent: first.filter(
      (a) => correct(a) && !a.hintUsed && !a.answerSeenBeforeAttempt,
    ).length,
    hinted: first.filter(
      (a) => correct(a) && (a.hintUsed || a.answerSeenBeforeAttempt),
    ).length,
    errors: first.filter((a) => a.status !== "skipped" && !correct(a)).length,
    skipped: first.filter((a) => a.status === "skipped").length,
    retries: session.attempts.length - first.length,
    retryCorrect: session.attempts.filter(
      (a) => !first.includes(a) && correct(a),
    ).length,
    first,
    wrongIds: first
      .filter((a) => !correct(a))
      .map((a) => a.sentenceId!)
      .filter((id): id is string => id !== null),
  };
}
