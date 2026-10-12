import {
  historicalRegistry,
  validateUserData,
  type UserData,
} from "../core/user-data";
import {
  validateDraft,
  validateLesson,
  type Draft,
  type Lesson,
  type LessonStore,
} from "../core/lesson";
import { registry } from "../languages/registry";
import { trainingModule } from "../languages/registry";
import {
  validateBatch,
  validateDocumentLinks,
  type FileBatch,
} from "../core/document";
import {
  beginSession,
  reduceSession,
  summarize,
  validateSession,
  type Session,
  type Event,
} from "../core/training";

export const DATABASE_NAME = "nce-fighter";
export const DATABASE_VERSION = 3;
const advanceVersion = (...versions: number[]) => {
  const next = Math.max(...versions) + 1;
  if (!Number.isSafeInteger(next))
    throw new Error("写入版本无法更新，请检查导入数据。");
  return next;
};
const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export class IndexedDbStore implements LessonStore {
  constructor(
    private factory: () => IDBFactory = () => globalThis.indexedDB,
    private name = DATABASE_NAME,
  ) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.factory().open(this.name, DATABASE_VERSION);
      let blocked = false;
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of [
          ["drafts", "id"],
          ["lessons", "lessonId"],
          ["sessions", "id"],
          ["batches", "id"],
          ["mutations", "id"],
        ]) {
          if (!req.result.objectStoreNames.contains(name))
            req.result.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => {
        if (blocked) {
          req.result.close();
          return;
        }
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        blocked = true;
        reject(new Error("本地数据被其他窗口占用，请关闭其他窗口后重试。"));
      };
    });
  }
  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    let db: IDBDatabase | undefined;
    try {
      // Development-only, one-shot fault injection for the documented acceptance procedure.
      if (import.meta.env.DEV && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (url.searchParams.get("storageFailure") === "once") {
          url.searchParams.delete("storageFailure");
          window.history.replaceState(window.history.state, "", url);
          throw new Error("已模拟一次存储失败；点击重试即可恢复。");
        }
      }
      db = await this.open();
      const tx = db.transaction(stores, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(tx.error ?? new Error("本次保存未完成，请重试。"));
        tx.onerror = () => {
          /* onabort is the definitive transaction outcome */
        };
      });
      const work = action(tx).catch((error: unknown) => {
        try {
          tx.abort();
        } catch {
          /* transaction may already have aborted */
        }
        throw error;
      });
      const [result] = await Promise.all([work, done]);
      return result;
    } catch (error) {
      const detail =
        error instanceof DOMException
          ? error.name === "QuotaExceededError"
            ? "浏览器存储空间不足，请释放空间后重试。"
            : error.name === "SecurityError" || error.name === "NotAllowedError"
              ? "浏览器无法访问本地数据，请检查站点权限后重试。"
              : "请重试。"
          : error instanceof TypeError
            ? "浏览器无法访问本地数据，请重试。"
            : error instanceof Error
              ? error.message
              : "";
      throw new Error(`本地存储失败。${detail || "请重试。"}`, {
        cause: error,
      });
    } finally {
      db?.close();
    }
  }
  async list() {
    return this.transaction(["drafts", "lessons"], "readonly", async (tx) => {
      const [drafts, lessons] = await Promise.all([
        request(tx.objectStore("drafts").getAll()),
        request(tx.objectStore("lessons").getAll()),
      ]);
      return {
        drafts: drafts.map((draft) => validateDraft(draft, historicalRegistry)),
        lessons: lessons.map((lesson) => this.historicalLesson(lesson)),
      };
    });
  }
  async draft(id: string) {
    return this.transaction(["drafts"], "readonly", async (tx) => {
      const value: unknown = await request(tx.objectStore("drafts").get(id));
      return value === undefined
        ? undefined
        : validateDraft(value, historicalRegistry);
    });
  }
  async lesson(id: string) {
    return this.transaction(["lessons"], "readonly", async (tx) => {
      const value: unknown = await request(tx.objectStore("lessons").get(id));
      return value === undefined
        ? undefined
        : this.historicalLesson(value as Lesson);
    });
  }
  async saveDraft(draft: Draft) {
    validateDraft(draft, historicalRegistry);
    return this.transaction(
      ["drafts", "lessons", "mutations"],
      "readwrite",
      async (tx) => {
        if (
          await request(tx.objectStore("mutations").get(`retired:${draft.id}`))
        )
          throw new Error("草稿已被拆合或删除，请刷新。");
        if (draft.batchId) throw new Error("文件草稿须连同批次保存。");
        if (await request(tx.objectStore("lessons").get(draft.id)))
          throw new Error("课文已确认，请新建导入。");
        const previous: Draft | undefined = await request(
          tx.objectStore("drafts").get(draft.id),
        );
        if ((previous?.storageVersion ?? 0) !== (draft.storageVersion ?? 0))
          throw new Error("草稿已在其他窗口更新，请刷新后继续。");
        await request(tx.objectStore("drafts").put(draft));
      },
    );
  }
  async deleteDraft(id: string) {
    return this.transaction(
      ["drafts", "lessons", "batches", "mutations"],
      "readwrite",
      async (tx) => {
        const draft: Draft | undefined = await request(
          tx.objectStore("drafts").get(id),
        );
        if (draft)
          await request(
            tx
              .objectStore("mutations")
              .put({
                id: `retired:${id}`,
                version: advanceVersion(draft.storageVersion ?? 0),
              }),
          );
        await request(tx.objectStore("drafts").delete(id));
        await this.cleanBatches(tx);
      },
    );
  }
  async confirm(draftId: string, lesson: Lesson, expectedStorageVersion = 0) {
    validateLesson(lesson, registry);
    if (draftId !== lesson.lessonId)
      throw new Error("保存信息有误，请重新打开草稿。");
    return this.transaction(
      ["drafts", "lessons", "batches", "mutations"],
      "readwrite",
      async (tx) => {
        if (
          await request(tx.objectStore("mutations").get(`retired:${draftId}`))
        )
          throw new Error("草稿已被拆合或删除，请刷新。");
        const draft: Draft | undefined = await request(
          tx.objectStore("drafts").get(draftId),
        );
        if ((draft?.storageVersion ?? 0) !== expectedStorageVersion)
          throw new Error("草稿已在其他窗口更新，请刷新后继续。");
        const existing: unknown = await request(
          tx.objectStore("lessons").get(lesson.lessonId),
        );
        if (lesson.batchId) {
          const batch = await request(
            tx.objectStore("batches").get(lesson.batchId),
          );
          validateDocumentLinks(batch ? [batch] : [], [lesson]);
        }
        if (existing !== undefined) {
          validateLesson(existing, registry);
          if (JSON.stringify(existing) !== JSON.stringify(lesson))
            throw new Error("课文已确认，请新建导入。");
        } else await request(tx.objectStore("lessons").add(lesson));
        await request(tx.objectStore("drafts").delete(draftId));
      },
    );
  }
  async sessions(lessonId?: string): Promise<Session[]> {
    return this.transaction(["sessions", "lessons"], "readonly", async (tx) => {
      const values: Session[] = await request(
        tx.objectStore("sessions").getAll(),
      );
      const result: Session[] = [];
      for (const value of values.filter(
        (s) => !lessonId || s.lessonId === lessonId,
      )) {
        const lesson = await request(
          tx.objectStore("lessons").get(value.lessonId),
        );
        if (!lesson) throw new Error("训练课文缺失，记录已保留。");
        result.push(
          await this.trainingRecord(tx, value, this.historicalLesson(lesson)),
        );
      }
      return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }
  async deleteSession(id: string): Promise<void> {
    return this.transaction(["sessions"], "readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const values: Session[] = await request(sessions.getAll());
      for (const session of values) {
        if (session.sourceSessionId === id && session.id !== id) {
          // Preserve practice results; reject writes based on the previous linkage.
          await request(
            sessions.put({
              ...session,
              sourceSessionId: null,
              version: session.version + 1,
            }),
          );
        }
      }
      await request(sessions.delete(id));
    });
  }
  // Validate snapshots with their pinned metadata even when that module cannot load.
  private async trainingRecord(
    tx: IDBTransaction,
    value: unknown,
    lesson: Lesson,
  ): Promise<Session> {
    const session = validateSession(value, lesson);
    if (session.sourceSessionId) {
      if (session.sourceSessionId === session.id)
        throw new Error("训练记录损坏，无法恢复。");
      const value = await request(
        tx.objectStore("sessions").get(session.sourceSessionId),
      );
      if (!value) throw new Error("来源训练缺失，记录已保留。");
      const source = validateSession(value, lesson);
      if (
        source.status !== "completed" ||
        source.mode !== "sentence_dictation" ||
        session.mode !== "sentence_dictation" ||
        JSON.stringify(summarize(source).wrongIds) !==
          JSON.stringify(session.sentenceIds)
      )
        throw new Error("训练句子归属损坏，无法恢复。");
    }
    return session;
  }
  private historicalLesson(value: Lesson): Lesson {
    return validateLesson(value, historicalRegistry);
  }
  async session(
    id: string,
  ): Promise<{ session: Session; lesson: Lesson } | undefined> {
    return this.transaction(["sessions", "lessons"], "readonly", async (tx) => {
      const value: Session | undefined = await request(
        tx.objectStore("sessions").get(id),
      );
      if (!value) return undefined;
      const snapshot: Lesson | undefined = await request(
        tx.objectStore("lessons").get(value.lessonId),
      );
      if (!snapshot) throw new Error("训练课文缺失，记录已保留。");
      const lesson = this.historicalLesson(snapshot);
      return { lesson, session: await this.trainingRecord(tx, value, lesson) };
    });
  }
  async startSession(
    lessonId: string,
    host: { id: string; now: string },
    options: {
      mode?: Session["mode"];
      inputKind?: Session["inputKind"];
      hint?: boolean;
      sourceSessionId?: string;
    } = {},
  ): Promise<Session> {
    return this.transaction(
      ["sessions", "lessons"],
      "readwrite",
      async (tx) => {
        const value = await request(tx.objectStore("lessons").get(lessonId));
        if (!value) throw new Error("课文不存在。");
        const lesson = validateLesson(value, registry),
          module = trainingModule(lesson.languageId, lesson.moduleRef);
        const existing = await request(tx.objectStore("sessions").get(host.id));
        if (existing) {
          const saved = validateSession(existing, lesson);
          if (
            saved.sourceSessionId !== (options.sourceSessionId ?? null) ||
            saved.mode !== (options.mode ?? "sentence_dictation")
          )
            throw new Error("训练标识冲突。");
          return saved;
        }
        let sentenceIds: string[] | undefined;
        if (options.sourceSessionId) {
          const source = await request(
            tx.objectStore("sessions").get(options.sourceSessionId),
          );
          const original = validateSession(source, lesson);
          if (
            original.status !== "completed" ||
            original.mode !== "sentence_dictation" ||
            (options.mode && options.mode !== "sentence_dictation")
          )
            throw new Error("来源训练尚未完成。");
          sentenceIds = summarize(original).wrongIds;
        }
        const session = beginSession(lesson, module, host, {
          ...options,
          sentenceIds,
        });
        await request(tx.objectStore("sessions").add(session));
        return session;
      },
    );
  }
  private snapshot(
    tx: IDBTransaction,
    system: UserData["system"],
  ): Promise<UserData> {
    return Promise.all([
      request(tx.objectStore("drafts").getAll()),
      request(tx.objectStore("lessons").getAll()),
      request(tx.objectStore("sessions").getAll()),
      request(tx.objectStore("batches").getAll()),
    ]).then(([drafts, lessons, sessions, batches]) => ({
      app: "nce-fighter",
      schemaVersion: batches.length ? 2 : 1,
      ...(batches.length ? { batches } : {}),
      system,
      drafts,
      lessons,
      sessions,
    }));
  }
  async exportData(
    system: UserData["system"] = { name: null, version: null },
  ): Promise<UserData> {
    return this.transaction(
      ["drafts", "lessons", "sessions", "batches"],
      "readonly",
      async (tx) => validateUserData(await this.snapshot(tx, system)),
    );
  }
  async checkImport(value: unknown): Promise<UserData> {
    return this.transaction(
      ["drafts", "lessons", "sessions", "batches"],
      "readonly",
      async (tx) =>
        validateUserData(
          value,
          await this.snapshot(tx, { name: null, version: null }),
        ),
    );
  }
  async importData(value: unknown): Promise<void> {
    const incoming: unknown = structuredClone(value);
    return this.transaction(
      ["drafts", "lessons", "sessions", "batches", "mutations"],
      "readwrite",
      async (tx) => {
        const current = await this.snapshot(tx, { name: null, version: null });
        const data = validateUserData(incoming, current);
        for (const batch of data.batches ?? [])
          await request(tx.objectStore("batches").put(batch));
        const lessonVersions = new Map([
          ...current.drafts.map((d) => [d.id, d.storageVersion ?? 0] as const),
          ...current.lessons.map(
            (l) => [l.lessonId, l.storageVersion ?? 0] as const,
          ),
        ]);
        const previousSessions = new Map(
          current.sessions.map((s) => [s.id, s]),
        );
        for (const draft of data.drafts) {
          const retired = await request(
            tx.objectStore("mutations").get(`retired:${draft.id}`),
          );
          await request(
            tx.objectStore("mutations").delete(`retired:${draft.id}`),
          );
          await request(tx.objectStore("lessons").delete(draft.id));
          await request(
            tx.objectStore("drafts").put({
              ...draft,
              storageVersion: advanceVersion(
                lessonVersions.get(draft.id) ?? 0,
                draft.storageVersion ?? 0,
                retired?.version ?? 0,
              ),
            }),
          );
        }
        for (const lesson of data.lessons) {
          await request(
            tx.objectStore("mutations").delete(`retired:${lesson.lessonId}`),
          );
          await request(tx.objectStore("drafts").delete(lesson.lessonId));
          await request(
            tx.objectStore("lessons").put({
              ...lesson,
              storageVersion: advanceVersion(
                lessonVersions.get(lesson.lessonId) ?? 0,
                lesson.storageVersion ?? 0,
              ),
            }),
          );
        }
        for (const session of data.sessions) {
          const previous = previousSessions.get(session.id);
          await request(
            tx.objectStore("sessions").put({
              ...session,
              generation: advanceVersion(
                previous?.generation ?? 0,
                session.generation,
              ),
              version: advanceVersion(previous?.version ?? 0, session.version),
            }),
          );
        }
        // A restored lesson also invalidates writes from sessions left open in other tabs.
        const changedLessons = new Set([
          ...data.drafts.map((d) => d.id),
          ...data.lessons.map((l) => l.lessonId),
        ]);
        const changedSessions = new Set(data.sessions.map((s) => s.id));
        for (const s of current.sessions) {
          if (!changedSessions.has(s.id) && changedLessons.has(s.lessonId))
            await request(
              tx.objectStore("sessions").put({
                ...s,
                generation: advanceVersion(s.generation),
                version: advanceVersion(s.version),
              }),
            );
        }
        await this.cleanBatches(tx);
      },
    );
  }
  async batch(id: string): Promise<FileBatch | undefined> {
    return this.transaction(["batches"], "readonly", async (tx) => {
      const value = await request(tx.objectStore("batches").get(id));
      return value === undefined ? undefined : validateBatch(value);
    });
  }
  async batchDrafts(id: string): Promise<Draft[]> {
    const { drafts } = await this.list();
    return drafts.filter((d) => d.batchId === id);
  }
  private async cleanBatches(tx: IDBTransaction) {
    const [drafts, lessons, batches] = await Promise.all([
      request(tx.objectStore("drafts").getAll()),
      request(tx.objectStore("lessons").getAll()),
      request(tx.objectStore("batches").getAll()),
    ]);
    const used = new Set([...drafts, ...lessons].map((r) => r.batchId));
    for (const b of batches)
      if (!used.has(b.id))
        await request(tx.objectStore("batches").delete(b.id));
  }
  async saveDocumentDraft(draft: Draft, batch: FileBatch): Promise<Draft> {
    return (
      await this.replaceDocumentDrafts(
        [draft],
        [draft],
        batch,
        `${draft.id}:save:${draft.storageVersion ?? 0}:${draft.updatedAt}`,
      )
    )[0];
  }
  // A single transaction updates every participant, records retirement and the operation
  // result, and preserves the original drafts if any request or validation fails.
  async replaceDocumentDrafts(
    before: Draft[],
    after: Draft[],
    batch: FileBatch,
    operationId: string,
  ): Promise<Draft[]> {
    validateBatch(batch);
    after.forEach((d) => validateDraft(d, historicalRegistry));
    validateDocumentLinks([batch], after);
    if (
      !before.length ||
      !after.length ||
      !operationId ||
      new Set(before.map((d) => d.id)).size !== before.length ||
      new Set(after.map((d) => d.id)).size !== after.length ||
      before.some(
        (d) => d.batchId !== batch.id || d.languageId !== batch.languageId,
      )
    )
      throw new Error("草稿操作关联无效。");
    return this.transaction(
      ["drafts", "lessons", "batches", "mutations"],
      "readwrite",
      async (tx) => {
        const drafts = tx.objectStore("drafts"),
          mutations = tx.objectStore("mutations");
        const replay = await request(mutations.get(`operation:${operationId}`));
        if (replay) {
          for (const result of replay.drafts as Draft[]) {
            const latest: Draft | undefined = await request(
              drafts.get(result.id),
            );
            if (!latest || latest.storageVersion !== result.storageVersion)
              throw new Error("草稿操作已失效，请刷新。");
          }
          return replay.drafts as Draft[];
        }
        const versions = new Map<string, number>();
        for (const d of before) {
          const saved: Draft | undefined = await request(drafts.get(d.id));
          if (
            (await request(mutations.get(`retired:${d.id}`))) ||
            (await request(tx.objectStore("lessons").get(d.id))) ||
            (saved?.storageVersion ?? 0) !== (d.storageVersion ?? 0)
          )
            throw new Error("草稿已在其他窗口更新、确认或合并，请刷新。");
          if (
            saved &&
            (saved.batchId !== batch.id ||
              saved.languageId !== batch.languageId)
          )
            throw new Error("草稿批次不一致。");
          versions.set(d.id, saved?.storageVersion ?? 0);
        }
        const existingBatch = await request(
          tx.objectStore("batches").get(batch.id),
        );
        if (
          existingBatch &&
          JSON.stringify(existingBatch) !== JSON.stringify(batch)
        )
          throw new Error("来源批次已更新，请刷新。");
        const results = after.map((d) => ({
          ...d,
          storageVersion: advanceVersion(versions.get(d.id) ?? 0),
        }));
        for (const d of results) {
          if (
            !versions.has(d.id) &&
            ((await request(drafts.get(d.id))) ||
              (await request(tx.objectStore("lessons").get(d.id))) ||
              (await request(mutations.get(`retired:${d.id}`))))
          )
            throw new Error("新增草稿标识冲突。");
          await request(drafts.put(d));
        }
        for (const d of before)
          if (!after.some((a) => a.id === d.id)) {
            await request(drafts.delete(d.id));
            await request(
              mutations.put({
                id: `retired:${d.id}`,
                version: advanceVersion(d.storageVersion ?? 0),
              }),
            );
          }
        await request(tx.objectStore("batches").put(batch));
        await request(
          mutations.put({ id: `operation:${operationId}`, drafts: results }),
        );
        return results;
      },
    );
  }
  async updateSession(
    id: string,
    expectedVersion: number,
    event: Event,
    now: string,
    expectedGeneration = 0,
  ): Promise<Session> {
    return this.transaction(
      ["sessions", "lessons"],
      "readwrite",
      async (tx) => {
        const value: Session | undefined = await request(
          tx.objectStore("sessions").get(id),
        );
        if (!value) throw new Error("训练不存在。");
        const snapshot = await request(
          tx.objectStore("lessons").get(value.lessonId),
        );
        if (!snapshot) throw new Error("训练课文缺失，记录已保留。");
        const lesson = this.historicalLesson(snapshot),
          state = await this.trainingRecord(tx, value, lesson);
        if (state.generation !== expectedGeneration)
          throw new Error("训练已导入或在其他窗口更新，请刷新后继续。");
        if (
          (event.kind === "submit" || event.kind === "skip") &&
          state.attempts.some((a) => a.requestId === event.requestId)
        )
          return state;
        if (state.version !== expectedVersion)
          throw new Error("训练已在其他窗口更新，请刷新后继续。");
        const next = reduceSession(
          state,
          event,
          lesson,
          trainingModule(state.languageId, state.moduleRef),
          now,
        );
        validateSession(next, lesson);
        await request(tx.objectStore("sessions").put(next));
        return next;
      },
    );
  }
}
// No browser API is accessed until a client operation invokes the factory.
export const store = new IndexedDbStore();
