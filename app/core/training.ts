import { points, sameModuleRef, type Lesson, type ModuleRef } from "./lesson";
import type { DiffResult, TrainingLanguage } from "./comparison";

export interface Attempt {
  id: string;
  requestId: string;
  sentenceId: string;
  rawText: string;
  confirmedText: string;
  hintUsed: boolean;
  answerSeenBeforeAttempt: boolean;
  status: "checked" | "skipped";
  inputKind: "keyboard";
  createdAt: string;
  result: DiffResult | null;
}
export interface Session {
  schemaVersion: 1;
  id: string;
  lessonId: string;
  lessonRevisionId: string;
  languageId: string;
  moduleRef: ModuleRef;
  comparisonProfileId: string;
  textDirection: "ltr" | "rtl";
  mode: "sentence_dictation";
  status: "answering" | "checked" | "completed";
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
  | { kind: "submit" | "skip"; requestId: string; attemptId: string }
  | { kind: "rewrite" }
  | { kind: "next" };
export function beginSession(
  lesson: Lesson,
  module: TrainingLanguage,
  host: { id: string; now: string },
  options: {
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
    schemaVersion: 1,
    id: host.id,
    lessonId: lesson.lessonId,
    lessonRevisionId: lesson.revisionId,
    languageId: lesson.languageId,
    moduleRef: { ...module.moduleRef },
    comparisonProfileId: module.comparisonProfileId,
    textDirection: module.textDirection,
    mode: "sentence_dictation",
    status: "answering",
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
  } else {
    if (state.status !== "answering") throw new Error("本句已提交。");
    const sentenceId = state.sentenceIds[state.index];
    const text = sentenceText(lesson, sentenceId);
    const reference = module.prepare(text, [
      { id: sentenceId, order: 0, start: 0, end: points(text).length },
    ]);
    const actual = module.prepare(state.input, [
      { id: sentenceId, order: 0, start: 0, end: points(state.input).length },
    ]);
    if (event.kind === "submit" && !actual.units.length)
      throw new Error("请输入有效文字或数字后提交。");
    const attempt: Attempt = {
      id: event.attemptId,
      requestId: event.requestId,
      sentenceId,
      rawText: state.input,
      confirmedText: state.input,
      hintUsed: state.hintUsed,
      answerSeenBeforeAttempt: state.answerSeen,
      status: event.kind === "skip" ? "skipped" : "checked",
      inputKind: "keyboard",
      createdAt: now,
      result:
        event.kind === "skip"
          ? null
          : module.comparePrepared(reference, actual),
    };
    next.attempts = [...state.attempts, attempt];
    next.status = "checked";
    next.answerSeen = true;
  }
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
    wrongIds: first.filter((a) => !correct(a)).map((a) => a.sentenceId),
  };
}

