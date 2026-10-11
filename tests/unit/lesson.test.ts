import { describe, expect, it } from "vitest";
import {
  analyze,
  checkLimits,
  confirm,
  points,
  validateDraft,
  validateLesson,
  type Draft,
} from "../../app/core/lesson";
import { registry } from "../../app/languages/registry";

const language = registry.resolve("en");
export const draft: Draft = {
  schemaVersion: 1,
  id: "draft-1",
  languageId: "en",
  moduleRef: language.moduleRef,
  title: "Test",
  body: "Hello. World!\n  😀 Café  \n\n42",
  sourceRefs: [],
  boundaryWarnings: [],
  sentences: [],
  updatedAt: "2026-10-11T00:00:00Z",
};
export const snapshot = () =>
  confirm(draft, registry, {
    revisionId: "revision-1",
    sentenceId: (order) => `sentence-${order}`,
    now: "2026-10-11T00:00:00Z",
  });
describe("user line boundaries and import eligibility", () => {
  it("preserves content, ignores blank lines, normalizes CRLF/CR without splitting punctuation", () => {
    const result = analyze(" Hello. World!  \r\n \r😀 Café\r42", language);
    expect(result.body).toBe(" Hello. World!  \n😀 Café\n42");
    expect(result.sentences).toEqual([
      { order: 0, start: 0, end: 16 },
      { order: 1, start: 17, end: 23 },
      { order: 2, start: 24, end: 26 },
    ]);
    expect(result.issues).toEqual([]);
  });
  it("maps Unicode code points rather than UTF-16 indices", () => {
    const lesson = snapshot();
    expect(
      lesson.sentences.map((s) =>
        points(lesson.body).slice(s.start, s.end).join(""),
      ),
    ).toEqual(["Hello. World!", "  😀 Café  ", "42"]);
    expect(validateLesson(lesson, registry)).toEqual(lesson);
  });
  it.each(["", "  \n\t", "!?.", "😀"])(
    "rejects empty or symbol-only content: %s",
    (text) => {
      expect(analyze(text, language).issues.length).toBeGreaterThan(0);
    },
  );
  it("reports original editor line number for punctuation-only lines", () => {
    expect(analyze("\nGood\n\n!!!\nFine", language).issues).toEqual([
      { line: 4, message: "第 4 行没有有效文字或数字，不能仅含标点或符号。" },
    ]);
  });
  it("retains combining marks, numbers, apostrophes and foreign fragments", () => {
    expect(analyze("Don't café e\u0301 42 日本語", language).issues).toEqual(
      [],
    );
    expect(language.capabilities.training).toBe(false);
  });
  it("accepts exactly 20,000 code points including supplementary characters", () => {
    expect(checkLimits("😀".repeat(19_999) + "a")).toEqual([]);
    expect(checkLimits("😀".repeat(20_000) + "a")).toHaveLength(1);
  });
  it("accepts 500 nonempty lines and rejects 501", () => {
    expect(checkLimits(Array(500).fill("a\n ").join("\n"))).toEqual([]);
    expect(checkLimits(Array(501).fill("a").join("\n"))).toHaveLength(1);
  });
  it("checks limits before language analysis and does not truncate", () => {
    const text = "a".repeat(20_001);
    const result = analyze(text, {
      ...language,
      countUnits: () => {
        throw new Error("must not run");
      },
    });
    expect(result.body).toBe(text);
    expect(result.issues).toHaveLength(1);
  });
  it("requires an explicitly installed language and pinned versions", () => {
    expect(() => registry.resolve("")).toThrow("选择");
    expect(() => registry.resolve("fr")).toThrow("课文语言不可用");
    expect(() =>
      registry.resolve("en", { ...language.moduleRef, moduleVersion: "2" }),
    ).toThrow("版本不可用");
  });
  it("uses only injected identifiers and time, consistently across retries", () => {
    expect(snapshot()).toEqual(snapshot());
    expect(snapshot().lessonId).toBe(draft.id);
    expect(() =>
      confirm({ ...draft, body: "!!!" }, registry, {
        revisionId: "r",
        sentenceId: () => "s",
        now: draft.updatedAt,
      }),
    ).toThrow("第 1 行");
  });
  it("allows invalid content in a saved draft but validates its ranges", () => {
    const value = {
      ...draft,
      body: "!!!",
      sentences: [{ id: "s", order: 0, start: 0, end: 3 }],
    };
    expect(validateDraft(value, registry)).toEqual(value);
    expect(() => validateDraft({ ...value, sentences: [] }, registry)).toThrow(
      "边界",
    );
  });
  it.each([
    (lesson: ReturnType<typeof snapshot>) => ({ ...lesson, schemaVersion: 2 }),
    (lesson: ReturnType<typeof snapshot>) => ({ ...lesson, languageId: "" }),
    (lesson: ReturnType<typeof snapshot>) => ({
      ...lesson,
      body: lesson.body + "\n",
    }),
    (lesson: ReturnType<typeof snapshot>) => ({
      ...lesson,
      sentences: lesson.sentences.map((s) => ({ ...s, end: s.end + 1 })),
    }),
    (lesson: ReturnType<typeof snapshot>) => ({
      ...lesson,
      sentences: lesson.sentences.map((s) => ({ ...s, id: "same" })),
    }),
  ])("rejects corrupt persisted records without repairing them", (mutate) => {
    expect(() => validateLesson(mutate(snapshot()), registry)).toThrow();
  });
});
