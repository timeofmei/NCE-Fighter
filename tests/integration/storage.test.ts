import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbStore } from "../../app/adapters/storage";
import { analyze, confirm, type Draft } from "../../app/core/lesson";
import { registry } from "../../app/languages/registry";

const language = registry.resolve("en");
const draft: Draft = {
  schemaVersion: 1,
  id: "d1",
  languageId: "en",
  moduleRef: language.moduleRef,
  title: "Draft",
  body: "Hello\n😀 World",
  sourceRefs: [],
  boundaryWarnings: [],
  sentences: analyze("Hello\n😀 World", language).sentences.map((s) => ({
    ...s,
    id: `s${s.order}`,
  })),
  updatedAt: "2026-10-11T00:00:00Z",
};
const snapshot = () =>
  confirm(draft, registry, {
    revisionId: "r1",
    sentenceId: (order) => `s${order}`,
    now: draft.updatedAt,
  });
let factory: IDBFactory;
let store: IndexedDbStore;
beforeEach(() => {
  factory = new IDBFactory();
  store = new IndexedDbStore(() => factory, "test");
});
describe("IndexedDB transaction and recovery", () => {
  it("recovers exact drafts from a fresh adapter", async () => {
    await store.saveDraft(draft);
    expect(
      await new IndexedDbStore(() => factory, "test").draft(draft.id),
    ).toEqual(draft);
  });
  it("atomically confirms and removes a draft; retries and concurrent clicks are idempotent", async () => {
    await store.saveDraft(draft);
    await Promise.all([
      store.confirm(draft.id, snapshot()),
      store.confirm(draft.id, snapshot()),
    ]);
    expect(await store.list()).toEqual({ drafts: [], lessons: [snapshot()] });
    expect(await store.lesson(draft.id)).toEqual(snapshot());
  });
  it("does not update a confirmed snapshot or resurrect its draft", async () => {
    await store.confirm(draft.id, snapshot());
    await expect(
      store.confirm(draft.id, { ...snapshot(), title: "Changed" }),
    ).rejects.toThrow("课文已确认");
    await expect(store.saveDraft(draft)).rejects.toThrow("课文已确认");
    expect(await store.lesson(draft.id)).toEqual(snapshot());
  });
  it("distinguishes missing records from open failures", async () => {
    expect(await store.lesson("missing")).toBeUndefined();
    const failing = new IndexedDbStore(() => {
      throw new Error("denied");
    });
    await expect(failing.lesson("missing")).rejects.toThrow("存储失败");
  });
  it("deletes only the requested draft, supports retries, and preserves confirmed lessons", async () => {
    await store.saveDraft(draft);
    const other = { ...draft, id: "other" };
    await store.saveDraft(other);
    const confirmed = { ...snapshot(), lessonId: "confirmed" };
    await store.confirm("confirmed", confirmed);
    await Promise.all([
      store.deleteDraft(draft.id),
      store.deleteDraft(draft.id),
    ]);
    expect(
      await new IndexedDbStore(() => factory, "test").draft(draft.id),
    ).toBeUndefined();
    expect(await store.list()).toEqual({
      drafts: [other],
      lessons: [confirmed],
    });
    await store.deleteDraft("confirmed");
    expect(await store.lesson("confirmed")).toEqual(confirmed);
  });
  it("rolls back confirmation and draft deletion when the transaction aborts", async () => {
    await store.saveDraft(draft);
    const open = factory.open.bind(factory);
    factory.open = (...args: Parameters<IDBFactory["open"]>) => {
      const req = open(...args);
      req.addEventListener("success", () => {
        const db = req.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (
          ...params: Parameters<IDBDatabase["transaction"]>
        ) => {
          const tx = transaction(...params);
          if (params[1] === "readwrite") {
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = (name) => {
              const os = objectStore(name);
              if (name === "drafts")
                os.delete = () => {
                  tx.abort();
                  throw new Error("injected abort after insertion");
                };
              return os;
            };
          }
          return tx;
        };
      });
      return req;
    };
    await expect(store.confirm(draft.id, snapshot())).rejects.toThrow(
      "存储失败",
    );
    await expect(store.deleteDraft(draft.id)).rejects.toThrow("存储失败");
    factory.open = open;
    expect(await store.list()).toEqual({ drafts: [draft], lessons: [] });
    await store.confirm(draft.id, snapshot());
    expect(await store.list()).toEqual({ drafts: [], lessons: [snapshot()] });
  });
  it("rejects unknown versions on restore without overwriting data", async () => {
    await store.saveDraft(draft);
    await new Promise<void>((resolve) => {
      const req = factory.open("test", 2);
      req.onsuccess = () => {
        const tx = req.result.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put({ ...draft, schemaVersion: 99 });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    await expect(store.list()).rejects.toThrow("版本不受支持");
  });
});
