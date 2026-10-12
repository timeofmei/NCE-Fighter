import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import sample from "../fixtures/stage03-user-data.json";
import { beforeEach, expect, it, vi } from "vitest";
import { IndexedDbStore } from "../../app/adapters/storage";
import { analyze, type Draft } from "../../app/core/lesson";
import { lesson, now } from "../fixtures/training";
import { english } from "../../app/languages/english";
import { characterLanguage } from "../fixtures/character-language";
import { registry } from "../../app/languages/registry";
import {
  recognizeInput,
  type RecognitionAdapter,
} from "../../app/core/recognition";
import { type UserData } from "../../app/core/user-data";
let store: IndexedDbStore;
beforeEach(() => {
  const factory = new IDBFactory();
  store = new IndexedDbStore(() => factory, "data");
});

it("imports the published acceptance sample with three modes and an explicit full draft", async () => {
  await store.importData(sample);
  expect((await store.list()).drafts).toHaveLength(1);
  expect((await store.list()).lessons).toHaveLength(1);
  const sessions = await store.sessions();
  expect(sessions).toHaveLength(4);
  expect(new Set(sessions.map((s) => s.mode)).size).toBe(3);
  expect(sessions.find((s) => s.status === "answering")!.input).toBe(
    "I had a very good seat",
  );
});
function draft(id = "draft", body = "!!!\n\nLesson 1\nLesson 2"): Draft {
  return {
    schemaVersion: 1,
    id,
    languageId: "en",
    moduleRef: english.moduleRef,
    title: "Draft",
    body,
    sourceRefs: [],
    boundaryWarnings: [],
    sentences: analyze(body, english).sentences.map((s) => ({
      ...s,
      id: `${id}-${s.order}`,
    })),
    updatedAt: now,
  };
}
async function seed() {
  await store.confirm("lesson", lesson());
  await store.saveDraft(draft());
  const s = await store.startSession(
    "lesson",
    { id: "full", now },
    { mode: "full_dictation" },
  );
  await store.updateSession(
    s.id,
    s.version,
    { kind: "save-draft", text: "saved whole body" },
    now,
  );
}
it("roundtrips all saved data, preserves draft state, replaces UUIDs and retains local-only records", async () => {
  await seed();
  const original = await store.exportData();
  expect(original).toMatchObject({
    app: "nce-fighter",
    system: { name: null, version: null },
    schemaVersion: 1,
  });
  const factory = new IDBFactory(),
    target = new IndexedDbStore(() => factory, "target");
  await target.saveDraft(draft("local"));
  await target.importData(JSON.parse(JSON.stringify(original)));
  expect((await target.list()).drafts).toHaveLength(2);
  expect((await target.session("full"))!.session).toMatchObject({
    input: "saved whole body",
    mode: "full_dictation",
    status: "answering",
    attempts: [],
  });
  const restored = (await target.session("full"))!.session;
  await target.updateSession(
    restored.id,
    restored.version,
    { kind: "submit", requestId: "r", attemptId: "a", text: lesson().body },
    now,
    restored.generation,
  );
  await target.importData(original);
  expect((await target.session("full"))!.session.status).toBe("answering");
  await target.importData(original);
  expect(await target.sessions()).toHaveLength(1);
  expect((await target.list()).drafts.find((d) => d.id === "draft")!.body).toBe(
    draft().body,
  );
});
it("invalidates pre-import writes, including a previously successful submission and open draft", async () => {
  await seed();
  const old = (await store.session("full"))!.session,
    file = await store.exportData();
  const event = {
    kind: "submit" as const,
    requestId: "r",
    attemptId: "a",
    text: lesson().body,
  };
  await store.updateSession(old.id, old.version, event, now);
  await store.importData(file);
  await expect(
    store.updateSession(old.id, old.version, event, now),
  ).rejects.toThrow();
  await expect(
    store.saveDraft({ ...draft(), body: "", sentences: [] }),
  ).rejects.toThrow();
  await expect(
    store.confirm("draft", { ...lesson("One"), lessonId: "draft" }),
  ).rejects.toThrow();
  expect((await store.session("full"))!.session.input).toBe("saved whole body");
});
it("replaces draft and lesson states using their common ID and rolls back incompatible dependencies", async () => {
  await store.saveDraft(draft("lesson"));
  const file: UserData = {
    app: "nce-fighter",
    schemaVersion: 1,
    system: { name: "Other", version: null },
    drafts: [],
    lessons: [lesson()],
    sessions: [],
  };
  await store.importData(file);
  expect((await store.list()).drafts).toEqual([]);
  await store.importData({ ...file, lessons: [], drafts: [draft("lesson")] });
  expect((await store.list()).lessons).toEqual([]);
  await store.importData(file);
  await store.startSession("lesson", { id: "s", now });
  await expect(
    store.importData({ ...file, lessons: [], drafts: [draft("lesson")] }),
  ).rejects.toThrow();
  expect((await store.list()).lessons).toHaveLength(1);
});
it("rejects unknown versions, duplicates, missing language, corrupt ranges and invalid references atomically", async () => {
  await seed();
  const valid = await store.exportData();
  const mutations = [
    (d: UserData) => {
      (d as { schemaVersion: number }).schemaVersion = 99;
    },
    (d: UserData) => {
      d.lessons.push(d.lessons[0]);
    },
    (d: UserData) => {
      d.drafts[0].languageId = "";
    },
    (d: UserData) => {
      d.lessons[0].sentences[0].end = 999;
    },
    (d: UserData) => {
      d.sessions[0].lessonRevisionId = "missing";
    },
    (d: UserData) => {
      d.sessions[0].sourceSessionId = "missing";
    },
    (d: UserData) => {
      d.sessions[0].languageId = "other";
    },
  ];
  for (const change of mutations) {
    const bad = structuredClone(valid);
    change(bad);
    await expect(store.importData(bad)).rejects.toThrow();
    expect(await store.exportData()).toEqual(valid);
  }
});
it("rolls back every write when storage aborts partway through recovery", async () => {
  await seed();
  const before = await store.exportData();
  const incoming = { ...before, drafts: [draft("new")] };
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === "sessions") {
        this.transaction.abort();
        throw new Error("injected recovery failure");
      }
      return original.apply(this, args);
    });
  try {
    await expect(store.importData(incoming)).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  expect(await store.exportData()).toEqual(before);
});
it("restores missing historical modules without recomputing results or enabling new training", async () => {
  await seed();
  const s = (await store.session("full"))!.session;
  await store.updateSession(
    s.id,
    s.version,
    { kind: "submit", requestId: "r", attemptId: "a", text: lesson().body },
    now,
  );
  const file = await store.exportData();
  for (const item of [...file.drafts, ...file.lessons, ...file.sessions])
    item.moduleRef.moduleVersion = "missing";
  file.sessions[0].attempts[0].result!.moduleRef.moduleVersion = "missing";
  await store.importData(file);
  expect(
    (await store.session("full"))!.session.attempts[0].result!.accuracy,
  ).toBe(100);
  await expect(
    store.startSession("lesson", { id: "new", now }),
  ).rejects.toThrow();
  expect((await store.draft("draft"))!.moduleRef.moduleVersion).toBe("missing");
});

