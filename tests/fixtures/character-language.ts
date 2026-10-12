import {
  aggregateResult,
  validateRanges,
  type TrainingLanguage,
} from "../../app/core/comparison";
import { points, type ImportLanguage } from "../../app/core/lesson";

// Contract fixture only; never registered as a supported application language.
export const characterLanguage: TrainingLanguage & ImportLanguage = {
  languageId: "test-characters",
  label: "Test characters",
  textDirection: "rtl",
  moduleRef: {
    moduleId: "test-characters",
    moduleVersion: "1",
    profileVersion: "1",
  },
  comparisonProfileId: "graphemes",
  unitKind: "grapheme",
  unitLabel: "字",
  hintLabel: "遮盖",
  accuracyLabel: "字符准确度",
  capabilities: { textImport: true, training: true },
  countUnits(text) {
    return this.prepare(text, [
      { id: "input", order: 0, start: 0, end: points(text).length },
    ]).units.length;
  },
  prepare(text, sentences) {
    validateRanges(text, sentences);
    const units = [];
    const chars = points(text);
    for (const s of sentences) {
      let offset = s.start;
      for (const { segment } of new Intl.Segmenter("en", {
        granularity: "grapheme",
      }).segment(chars.slice(s.start, s.end).join(""))) {
        const end = offset + points(segment).length;
        if (/[\p{L}\p{N}]/u.test(segment))
          units.push({
            key: segment.toLowerCase(),
            displayText: segment,
            sourceRange: { start: offset, end },
            sentenceId: s.id,
          });
        offset = end;
      }
    }
    return { text, units };
  },
  buildHint() {
    return {
      label: "遮盖",
      kind: "mask",
      textDirection: "rtl",
      fragments: ["□", "乙"],
    };
  },
  comparePrepared(reference, actual) {
    return aggregateResult(reference, actual, characterLanguage);
  },
};
