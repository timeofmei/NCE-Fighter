import { expect, it } from "vitest";
import { lesson, now } from "../fixtures/training";
import { characterLanguage } from "../fixtures/character-language";
import { english } from "../../app/languages/english";
import {
  beginSession,
  reduceSession,
  validateSession,
  type Event,
  type Recognition,
} from "../../app/core/training";

it("aligns the whole body despite missing sentences, changed line breaks and extra edge words", () => {
  const text = lesson();
  const state = beginSession(
    text,
    english,
    { id: "full", now },
    { mode: "full_dictation" },
  );
  const event = {
    kind: "submit" as const,
    requestId: "request",
    attemptId: "attempt",
    text: "extra I had a very good seat Hello world end",
  };
  const result = reduceSession(state, event, text, english, now);
  expect(result).toMatchObject({
    status: "completed",
    input: event.text,
    completedAt: now,
  });
  expect(result.attempts[0]).toMatchObject({
    sentenceId: null,
    result: {
      N: 10,
      D: 2,
      I: 2,
      S: 0,
      sentenceResults: [
        { sentenceId: "s0", I: 1 },
        { sentenceId: "s1", D: 2 },
        { sentenceId: "s2", I: 1 },
      ],
    },
  });
  expect(validateSession(result, text)).toEqual(result);
  expect(reduceSession(result, event, text, english, now)).toBe(result);
  expect(() =>
    reduceSession(
      result,
      { kind: "save-draft", text: "old" },
      text,
      english,
      now,
    ),
  ).toThrow();
  for (const changed of [
    "Hello world\nI had a very good seat",
    "I had a very good seat dont stop Hello world Hello world",
  ]) {
    expect(
      validateSession(
        reduceSession(state, { ...event, text: changed }, text, english, now),
        text,
      ),
    ).toBeDefined();
  }
});

it.each([english, characterLanguage])(
  "shares all modes with $languageId, including recognition cancellation and corrections",
  (module) => {
    const text = {
      ...lesson(
        module === english
          ? "Don't stop.\nHello,world!"
          : "甲乙。\ne\u0301丙！",
      ),
      languageId: module.languageId,
      moduleRef: module.moduleRef,
    };
    for (const options of [
      { mode: "sentence_dictation" as const },
      { mode: "full_dictation" as const },
      { mode: "full_dictation" as const, inputKind: "handwriting" as const },
      { mode: "recitation" as const },
    ]) {
      let state = beginSession(text, module, { id: "session", now }, options);
      const send = (event: Event) => {
        state = reduceSession(state, event, text, module, now);
        validateSession(state, text);
      };
      if (state.inputKind !== "keyboard") {
        if (state.mode === "recitation") send({ kind: "record" });
        send({ kind: "recognize", taskId: "old" });
        send({ kind: "cancel-recognition" });
        const recognition: Recognition = {
          languageId: text.languageId,
          sourceRef: "fixed-source",
          rawTranscript: "wrong",
          editedTranscript: "wrong",
          wasEdited: false,
          warnings: [],
          providerMetadata: null,
        };
        const cancelled = state;
        send({ kind: "recognized", taskId: "old", recognition });
        expect(state).toBe(cancelled);
        if (state.mode === "recitation") send({ kind: "record" });
        send({ kind: "recognize", taskId: "failed" });
        send({ kind: "recognition-failed", taskId: "failed" });
        if (state.mode === "recitation") send({ kind: "record" });
        send({ kind: "recognize", taskId: "new" });
        expect(() =>
          send({
            kind: "recognized",
            taskId: "new",
            recognition: { ...recognition, languageId: "other" },
          }),
        ).toThrow();
        send({ kind: "recognized", taskId: "new", recognition });
        send({ kind: "confirm-text", text: text.body });
        send({ kind: "submit", requestId: "r", attemptId: "a" });
        expect(state.attempts[0]).toMatchObject({
          rawText: "wrong",
          confirmedText: text.body,
          recognition: { wasEdited: true },
          result: { accuracy: 100 },
        });
      } else if (state.mode === "full_dictation") {
        send({ kind: "save-draft", text: text.body });
        expect(state.attempts).toEqual([]);
        send({ kind: "submit", requestId: "r", attemptId: "a" });
      } else {
        send({ kind: "hint", visible: true });
        send({
          kind: "submit",
          requestId: "r",
          attemptId: "a",
          text: text.body.split("\n")[0],
        });
        send({ kind: "rewrite" });
        send({ kind: "skip", requestId: "skip", attemptId: "skip" });
        send({ kind: "next" });
        send({
          kind: "submit",
          requestId: "r2",
          attemptId: "a2",
          text: text.body.split("\n")[1],
        });
        send({ kind: "next" });
      }
      expect(state.status).toBe("completed");
      expect(state.attempts.at(-1)!.result).toMatchObject({
        unitKind: module.unitKind,
        accuracy: 100,
      });
    }
  },
);

it("rejects corrupted whole-body mappings, counts, states and hidden hint flags without recomparing", () => {
  const text = lesson();
  const state = reduceSession(
    beginSession(text, english, { id: "s", now }, { mode: "full_dictation" }),
    { kind: "submit", requestId: "r", attemptId: "a", text: text.body },
    text,
    english,
    now,
  );
  for (const change of [
    (s: typeof state) => {
      s.status = "checked";
    },
    (s: typeof state) => {
      s.hintUsed = true;
    },
    (s: typeof state) => {
      s.attempts[0].result!.operations[0].reference!.sourceRange.end = 999;
    },
    (s: typeof state) => {
      s.attempts[0].result!.operations[0].sentenceId = "s2";
    },
    (s: typeof state) => {
      s.attempts[0].result!.sentenceResults[1].N++;
    },
  ]) {
    const bad = structuredClone(state);
    change(bad);
    expect(() => validateSession(bad, text)).toThrow();
  }
});
