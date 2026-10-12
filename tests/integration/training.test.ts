import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, expect, it } from "vitest";
import { IndexedDbStore } from "../../app/adapters/storage";
import { lesson, now } from "../fixtures/training";
let factory: IDBFactory, store: IndexedDbStore;
beforeEach(async () => {
  factory = new IDBFactory();
  store = new IndexedDbStore(() => factory, "training");
  await store.confirm("lesson", lesson());
});
it("recovers input, sticky hints, checked, answering and completed across adapters", async () => {
  await store.startSession("lesson", { id: "s", now });
  let state = await store.updateSession(
    "s",
    0,
    { kind: "input", text: "I had a good seat" },
    now,
  );
  state = await store.updateSession(
    "s",
    state.version,
    { kind: "hint", visible: true },
    now,
  );
  state = await store.updateSession(
    "s",
    state.version,
    { kind: "hint", visible: false },
    now,
  );
  expect(
    (await new IndexedDbStore(() => factory, "training").session("s"))?.session,
  ).toMatchObject({
    input: "I had a good seat",
    hintUsed: true,
    hintVisible: false,
  });
  state = await store.updateSession(
    "s",
    state.version,
    { kind: "submit", requestId: "r", attemptId: "a" },
    now,
  );
  expect((await store.session("s"))?.session.status).toBe("checked");
  state = await store.updateSession("s", state.version, { kind: "next" }, now);
  expect((await store.session("s"))?.session).toMatchObject({
    index: 1,
    status: "answering",
    input: "",
    answerSeen: false,
  });
  for (let i = 1; i < 3; i++) {
    state = await store.updateSession(
      "s",
      state.version,
      { kind: "skip", requestId: `r${i}`, attemptId: `a${i}` },
      now,
    );
    state = await store.updateSession(
      "s",
      state.version,
      { kind: "next" },
      now,
    );
  }
  expect((await store.session("s"))?.session.status).toBe("completed");
  const retry = await store.startSession(
    "lesson",
    { id: "retry", now },
    { sourceSessionId: "s" },
  );
  expect(retry.sentenceIds).toEqual(["s0", "s1", "s2"]);
  expect((await store.session("s"))?.session).toEqual(state);
  expect(await store.lesson("lesson")).toEqual(lesson());
});
it("deduplicates successful requests and rejects stale drafts and concurrent updates", async () => {
  await store.startSession("lesson", { id: "s", now });
  const state = await store.updateSession(
    "s",
    0,
    { kind: "input", text: "I had a very good seat" },
    now,
  );
  const event = { kind: "submit" as const, requestId: "r", attemptId: "a" };
  const [a, b] = await Promise.all([
    store.updateSession("s", state.version, event, now),
    store.updateSession("s", state.version, event, now),
  ]);
  expect(a).toEqual(b);
  expect(a.attempts).toHaveLength(1);
  await expect(
    store.updateSession(
      "s",
      state.version,
      { kind: "input", text: "old" },
      now,
    ),
  ).rejects.toThrow("其他窗口");
  await expect(
    store.updateSession("s", a.version, { kind: "input", text: "old" }, now),
  ).rejects.toThrow("已提交");
});
it("aborts atomic submit without losing input, retries the same request", async () => {
  await store.startSession("lesson", { id: "s", now });
  await store.updateSession(
    "s",
    0,
    { kind: "input", text: "I had a good seat" },
    now,
  );
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    if (this.name === "sessions") {
      this.transaction.abort();
      throw new Error("injected");
    }
    return original.apply(this, args);
  };
  const event = { kind: "submit" as const, requestId: "r", attemptId: "a" };
  try {
    await expect(store.updateSession("s", 1, event, now)).rejects.toThrow(
      "存储失败",
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  expect((await store.session("s"))?.session).toMatchObject({
    input: "I had a good seat",
    status: "answering",
    attempts: [],
  });
  await store.updateSession("s", 1, event, now);
  expect((await store.session("s"))?.session.attempts).toHaveLength(1);
});
async function corrupt(change: (record: Record<string, unknown>) => void) {
  await new Promise<void>((resolve, reject) => {
    const req = factory.open("training");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("sessions", "readwrite"),
        os = tx.objectStore("sessions"),
        get = os.get("s");
      get.onsuccess = () => {
        change(get.result);
        os.put(get.result);
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}
it("retains stored results when pinned modules disappear but blocks continuing", async () => {
  await store.startSession("lesson", { id: "s", now });
  // Both dependencies use the same unavailable pinned module; history remains interpretable.
  await new Promise<void>((resolve) => {
    const req = factory.open("training");
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction(["sessions", "lessons"], "readwrite");
      for (const [name, key] of [
        ["sessions", "s"],
        ["lessons", "lesson"],
      ]) {
        const os = tx.objectStore(name),
          get = os.get(key);
        get.onsuccess = () =>
          os.put({
            ...get.result,
            moduleRef: { ...get.result.moduleRef, moduleVersion: "missing" },
          });
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  expect((await store.session("s"))?.session.moduleRef.moduleVersion).toBe(
    "missing",
  );
  expect((await store.list()).lessons[0].moduleRef.moduleVersion).toBe(
    "missing",
  );
  expect((await store.lesson("lesson"))?.moduleRef.moduleVersion).toBe(
    "missing",
  );
  await expect(
    store.updateSession("s", 0, { kind: "input", text: "input" }, now),
  ).rejects.toThrow("版本不可用");
});
it("rejects corrupt records and missing dependencies without overwriting them", async () => {
  await store.startSession("lesson", { id: "s", now });
  await corrupt((record) => {
    record.sentenceIds = ["unknown"];
  });
  await expect(store.session("s")).rejects.toThrow("损坏");
  await expect(store.sessions("lesson")).rejects.toThrow("损坏");
});
it("rejects a missing lesson while retaining the session", async () => {
  await store.startSession("lesson", { id: "s", now });
  await new Promise<void>((resolve) => {
    const req = factory.open("training");
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("lessons", "readwrite");
      tx.objectStore("lessons").delete("lesson");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  await expect(store.session("s")).rejects.toThrow("缺失");
});
it("rejects a missing source session without inventing practice dependencies", async () => {
  await store.startSession("lesson", { id: "s", now });
  await corrupt((record) => {
    record.sourceSessionId = "missing";
  });
  await expect(store.session("s")).rejects.toThrow("来源训练缺失");
});
it("submits text and result atomically without a saved input draft", async () => {
  const state = await store.startSession("lesson", {
    id: "direct-submit",
    now,
  });
  const checked = await store.updateSession(
    state.id,
    state.version,
    {
      kind: "submit",
      requestId: "direct",
      attemptId: "direct",
      text: "I had a very good seat",
    },
    now,
  );
  expect(checked.version).toBe(state.version + 1);
  expect(checked.input).toBe("I had a very good seat");
  expect(checked.attempts[0].rawText).toBe(checked.input);
  expect((await store.session(state.id))?.session).toEqual(checked);
  const repeated = await store.updateSession(
    state.id,
    state.version,
    {
      kind: "submit",
      requestId: "direct",
      attemptId: "direct",
      text: "different late input",
    },
    now,
  );
  expect(repeated).toEqual(checked);
});

async function sourceAndPractice() {
  let state = await store.startSession("lesson", { id: "source", now });
  for (let i = 0; i < 3; i++) {
    state = await store.updateSession(
      state.id,
      state.version,
      { kind: "skip", requestId: `r${i}`, attemptId: `a${i}` },
      now,
    );
    state = await store.updateSession(
      state.id,
      state.version,
      { kind: "next" },
      now,
    );
  }
  return store.startSession(
    "lesson",
    { id: "practice", now },
    { sourceSessionId: "source" },
  );
}
it("deletes only selected sessions and detaches practice atomically without changing saved work", async () => {
  const practice = await sourceAndPractice();
  const child = await store.updateSession(
    practice.id,
    practice.version,
    { kind: "input", text: "saved practice input" },
    now,
  );
  await store.startSession("lesson", { id: "other", now });
  await store.deleteSession("source");
  await store.deleteSession("source");
  expect(await store.session("source")).toBeUndefined();
  expect((await store.session(child.id))?.session).toEqual({
    ...child,
    sourceSessionId: null,
    version: child.version + 1,
  });
  expect((await store.sessions("lesson")).map((s) => s.id).sort()).toEqual([
    "other",
    "practice",
  ]);
  expect(await store.lesson("lesson")).toEqual(lesson());
  await expect(
    store.updateSession(
      child.id,
      child.version,
      { kind: "input", text: "stale" },
      now,
    ),
  ).rejects.toThrow("其他窗口");
  const resumed = await store.updateSession(
    child.id,
    child.version + 1,
    { kind: "input", text: "resumed" },
    now,
  );
  expect(resumed.input).toBe("resumed");
});
it("rolls back deletion and unlinking together when the transaction aborts, then permits retry", async () => {
  const practice = await sourceAndPractice();
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (
    ...args: Parameters<IDBObjectStore["delete"]>
  ) {
    if (this.name === "sessions") {
      this.transaction.abort();
      throw new Error("injected delete abort");
    }
    return original.apply(this, args);
  };
  try {
    await expect(store.deleteSession("source")).rejects.toThrow("存储失败");
  } finally {
    IDBObjectStore.prototype.delete = original;
  }
  expect((await store.session("source"))?.session.status).toBe("completed");
  expect((await store.session("practice"))?.session).toEqual(practice);
  await store.deleteSession("source");
  expect((await store.session("practice"))?.session.sourceSessionId).toBeNull();
});
it("deleting an unfinished session prevents late save and submission from resurrecting it", async () => {
  const state = await store.startSession("lesson", { id: "s", now });
  await store.deleteSession("s");
  await expect(
    store.updateSession(
      "s",
      state.version,
      { kind: "input", text: "late" },
      now,
    ),
  ).rejects.toThrow("训练不存在");
  await expect(
    store.updateSession(
      "s",
      state.version,
      { kind: "submit", requestId: "late", attemptId: "late" },
      now,
    ),
  ).rejects.toThrow("训练不存在");
  expect(await store.sessions("lesson")).toEqual([]);
  expect(await store.lesson("lesson")).toEqual(lesson());
});
it("rejects stale answering writes and keeps sticky hint and newest input", async () => {
  await store.startSession("lesson", { id: "s", now });
  await store.updateSession("s", 0, { kind: "hint", visible: true }, now);
  await expect(
    store.updateSession("s", 0, { kind: "input", text: "old" }, now),
  ).rejects.toThrow("其他窗口");
  await store.updateSession("s", 1, { kind: "hint", visible: false }, now);
  await store.updateSession("s", 2, { kind: "input", text: "new" }, now);
  expect((await store.session("s"))?.session).toMatchObject({
    input: "new",
    hintVisible: false,
    hintUsed: true,
  });
});
