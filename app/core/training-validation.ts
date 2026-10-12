import { points, sameModuleRef, type Lesson } from "./lesson";
import type { DiffResult } from "./comparison";
import { sentenceText, type Recognition, type Session } from "./training";

const fail = (): never => {
  throw new Error("训练记录损坏，无法恢复。");
};
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
export function validateRecognition(r: Recognition, languageId: string) {
  if (
    !r ||
    r.languageId !== languageId ||
    typeof r.sourceRef !== "string" ||
    !r.sourceRef ||
    typeof r.rawTranscript !== "string" ||
    typeof r.editedTranscript !== "string" ||
    r.wasEdited !== (r.rawTranscript !== r.editedTranscript) ||
    !Array.isArray(r.warnings) ||
    !r.warnings.every((w) => typeof w === "string") ||
    !(
      r.providerMetadata === null ||
      (typeof r.providerMetadata === "object" &&
        !Array.isArray(r.providerMetadata) &&
        Object.values(r.providerMetadata).every((v) => typeof v === "string"))
    )
  )
    fail();
}

function validateDiff(
  r: DiffResult,
  s: Session,
  reference: string,
  actual: string,
  sentenceIds: string[],
  lesson: Lesson,
  whole: boolean,
) {
  if (
    !r ||
    r.languageId !== s.languageId ||
    !sameModuleRef(r.moduleRef, s.moduleRef) ||
    r.comparisonProfileId !== s.comparisonProfileId ||
    ![r.unitKind, r.unitLabel, r.accuracyLabel].every(
      (v) => typeof v === "string" && !!v,
    ) ||
    !Array.isArray(r.operations) ||
    !Array.isArray(r.sentenceResults) ||
    r.sentenceResults.length !== sentenceIds.length
  )
    fail();
  const ref = points(reference),
    act = points(actual);
  let N = 0,
    S = 0,
    D = 0,
    I = 0,
    actualIndex = 0,
    previousSentence = -1;
  const previousStart = { reference: -1, actual: -1 };
  const groups = new Map(
    sentenceIds.map((id) => [id, { N: 0, S: 0, D: 0, I: 0 }]),
  );
  for (const op of r.operations) {
    if (
      !op ||
      !["match", "delete", "insert", "substitute"].includes(op.kind) ||
      !groups.has(op.sentenceId) ||
      op.referenceIndex !== N ||
      op.actualIndex !== actualIndex
    )
      fail();
    const order = sentenceIds.indexOf(op.sentenceId);
    if (order < previousSentence) fail();
    previousSentence = order;
    for (const [unit, text, side] of [
      [op.reference, ref, "reference"],
      [op.actual, act, "actual"],
    ] as const) {
      if (unit === null) continue;
      if (
        !unit ||
        typeof unit.key !== "string" ||
        !unit.key ||
        !unit.sourceRange ||
        !Number.isInteger(unit.sourceRange.start) ||
        !Number.isInteger(unit.sourceRange.end) ||
        unit.sourceRange.start < 0 ||
        unit.sourceRange.end <= unit.sourceRange.start ||
        unit.sourceRange.end > text.length ||
        unit.displayText !==
          text.slice(unit.sourceRange.start, unit.sourceRange.end).join("")
      )
        fail();
      if (unit.sourceRange.start < previousStart[side]) fail();
      previousStart[side] = unit.sourceRange.start;
      if (side === "reference") {
        if (unit.sentenceId !== op.sentenceId) fail();
        if (whole) {
          const sentence = lesson.sentences.find(
            (x) => x.id === unit.sentenceId,
          )!;
          if (
            !sentence ||
            unit.sourceRange.start < sentence.start ||
            unit.sourceRange.end > sentence.end
          )
            fail();
        }
      } else if (unit.sentenceId !== (whole ? "input" : sentenceIds[0])) fail();
    }
    const g = groups.get(op.sentenceId)!;
    if (op.kind === "insert") {
      if (op.reference !== null || !op.actual) fail();
      I++;
      g.I++;
    } else {
      if (!op.reference) fail();
      N++;
      g.N++;
    }
    if (op.kind === "delete") {
      if (op.actual !== null) fail();
      D++;
      g.D++;
    } else {
      if (!op.actual) fail();
      actualIndex++;
    }
    if (op.kind === "substitute") {
      if (op.reference!.key === op.actual!.key) fail();
      S++;
      g.S++;
    }
    if (op.kind === "match" && op.reference!.key !== op.actual!.key) fail();
  }
  const accuracy = N ? Math.max(0, 1 - (S + D + I) / N) * 100 : 0;
  if (
    N < 1 ||
    r.N !== N ||
    r.S !== S ||
    r.D !== D ||
    r.I !== I ||
    r.accuracy !== accuracy
  )
    fail();
  r.sentenceResults.forEach((row, i) => {
    const g = groups.get(sentenceIds[i])!;
    if (
      !row ||
      row.sentenceId !== sentenceIds[i] ||
      g.N < 1 ||
      row.N !== g.N ||
      row.S !== g.S ||
      row.D !== g.D ||
      row.I !== g.I ||
      row.accuracy !== Math.max(0, 1 - (g.S + g.D + g.I) / g.N) * 100
    )
      fail();
  });
}

