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
  beginSession,
  reduceSession,
  summarize,
  validateSession,
  type Session,
  type Event,
} from "../core/training";

export const DATABASE_NAME = "nce-fighter";
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
      const req = this.factory().open(this.name, 2);
      let blocked = false;
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of [
          ["drafts", "id"],
          ["lessons", "lessonId"],
          ["sessions", "id"],
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
        drafts: drafts.map((draft) => validateDraft(draft, registry)),
        lessons: lessons.map((lesson) => this.historicalLesson(lesson)),
      };
    });
  }
  async draft(id: string) {
    return this.transaction(["drafts"], "readonly", async (tx) => {
      const value: unknown = await request(tx.objectStore("drafts").get(id));
      return value === undefined ? undefined : validateDraft(value, registry);
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
    validateDraft(draft, registry);
    return this.transaction(["drafts", "lessons"], "readwrite", async (tx) => {
      if (await request(tx.objectStore("lessons").get(draft.id)))
        throw new Error("课文已确认，请新建导入。");
      await request(tx.objectStore("drafts").put(draft));
    });
  }
  async deleteDraft(id: string) {
    return this.transaction(["drafts"], "readwrite", async (tx) => {
      await request(tx.objectStore("drafts").delete(id));
    });
  }
  async confirm(draftId: string, lesson: Lesson) {
    validateLesson(lesson, registry);
    if (draftId !== lesson.lessonId)
      throw new Error("保存信息有误，请重新打开草稿。");
    return this.transaction(["drafts", "lessons"], "readwrite", async (tx) => {
      const existing: unknown = await request(
        tx.objectStore("lessons").get(lesson.lessonId),
      );
      if (existing !== undefined) {
        validateLesson(existing, registry);
        if (JSON.stringify(existing) !== JSON.stringify(lesson))
          throw new Error("课文已确认，请新建导入。");
      } else await request(tx.objectStore("lessons").add(lesson));
      await request(tx.objectStore("drafts").delete(draftId));
    });
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
        JSON.stringify(summarize(source).wrongIds) !==
          JSON.stringify(session.sentenceIds)
      )
        throw new Error("训练句子归属损坏，无法恢复。");
    }
    return session;
  }
  private historicalLesson(value: Lesson): Lesson {
    try {
      registry.resolve(value.languageId, value.moduleRef);
    } catch {
      return this.validateHistoricalShape(value);
    }
    return validateLesson(value, registry);
  }
  private validateHistoricalShape(value: Lesson): Lesson {
    return validateLesson(value, {
      list: () => [],
      resolve: (languageId, ref) => ({
        languageId,
        moduleRef: ref!,
        label: "",
        textDirection: "ltr",
        capabilities: { textImport: true, training: false },
        countUnits: (text) => (text.trim() ? 1 : 0),
      }),
    });
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
    options: { hint?: boolean; sourceSessionId?: string } = {},
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
          if (saved.sourceSessionId !== (options.sourceSessionId ?? null))
            throw new Error("训练标识冲突。");
          return saved;
        }
        let sentenceIds: string[] | undefined;
        if (options.sourceSessionId) {
          const source = await request(
            tx.objectStore("sessions").get(options.sourceSessionId),
          );
          const original = validateSession(source, lesson);
          if (original.status !== "completed")
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
  async updateSession(
    id: string,
    expectedVersion: number,
    event: Event,
    now: string,
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