// Validate stored structure and ranges without recomparing or depending on a loaded module.
export function validateSession(value: unknown, lesson: Lesson): Session {
  const fail = (): never => {
    throw new Error("训练记录损坏，无法恢复。");
  };
  if (!value || typeof value !== "object") return fail();
  const s = value as Session;
  const date = (v: unknown) =>
    typeof v === "string" && Number.isFinite(Date.parse(v));
  if (
    s.schemaVersion !== 1 ||
    typeof s.id !== "string" ||
    !s.id ||
    s.lessonId !== lesson.lessonId ||
    s.lessonRevisionId !== lesson.revisionId ||
    s.languageId !== lesson.languageId ||
    !sameModuleRef(s.moduleRef, lesson.moduleRef) ||
    typeof s.comparisonProfileId !== "string" ||
    !["ltr", "rtl"].includes(s.textDirection) ||
    !s.comparisonProfileId ||
    s.mode !== "sentence_dictation" ||
    !["answering", "checked", "completed"].includes(s.status) ||
    !Array.isArray(s.sentenceIds) ||
    !s.sentenceIds.length ||
    new Set(s.sentenceIds).size !== s.sentenceIds.length ||
    s.sentenceIds.some(
      (id, i) =>
        !lesson.sentences.some((x) => x.id === id) ||
        (i > 0 &&
          lesson.sentences.findIndex((x) => x.id === id) <=
            lesson.sentences.findIndex((x) => x.id === s.sentenceIds[i - 1])),
    ) ||
    !Number.isInteger(s.index) ||
    s.index < 0 ||
    s.index >= s.sentenceIds.length ||
    typeof s.input !== "string" ||
    points(s.input).length > 20_000 ||
    [s.hintVisible, s.hintUsed, s.answerSeen].some(
      (v) => typeof v !== "boolean",
    ) ||
    (s.hintVisible && !s.hintUsed) ||
    !Number.isInteger(s.version) ||
    s.version < 0 ||
    !date(s.createdAt) ||
    !date(s.updatedAt) ||
    !Array.isArray(s.attempts) ||
    !(
      s.sourceSessionId === null ||
      (typeof s.sourceSessionId === "string" && !!s.sourceSessionId)
    ) ||
    (s.status === "completed" ? !date(s.completedAt) : s.completedAt !== null)
  )
    return fail();
  const requests = new Set<string>(),
    ids = new Set<string>();
  let lastOrder = -1;
  for (const a of s.attempts) {
    if (
      !a ||
      typeof a.id !== "string" ||
      !a.id ||
      ids.has(a.id) ||
      typeof a.requestId !== "string" ||
      !a.requestId ||
      requests.has(a.requestId) ||
      !s.sentenceIds.includes(a.sentenceId) ||
      typeof a.rawText !== "string" ||
      a.confirmedText !== a.rawText ||
      typeof a.hintUsed !== "boolean" ||
      typeof a.answerSeenBeforeAttempt !== "boolean" ||
      a.inputKind !== "keyboard" ||
      !date(a.createdAt) ||
      !["checked", "skipped"].includes(a.status)
    )
      return fail();
    const order = s.sentenceIds.indexOf(a.sentenceId);
    if (
      order < lastOrder ||
      order > s.index ||
      order > lastOrder + 1 ||
      a.answerSeenBeforeAttempt !== (order === lastOrder)
    )
      return fail();
    lastOrder = order;
    ids.add(a.id);
    requests.add(a.requestId);
    if (a.status === "skipped") {
      if (a.result !== null) return fail();
      continue;
    }
    const r = a.result;
    const reference = sentenceText(lesson, a.sentenceId);
    const referencePoints = points(reference),
      actualPoints = points(a.confirmedText);
    if (
      !r ||
      r.languageId !== s.languageId ||
      !sameModuleRef(r.moduleRef, s.moduleRef) ||
      r.comparisonProfileId !== s.comparisonProfileId ||
      !["unitKind", "unitLabel", "accuracyLabel"].every(
        (k) => typeof r[k as keyof DiffResult] === "string",
      ) ||
      !Array.isArray(r.operations) ||
      !Array.isArray(r.sentenceResults) ||
      r.sentenceResults.length !== 1 ||
      !r.sentenceResults[0] ||
      r.sentenceResults[0].sentenceId !== a.sentenceId ||
      !Number.isInteger(r.N) ||
      r.N < 1
    )
      return fail();
    let N = 0,
      S = 0,
      D = 0,
      I = 0,
      actualIndex = 0;
    for (const op of r.operations) {
      if (
        !op ||
        !["match", "delete", "insert", "substitute"].includes(op.kind) ||
        op.sentenceId !== a.sentenceId ||
        op.referenceIndex !== N ||
        op.actualIndex !== actualIndex
      )
        return fail();
      for (const [unit, text] of [
        [op.reference, referencePoints],
        [op.actual, actualPoints],
      ] as const) {
        if (unit === null) continue;
        if (
          !unit ||
          typeof unit.key !== "string" ||
          !unit.key ||
          unit.sentenceId !== a.sentenceId ||
          !unit.sourceRange ||
          !Number.isInteger(unit.sourceRange.start) ||
          !Number.isInteger(unit.sourceRange.end) ||
          unit.sourceRange.start < 0 ||
          unit.sourceRange.end <= unit.sourceRange.start ||
          unit.sourceRange.end > text.length ||
          unit.displayText !==
            text.slice(unit.sourceRange.start, unit.sourceRange.end).join("")
        )
          return fail();
      }
      if (op.kind === "insert") {
        if (op.reference !== null || !op.actual) return fail();
        I++;
      } else {
        if (!op.reference) return fail();
        N++;
      }
      if (op.kind === "delete") {
        if (op.actual !== null) return fail();
        D++;
      } else {
        if (!op.actual) return fail();
        actualIndex++;
      }
      if (op.kind === "substitute") {
        if (op.reference!.key === op.actual!.key) return fail();
        S++;
      }
      if (op.kind === "match" && op.reference!.key !== op.actual!.key)
        return fail();
    }
    const accuracy = Math.max(0, 1 - (S + D + I) / N) * 100;
    if (
      r.N !== N ||
      r.S !== S ||
      r.D !== D ||
      r.I !== I ||
      r.accuracy !== accuracy ||
      ["N", "S", "D", "I", "accuracy"].some(
        (k) => r.sentenceResults[0][k as "N"] !== r[k as "N"],
      )
    )
      return fail();
  }
  const last = s.attempts
    .filter((a) => a.sentenceId === s.sentenceIds[s.index])
    .at(-1);
  if (
    s.answerSeen !== !!last ||
    (s.status !== "answering" &&
      (!last || s.input !== last.rawText || s.hintUsed !== last.hintUsed))
  )
    return fail();
  if (
    s.sentenceIds
      .slice(0, s.index)
      .some((id) => !s.attempts.some((a) => a.sentenceId === id)) ||
    (s.status !== "answering" &&
      (!s.answerSeen ||
        !s.attempts.some((a) => a.sentenceId === s.sentenceIds[s.index]))) ||
    (s.status === "completed" && s.index !== s.sentenceIds.length - 1)
  )
    return fail();
  return s;
}