export function validateSession(value: unknown, lesson: Lesson): Session {
  if (!value || typeof value !== "object") return fail();
  const s = value as Session;
  const whole = s.mode !== "sentence_dictation";
  if (
    !Number.isSafeInteger(s.generation) ||
    s.generation < 0 ||
    s.schemaVersion !== 1 ||
    typeof s.id !== "string" ||
    !s.id ||
    s.lessonId !== lesson.lessonId ||
    s.lessonRevisionId !== lesson.revisionId ||
    s.languageId !== lesson.languageId ||
    !sameModuleRef(s.moduleRef, lesson.moduleRef) ||
    typeof s.comparisonProfileId !== "string" ||
    !s.comparisonProfileId ||
    !["ltr", "rtl"].includes(s.textDirection) ||
    !["sentence_dictation", "full_dictation", "recitation"].includes(s.mode) ||
    !["keyboard", "speech", "handwriting"].includes(s.inputKind) ||
    (s.mode === "recitation"
      ? s.inputKind !== "speech"
      : s.mode === "sentence_dictation"
        ? s.inputKind !== "keyboard"
        : s.inputKind === "speech") ||
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
    !Number.isSafeInteger(s.version) ||
    s.version < 0 ||
    !date(s.createdAt) ||
    !date(s.updatedAt) ||
    !Array.isArray(s.attempts) ||
    !(
      s.sourceSessionId === null ||
      (typeof s.sourceSessionId === "string" && !!s.sourceSessionId)
    ) ||
    !(s.taskId === null || (typeof s.taskId === "string" && !!s.taskId)) ||
    (s.status === "completed" ? !date(s.completedAt) : s.completedAt !== null)
  )
    return fail();
  const allowed = !whole
    ? ["answering", "checked", "completed"]
    : s.inputKind === "keyboard"
      ? ["answering", "completed"]
      : s.inputKind === "speech"
        ? ["ready", "recording", "recognizing", "confirming", "completed"]
        : ["collecting", "recognizing", "confirming", "completed"];
  if (
    !allowed.includes(s.status) ||
    (s.status === "recognizing") !== (s.taskId !== null)
  )
    fail();
  if (s.recognition !== null) validateRecognition(s.recognition, s.languageId);
  if (whole) {
    if (
      s.index !== 0 ||
      s.sourceSessionId !== null ||
      s.hintVisible ||
      s.hintUsed ||
      JSON.stringify(s.sentenceIds) !==
        JSON.stringify(lesson.sentences.map((x) => x.id)) ||
      s.attempts.length !== (s.status === "completed" ? 1 : 0) ||
      s.answerSeen !== (s.status === "completed") ||
      (s.inputKind === "keyboard" && s.recognition !== null) ||
      (["confirming", "completed"].includes(s.status) &&
        s.inputKind !== "keyboard" &&
        (!s.recognition || s.input !== s.recognition.editedTranscript))
    )
      fail();
  } else if (s.recognition !== null || s.taskId !== null) fail();
  const ids = new Set<string>(),
    requests = new Set<string>();
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
      (whole
        ? a.sentenceId !== null
        : !s.sentenceIds.includes(a.sentenceId!)) ||
      typeof a.rawText !== "string" ||
      typeof a.confirmedText !== "string" ||
      points(a.confirmedText).length > 20_000 ||
      typeof a.hintUsed !== "boolean" ||
      typeof a.answerSeenBeforeAttempt !== "boolean" ||
      a.inputKind !== s.inputKind ||
      !date(a.createdAt) ||
      !["checked", "skipped"].includes(a.status)
    )
      fail();
    ids.add(a.id);
    requests.add(a.requestId);
    if (a.recognition !== null) {
      validateRecognition(a.recognition, s.languageId);
      if (
        a.inputKind === "keyboard" ||
        a.rawText !== a.recognition.rawTranscript ||
        a.confirmedText !== a.recognition.editedTranscript ||
        JSON.stringify(a.recognition) !== JSON.stringify(s.recognition)
      )
        fail();
    } else if (a.inputKind !== "keyboard" || a.rawText !== a.confirmedText)
      fail();
    if (whole) {
      if (
        a.status !== "checked" ||
        a.hintUsed ||
        a.answerSeenBeforeAttempt ||
        s.input !== a.confirmedText
      )
        fail();
    } else {
      const order = s.sentenceIds.indexOf(a.sentenceId!);
      if (
        order < lastOrder ||
        order > s.index ||
        order > lastOrder + 1 ||
        a.answerSeenBeforeAttempt !== (order === lastOrder)
      )
        fail();
      lastOrder = order;
    }
    if (a.status === "skipped") {
      if (a.result !== null) fail();
    } else
      validateDiff(
        a.result!,
        s,
        whole ? lesson.body : sentenceText(lesson, a.sentenceId!),
        a.confirmedText,
        whole ? s.sentenceIds : [a.sentenceId!],
        lesson,
        whole,
      );
  }
  if (!whole) {
    const last = s.attempts
      .filter((a) => a.sentenceId === s.sentenceIds[s.index])
      .at(-1);
    if (
      s.answerSeen !== !!last ||
      (s.status !== "answering" &&
        (!last || s.input !== last.rawText || s.hintUsed !== last.hintUsed)) ||
      s.sentenceIds
        .slice(0, s.index)
        .some((id) => !s.attempts.some((a) => a.sentenceId === id)) ||
      (s.status !== "answering" && !last) ||
      (s.status === "completed" && s.index !== s.sentenceIds.length - 1)
    )
      fail();
  }
  return s;
}
