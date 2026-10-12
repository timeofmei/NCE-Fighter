import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, expect, it } from "vitest";
import { IndexedDbStore } from "../../app/adapters/storage";
import { mergeDrafts, splitDraft } from "../../app/core/document";
import { confirm } from "../../app/core/lesson";
import { english } from "../../app/languages/english";
import { registry } from "../../app/languages/registry";
import { batch, proposals } from "../fixtures/document";
let factory: IDBFactory, store: IndexedDbStore;
beforeEach(() => {
  factory = new IDBFactory();
  store = new IndexedDbStore(() => factory, "documents");
});
it("roundtrips file batches through schema 2 and preserves source after confirmation", async () => {
  const d = await store.saveDocumentDraft(proposals()[0], batch);
  const file = await store.exportData();
  expect(file.schemaVersion).toBe(2);
  expect(file.batches).toEqual([batch]);
  const stable = new IDBFactory(),
    restored = new IndexedDbStore(() => stable, "restore");
  await restored.importData(file);
  expect((await restored.draft(d.id))?.sourceRefs).toEqual(["page1", "page2"]);
  await store.confirm(
    d.id,
    confirm(d, registry, {
      revisionId: "r",
      sentenceId: (i) => `s${i}`,
      now: batch.createdAt,
    }),
    d.storageVersion,
  );
  expect((await store.lesson(d.id))?.batchId).toBe(batch.id);
  expect(await store.batch(batch.id)).toEqual(batch);
});
it("atomically merges saved drafts, replays a request and rejects late resurrection", async () => {
  const originals = await Promise.all(
    proposals().map((d) => store.saveDocumentDraft(d, batch)),
  );
  const merged = mergeDrafts(originals, english);
  const saved = await store.replaceDocumentDrafts(
    originals,
    [merged],
    batch,
    "merge",
  );
  expect(
    await store.replaceDocumentDrafts(originals, [merged], batch, "merge"),
  ).toEqual(saved);
  expect((await store.list()).drafts).toHaveLength(1);
  await expect(store.saveDocumentDraft(originals[1], batch)).rejects.toThrow();
  await expect(store.saveDocumentDraft(originals[0], batch)).rejects.toThrow();
  const split = splitDraft(saved[0], 1, "new", english);
  await store.replaceDocumentDrafts(saved, split, batch, "split");
  expect((await store.list()).drafts).toHaveLength(2);
});
it("rolls back all split writes and preserves original content after an injected abort", async () => {
  const d = await store.saveDocumentDraft(proposals()[0], batch),
    before = await store.exportData();
  const original = IDBObjectStore.prototype.put;
  let count = 0;
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    if (this.name === "drafts" && ++count === 2) {
      this.transaction.abort();
      throw new Error("injected");
    }
    return original.apply(this, args);
  };
  try {
    await expect(
      store.replaceDocumentDrafts(
        [d],
        splitDraft(d, 1, "new", english),
        batch,
        "split",
      ),
    ).rejects.toThrow();
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  expect(await store.exportData()).toEqual(before);
});
it("rejects missing sources, wrong language, duplicate batches and invalid JSON without partial writes", async () => {
  await store.saveDocumentDraft(proposals()[0], batch);
  const before = await store.exportData();
  for (const change of [
    (d: typeof before) => {
      d.batches = [];
    },
    (d: typeof before) => {
      d.drafts[0].sourceRefs = ["missing"];
    },
    (d: typeof before) => {
      d.batches![0].languageId = "other";
    },
    (d: typeof before) => {
      d.batches!.push(d.batches![0]);
    },
    (d: typeof before) => {
      d.schemaVersion = 1;
    },
    (d: typeof before) => {
      delete d.drafts[0].batchId;
      d.drafts[0].sourceRefs = [];
    },
  ]) {
    const data = structuredClone(before);
    change(data);
    // A standalone target prevents target dependencies from masking missing sources.
    const targetFactory = new IDBFactory(),
      target = new IndexedDbStore(() => targetFactory, "invalid");
    await expect(target.importData(data)).rejects.toThrow();
    expect((await target.list()).drafts).toEqual([]);
  }
  expect(await store.exportData()).toEqual(before);
});
it("cleans unused batches, rejects writes to deleted drafts and invalidates open writes after JSON restore", async () => {
  const d = await store.saveDocumentDraft(proposals()[0], batch),
    file = await store.exportData();
  await store.importData(file);
  await expect(store.saveDocumentDraft(d, batch)).rejects.toThrow();
  await store.deleteDraft(d.id);
  expect(await store.batch(batch.id)).toBeUndefined();
  await expect(store.saveDocumentDraft(d, batch)).rejects.toThrow();
  await store.importData(file);
  expect((await store.draft(d.id))!.storageVersion).toBeGreaterThan(
    d.storageVersion!,
  );
});
