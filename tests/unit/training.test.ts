import { lesson, now } from "../fixtures/training";
import { describe, expect, it } from "vitest";
import { english } from "../../app/languages/english";
import {
  aggregateResult,
  type TrainingLanguage,
} from "../../app/core/comparison";
import { points } from "../../app/core/lesson";
import {
  beginSession,
  reduceSession,
  summarize,
  validateSession,
  type Event,
} from "../../app/core/training";

function prepare(text: string) {
  return english.prepare(text, [
    { id: "s", order: 0, start: 0, end: points(text).length },
  ]);
}
function compare(a: string, b: string) {
  return english.comparePrepared(prepare(a), prepare(b));
}
describe("English normalization, ranges and deterministic alignment", () => {
  it.each([
    ["I had a very good seat.", "i HAD a very good seat!!!"],
    ["Hello,world!", "hello world"],
    ["Don't stop.", "dont stop"],
    ["well-known", "well known"],
    ["ＦＵＬＬ ﬁ Ａ", "full fi a"],
    ["Café", "Cafe\u0301"],
    ["Straße", "STRASSE"],
    ["ΟΣ", "οσ"],
    ["1.25", "1 25"],
    ["rock’n’roll", "rocknroll"],
  ])("accepts specified equivalence: %s", (a, b) => {
    expect(compare(a, b)).toMatchObject({ S: 0, D: 0, I: 0, accuracy: 100 });
  });
  it.each([
    ["I had a very good seat.", "I had a good seat.", { D: 1, I: 0, S: 0 }],
    ["I had a good seat.", "I had a good good seat.", { D: 0, I: 1, S: 0 }],
    ["had", "have", { D: 0, I: 0, S: 1 }],
    ["theatre", "theater", { S: 1 }],
    ["Don't stop.", "do not stop", { S: 1, I: 1 }],
    ["café", "cafe", { S: 1 }],
    ["one' two", "one two", { S: 0, I: 0, D: 0 }],
  ])("reports edit counts: %s vs %s", (a, b, counts) => {
    expect(compare(a, b)).toMatchObject(counts);
  });
  it("maps supplementary characters, composition, ligature expansion and apostrophes to code points", () => {
    const text = "😀 e\u0301 ﬁ don’t 𐐀";
    const prepared = prepare(text);
    expect(prepared.units.map((u) => [u.key, u.sourceRange])).toEqual([
      ["é", { start: 2, end: 4 }],
      ["fi", { start: 5, end: 6 }],
      ["dont", { start: 7, end: 12 }],
      ["𐐨", { start: 13, end: 14 }],
    ]);
    prepared.units.forEach((u) =>
      expect(
        points(text).slice(u.sourceRange.start, u.sourceRange.end).join(""),
      ).toBe(u.displayText),
    );
  });
  it("uses fixed diagonal priority on repeated words and equal-cost paths", () => {
    expect(compare("a a", "a").operations.map((o) => o.kind)).toEqual([
      "delete",
      "match",
    ]);
    expect(compare("a b", "b a").operations.map((o) => o.kind)).toEqual([
      "substitute",
      "substitute",
    ]);
    expect(compare("a", "a b c d")).toMatchObject({ N: 1, I: 3, accuracy: 0 });
  });
  it("attributes missing whole sentences and start/end insertions", () => {
    const ref = english.prepare("a b\nc d\ne f", [
      { id: "s1", order: 0, start: 0, end: 3 },
      { id: "s2", order: 1, start: 4, end: 7 },
      { id: "s3", order: 2, start: 8, end: 11 },
    ]);
    const result = english.comparePrepared(ref, prepare("x a b e f z"));
    expect(result.sentenceResults).toMatchObject([
      { sentenceId: "s1", I: 1 },
      { sentenceId: "s2", D: 2 },
      { sentenceId: "s3", I: 1 },
    ]);
  });
  it("rejects empty references and bounds alignment allocation", () => {
    expect(() => compare("!!!", "a")).toThrow();
    expect(() => compare("a ".repeat(4000), "b ".repeat(4000))).toThrow("过长");
  });
  it("rejects invalid and overlapping original ranges without silently slicing", () => {
    for (const sentences of [
      [{ id: "s", order: 0, start: -1, end: 2 }],
      [{ id: "s", order: 0, start: 0, end: 8 }],
      [{ id: "s", order: 0, start: 1, end: 1 }],
      [
        { id: "s", order: 0, start: 0, end: 2 },
        { id: "t", order: 1, start: 1, end: 3 },
      ],
    ])
      expect(() => english.prepare("abc", sentences)).toThrow("范围");
  });
  it("builds hints from normalized units", () => {
    expect(
      english.buildHint("I had a very good seat.", {
        id: "s",
        order: 0,
        start: 0,
        end: 23,
      }).fragments,
    ).toEqual(["i", "h", "a", "v", "g", "s"]);
  });
});
describe("Shared sentence session contract", () => {
  it("preserves hint exposure, first results, skips and correct rewrites", () => {
    const text = lesson();
    let state = beginSession(text, english, { id: "session", now });
    let n = 0;
    const send = (event: Event) => {
      state = reduceSession(state, event, text, english, now);
      expect(validateSession(state, text)).toEqual(state);
    };
    const submit = () =>
      send({ kind: "submit", attemptId: `a${n}`, requestId: `r${n++}` });
    send({ kind: "hint", visible: true });
    send({ kind: "hint", visible: false });
    send({ kind: "input", text: "I had a very good seat" });
    submit();
    send({ kind: "next" });
    send({ kind: "input", text: "do not stop" });
    submit();
    send({ kind: "rewrite" });
    expect(state).toMatchObject({
      input: "",
      answerSeen: true,
      status: "answering",
    });
    send({ kind: "input", text: "dont stop" });
    submit();
    send({ kind: "next" });
    send({ kind: "skip", requestId: "skip", attemptId: "skip" });
    send({ kind: "next" });
    expect(summarize(state)).toMatchObject({
      independent: 0,
      hinted: 1,
      errors: 1,
      skipped: 1,
      retries: 1,
      retryCorrect: 1,
      wrongIds: ["s1", "s2"],
    });
    expect(state.status).toBe("completed");
    expect(() => send({ kind: "rewrite" })).toThrow();
  });
  it("requires valid input, check before navigation, preserves request identity and validates corruption", () => {
    const text = lesson();
    const state = beginSession(text, english, { id: "s", now });
    expect(() =>
      reduceSession(state, { kind: "next" }, text, english, now),
    ).toThrow();
    expect(() =>
      reduceSession(
        { ...state, input: "!!!" },
        { kind: "submit", requestId: "r", attemptId: "a" },
        text,
        english,
        now,
      ),
    ).toThrow("有效");
    const checked = reduceSession(
      { ...state, input: "I had a very good seat" },
      { kind: "submit", requestId: "r", attemptId: "a" },
      text,
      english,
      now,
    );
    expect(
      reduceSession(
        checked,
        { kind: "submit", requestId: "r", attemptId: "different" },
        text,
        english,
        now,
      ),
    ).toBe(checked);
    for (const bad of [
      { ...checked, index: 8 },
      { ...checked, schemaVersion: 99 },
      { ...checked, lessonRevisionId: "other" },
      { ...checked, attempts: [...checked.attempts, ...checked.attempts] },
      {
        ...checked,
        attempts: [
          {
            ...checked.attempts[0],
            result: { ...checked.attempts[0].result, accuracy: 42 },
          },
        ],
      },
    ])
      expect(() => validateSession(bad, text)).toThrow();
  });
  it("shares the engine with a character module and structured non-initial hints", () => {
    const module: TrainingLanguage = {
      ...english,
      languageId: "test",
      moduleRef: { moduleId: "test", moduleVersion: "1", profileVersion: "1" },
      comparisonProfileId: "chars",
      unitKind: "grapheme",
      unitLabel: "字",
      hintLabel: "遮盖",
      accuracyLabel: "字符准确度",
      prepare(text, sentences) {
        return {
          text,
          units: points(text).map((char, i) => ({
            key: char,
            displayText: char,
            sourceRange: { start: i, end: i + 1 },
            sentenceId: sentences[0].id,
          })),
        };
      },
      buildHint() {
        return {
          kind: "mask",
          label: "遮盖",
          textDirection: "rtl",
          fragments: ["□", "乙"],
        };
      },
      comparePrepared(a, b) {
        return aggregateResult(a, b, module);
      },
    };
    const text = {
      ...lesson("甲乙"),
      languageId: "test",
      moduleRef: module.moduleRef,
    };
    let state = beginSession(text, module, { id: "s", now });
    state = reduceSession(
      state,
      { kind: "input", text: "甲乙" },
      text,
      module,
      now,
    );
    state = reduceSession(
      state,
      { kind: "submit", requestId: "r", attemptId: "a" },
      text,
      module,
      now,
    );
    expect(state.attempts[0].result).toMatchObject({
      unitKind: "grapheme",
      N: 2,
      accuracy: 100,
    });
    expect(module.buildHint("甲乙", text.sentences[0]).fragments).toEqual([
      "□",
      "乙",
    ]);
    expect(validateSession(state, text)).toEqual(state);
  });
});