it("uses fixed OCR/ASR adapters with language propagation, unchanged confirmation, failures and late cancellation", async () => {
  const resolve = registry.resolve;
  const spy = vi
    .spyOn(registry, "resolve")
    .mockImplementation((id, ref) =>
      id === characterLanguage.languageId
        ? characterLanguage
        : resolve(id, ref),
    );
  try {
    const text = {
      ...lesson("甲乙。\ne\u0301丙！"),
      languageId: characterLanguage.languageId,
      moduleRef: characterLanguage.moduleRef,
    };
    await store.confirm(text.lessonId, text);
    for (const inputKind of ["handwriting", "speech"] as const) {
      let s = await store.startSession(
        text.lessonId,
        { id: inputKind, now },
        {
          mode: inputKind === "speech" ? "recitation" : "full_dictation",
          inputKind,
        },
      );
      if (inputKind === "speech")
        s = await store.updateSession(s.id, s.version, { kind: "record" }, now);
      s = await store.updateSession(
        s.id,
        s.version,
        { kind: "recognize", taskId: "task" },
        now,
      );
      const adapter: RecognitionAdapter = {
        recognize: async (input) => {
          expect(input.languageId).toBe(text.languageId);
          return {
            languageId: input.languageId,
            sourceRef: input.sourceRef,
            rawTranscript: text.body,
            editedTranscript: text.body,
            wasEdited: false,
            warnings: [],
            providerMetadata: { provider: "fixed-test" },
          };
        },
      };
      const input = {
        sourceRef: "fixed",
        languageId: text.languageId,
        inputKind,
        taskId: "task",
      };
      const controller = new AbortController();
      const result = await recognizeInput(adapter, input, controller.signal);
      s = await store.updateSession(s.id, s.version, result.event, now);
      s = await store.updateSession(
        s.id,
        s.version,
        { kind: "confirm-text", text: text.body },
        now,
      );
      await store.updateSession(
        s.id,
        s.version,
        { kind: "submit", requestId: "r", attemptId: "a" },
        now,
      );
      const failure = await recognizeInput(
        {
          recognize: async () => {
            throw new Error("fixed failure");
          },
        },
        input,
        controller.signal,
      );
      expect(failure.error).toContain("RECOGNITION_FAILED");
      const cancelled = await recognizeInput(
        {
          recognize: async (...args) => {
            controller.abort();
            return adapter.recognize(...args);
          },
        },
        input,
        controller.signal,
      );
      expect(cancelled.error).toBe("CANCELLED");
    }
    const file = await store.exportData();
    spy.mockRestore();
    const factory = new IDBFactory(),
      target = new IndexedDbStore(() => factory, "target");
    await target.importData(file);
    for (const s of await target.sessions())
      expect(s.attempts[0]).toMatchObject({
        recognition: { wasEdited: false },
        result: { unitKind: "grapheme", N: 4, accuracy: 100 },
      });
  } finally {
    spy.mockRestore();
  }
});

