import { points, type ImportLanguage, type Sentence } from "../core/lesson";
import {
  aggregateResult,
  validateRanges,
  type TrainingLanguage,
  type Unit,
} from "../core/comparison";
import { caseFold } from "./case-fold";
import type { DocumentLanguage } from "../core/document";
import { proposeEnglishDocument } from "./english-document";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export const english: ImportLanguage & TrainingLanguage & DocumentLanguage = {
  proposeDocument: proposeEnglishDocument,
  languageId: "en",
  label: "英语",
  textDirection: "ltr",
  moduleRef: {
    moduleId: "english-text-import",
    moduleVersion: "1.0.0",
    profileVersion: "1.0.0",
  },
  comparisonProfileId: "english-words-v1",
  unitKind: "word",
  unitLabel: "词",
  hintLabel: "逐词首字母",
  accuracyLabel: "词序列准确度",
  capabilities: { textImport: true, training: true },
  countUnits(text) {
    return english.prepare(text, [
      { id: "count", order: 0, start: 0, end: points(text).length },
    ]).units.length;
  },
  prepare(text, sentences) {
    // Empty input is valid for comparison, but not for a submitted answer.
    validateRanges(text, sentences);
    const source = points(text),
      units: Unit[] = [];
    for (const sentence of sentences) {
      // Normalize grapheme-like clusters, retaining ranges through composition and expansion.
      const mapped: { char: string; start: number; end: number }[] = [];
      let i = sentence.start;
      for (const { segment } of segmenter.segment(
        source.slice(sentence.start, sentence.end).join(""),
      )) {
        const start = i;
        i += points(segment).length;
        const normalized = caseFold(segment.normalize("NFKC"));
        for (const char of points(normalized))
          mapped.push({ char, start, end: i });
      }
      let token: typeof mapped = [];
      const flush = () => {
        if (token.length) {
          const start = token[0].start,
            end = token[token.length - 1].end;
          units.push({
            key: token.map((x) => x.char).join(""),
            displayText: source.slice(start, end).join(""),
            sourceRange: { start, end },
            sentenceId: sentence.id,
          });
          token = [];
        }
      };
      mapped.forEach((item, index) => {
        if (
          /[\p{L}\p{N}]/u.test(item.char) ||
          (token.length && /\p{M}/u.test(item.char))
        )
          token.push(item);
        else if (
          (item.char === "'" || item.char === "’") &&
          token.length &&
          /[\p{L}\p{N}]/u.test(mapped[index + 1]?.char ?? "")
        ) {
          /* internal apostrophe is ignored */
        } else flush();
      });
      flush();
    }
    return { text, units };
  },
  buildHint(text: string, sentence: Sentence) {
    return {
      label: english.hintLabel,
      kind: "initials",
      textDirection: "ltr",
      fragments: english
        .prepare(text, [sentence])
        .units.map((u) => points(u.key)[0]),
    };
  },
  comparePrepared(reference, actual) {
    return aggregateResult(reference, actual, english);
  },
};
