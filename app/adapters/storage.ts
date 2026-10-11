import {
  validateDraft,
  validateLesson,
  type Draft,
  type Lesson,
  type LessonStore,
} from "../core/lesson";
import { registry } from "../languages/registry";

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
      const req = this.factory().open(this.name, 1);
      let blocked = false;
      req.onupgradeneeded = () => {
        req.result.createObjectStore("drafts", { keyPath: "id" });
        req.result.createObjectStore("lessons", { keyPath: "lessonId" });
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
        lessons: lessons.map((lesson) => validateLesson(lesson, registry)),
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
      return value === undefined ? undefined : validateLesson(value, registry);
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
}
// No browser API is accessed until a client operation invokes the factory.
export const store = new IndexedDbStore();