it("imports and exports thousands of records without a total-count rejection threshold", async () => {
  const data: UserData = {
    app: "nce-fighter",
    schemaVersion: 1,
    system: { name: null, version: null },
    drafts: Array.from({ length: 3000 }, (_, i) => draft(`draft-${i}`, "One")),
    lessons: [],
    sessions: [],
  };
  await store.importData(data);
  expect((await store.exportData()).drafts).toHaveLength(3000);
});

it("exports one consistent snapshot while another adapter confirms a draft", async () => {
  await store.saveDraft(draft("lesson", lesson().body));
  const [snapshot] = await Promise.all([
    store.exportData(),
    store.confirm("lesson", lesson()),
  ]);
  expect(snapshot.drafts.length + snapshot.lessons.length).toBe(1);
  expect((await store.exportData()).lessons).toHaveLength(1);
});

it("roundtrips wrong-sentence practice links and preserves practice when its source is deleted", async () => {
  await store.confirm("lesson", lesson());
  let source = await store.startSession("lesson", { id: "source", now });
  for (let i = 0; i < 3; i++) {
    source = await store.updateSession(
      source.id,
      source.version,
      { kind: "skip", requestId: `r${i}`, attemptId: `a${i}` },
      now,
    );
    source = await store.updateSession(
      source.id,
      source.version,
      { kind: "next" },
      now,
    );
  }
  await store.startSession(
    "lesson",
    { id: "practice", now },
    { sourceSessionId: "source" },
  );
  const file = await store.exportData();
  await store.importData(file);
  const practice = (await store.session("practice"))!.session;
  expect(practice.sourceSessionId).toBe("source");
  await store.deleteSession("source");
  expect((await store.session("practice"))!.session).toMatchObject({
    sourceSessionId: null,
    sentenceIds: practice.sentenceIds,
    attempts: practice.attempts,
  });
  await expect(
    store.updateSession(
      practice.id,
      practice.version,
      { kind: "input", text: "late" },
      now,
      practice.generation,
    ),
  ).rejects.toThrow();
});
