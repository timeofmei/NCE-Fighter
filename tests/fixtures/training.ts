import { english } from "../../app/languages/english";
import { analyze, type Lesson } from "../../app/core/lesson";
export const now = "2026-10-11T00:00:00Z";
export function lesson(
  body = "I had a very good seat.\nDon't stop.\nHello,world!",
): Lesson {
  return {
    schemaVersion: 1,
    lessonId: "lesson",
    revisionId: "revision",
    languageId: "en",
    moduleRef: english.moduleRef,
    title: "Training",
    body,
    sentences: analyze(body, english).sentences.map((s) => ({
      ...s,
      id: `s${s.order}`,
    })),
    confirmedAt: now,
  };
}
