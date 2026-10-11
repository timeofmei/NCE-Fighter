import type { ModuleRef, Sentence } from "./lesson";

export interface Unit {
  key: string;
  displayText: string;
  sourceRange: { start: number; end: number };
  sentenceId: string;
}
export interface PreparedText {
  text: string;
  units: Unit[];
}
export interface Hint {
  label: string;
  kind: string;
  textDirection: "ltr" | "rtl";
  fragments: string[];
}
export interface Operation {
  kind: "match" | "substitute" | "delete" | "insert";
  reference: Unit | null;
  actual: Unit | null;
  referenceIndex: number;
  actualIndex: number;
  sentenceId: string;
}
export interface DiffResult {
  languageId: string;
  moduleRef: ModuleRef;
  comparisonProfileId: string;
  unitKind: string;
  unitLabel: string;
  accuracyLabel: string;
  operations: Operation[];
  N: number;
  S: number;
  D: number;
  I: number;
  accuracy: number;
  sentenceResults: {
    sentenceId: string;
    N: number;
    S: number;
    D: number;
    I: number;
    accuracy: number;
  }[];
}
export interface TrainingLanguage {
  languageId: string;
  moduleRef: ModuleRef;
  comparisonProfileId: string;
  unitKind: string;
  unitLabel: string;
  hintLabel: string;
  accuracyLabel: string;
  textDirection: "ltr" | "rtl";
  prepare(text: string, sentences: Sentence[]): PreparedText;
  buildHint(text: string, sentence: Sentence): Hint;
  comparePrepared(reference: PreparedText, actual: PreparedText): DiffResult;
}
export function validateRanges(text: string, sentences: Sentence[]) {
  const length = Array.from(text).length;
  let end = 0;
  const ids = new Set<string>();
  for (const sentence of sentences) {
    if (
      !sentence.id ||
      ids.has(sentence.id) ||
      !Number.isInteger(sentence.start) ||
      !Number.isInteger(sentence.end) ||
      sentence.start < end ||
      sentence.end < sentence.start ||
      (sentence.end === sentence.start &&
        (length !== 0 || sentence.start !== 0)) ||
      sentence.end > length
    )
      throw new Error("句子范围无效。");
    ids.add(sentence.id);
    end = sentence.end;
  }
}

// Two rows for costs, one byte per cell for deterministic backtracking.
export function alignUnits(reference: Unit[], actual: Unit[]): Operation[] {
  const width = actual.length + 1;
  if ((reference.length + 1) * width > 16_000_000)
    throw new Error("比较内容过长，请缩短本次输入后重试。");
  const path = new Uint8Array((reference.length + 1) * width);
  let previous = Uint32Array.from({ length: width }, (_, i) => i);
  for (let j = 1; j < width; j++) path[j] = 3;
  for (let i = 1; i <= reference.length; i++) {
    const row = new Uint32Array(width);
    row[0] = i;
    path[i * width] = 2;
    for (let j = 1; j < width; j++) {
      const diagonal =
        previous[j - 1] + Number(reference[i - 1].key !== actual[j - 1].key);
      const deletion = previous[j] + 1,
        insertion = row[j - 1] + 1;
      row[j] = Math.min(diagonal, deletion, insertion);
      path[i * width + j] =
        diagonal === row[j] ? 1 : deletion === row[j] ? 2 : 3;
    }
    previous = row;
  }
  const result: Operation[] = [];
  let i = reference.length,
    j = actual.length;
  while (i || j) {
    const step = path[i * width + j];
    const a = step !== 3 ? reference[i - 1] : null,
      b = step !== 2 ? actual[j - 1] : null;
    result.push({
      kind:
        step === 1
          ? a!.key === b!.key
            ? "match"
            : "substitute"
          : step === 2
            ? "delete"
            : "insert",
      reference: a,
      actual: b,
      referenceIndex: step === 3 ? i : i - 1,
      actualIndex: step === 2 ? j : j - 1,
      sentenceId:
        a?.sentenceId ??
        reference[Math.min(i, reference.length - 1)]?.sentenceId ??
        "",
    });
    if (step !== 3) i--;
    if (step !== 2) j--;
  }
  return result.reverse();
}
export function counts(operations: Operation[], N: number) {
  const S = operations.filter((o) => o.kind === "substitute").length;
  const D = operations.filter((o) => o.kind === "delete").length;
  const I = operations.filter((o) => o.kind === "insert").length;
  return {
    N,
    S,
    D,
    I,
    accuracy: N ? Math.max(0, 1 - (S + D + I) / N) * 100 : 0,
  };
}
export function aggregateResult(
  reference: PreparedText,
  actual: PreparedText,
  module: TrainingLanguage,
): DiffResult {
  if (!reference.units.length) throw new Error("标准原句没有可比较的内容。");
  const operations = alignUnits(reference.units, actual.units);
  return {
    languageId: module.languageId,
    moduleRef: { ...module.moduleRef },
    comparisonProfileId: module.comparisonProfileId,
    unitKind: module.unitKind,
    unitLabel: module.unitLabel,
    accuracyLabel: module.accuracyLabel,
    operations,
    ...counts(operations, reference.units.length),
    sentenceResults: [...new Set(reference.units.map((u) => u.sentenceId))].map(
      (sentenceId) => ({
        sentenceId,
        ...counts(
          operations.filter((o) => o.sentenceId === sentenceId),
          reference.units.filter((u) => u.sentenceId === sentenceId).length,
        ),
      }),
    ),
  };
}
