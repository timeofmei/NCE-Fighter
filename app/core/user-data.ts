import {
  validateDraft,
  validateLesson,
  type Draft,
  type Lesson,
  type Registry,
} from "./lesson";
import { summarize, validateSession, type Session } from "./training";
import { validateDocumentLinks, type FileBatch } from "./document";

export interface UserData {
  app: "nce-fighter";
  system: { name: string | null; version: string | null };
  schemaVersion: 1 | 2;
  batches?: FileBatch[];
  drafts: Draft[];
  lessons: Lesson[];
  sessions: Session[];
}

// Structural recovery never loads a module or recomputes saved results.
export const historicalRegistry: Registry = {
  list: () => [],
  resolve: (languageId, moduleRef) => {
    if (!languageId || !moduleRef) throw new Error("语言或版本缺失。");
    return {
      languageId,
      moduleRef,
      label: languageId,
      textDirection: "ltr",
      capabilities: { textImport: false, training: false },
      countUnits: (text) => (text.trim() ? 1 : 0),
    };
  },
};

export function validateUserData(
  value: unknown,
  dependencies?: UserData,
): UserData {
  if (!value || typeof value !== "object")
    throw new Error("用户数据 JSON 格式无效。");
  const data = value as UserData;
  if (data.app !== "nce-fighter" || ![1, 2].includes(data.schemaVersion))
    throw new Error("用户数据版本或应用标识不受支持。");
  if (
    !data.system ||
    ![data.system.name, data.system.version].every(
      (v) => v === null || typeof v === "string",
    ) ||
    ![data.drafts, data.lessons, data.sessions].every(Array.isArray)
  )
    throw new Error("用户数据字段损坏。");
  if (data.schemaVersion === 2 && !Array.isArray(data.batches))
    throw new Error("文件批次缺失。");
  if (
    data.schemaVersion === 1 &&
    (data.batches !== undefined ||
      [...data.drafts, ...data.lessons].some((r) => r.batchId !== undefined))
  )
    throw new Error("文件来源需要 JSON 版本 2。");
  const lessonIds = new Set<string>(),
    sessionIds = new Set<string>();
  for (const d of data.drafts) {
    validateDraft(d, historicalRegistry);
    if (lessonIds.has(d.id)) throw new Error("文件内有重复课文标识。");
    lessonIds.add(d.id);
  }
  for (const l of data.lessons) {
    validateLesson(l, historicalRegistry);
    if (lessonIds.has(l.lessonId)) throw new Error("文件内有重复课文标识。");
    lessonIds.add(l.lessonId);
  }
  const lessons = new Map(
    (dependencies?.lessons ?? []).map((l) => [l.lessonId, l]),
  );
  data.drafts.forEach((d) => lessons.delete(d.id));
  data.lessons.forEach((l) => lessons.set(l.lessonId, l));
  const drafts = new Map((dependencies?.drafts ?? []).map((d) => [d.id, d]));
  data.lessons.forEach((l) => drafts.delete(l.lessonId));
  data.drafts.forEach((d) => drafts.set(d.id, d));
  for (const d of drafts.values()) {
    validateDraft(d, historicalRegistry);
    if (lessons.has(d.id))
      throw new Error("同一课文不能同时为草稿和已确认状态。");
  }
  for (const l of lessons.values()) validateLesson(l, historicalRegistry);
  const batches = new Map((dependencies?.batches ?? []).map((b) => [b.id, b]));
  const batchIds = new Set<string>();
  for (const b of data.batches ?? []) {
    if (!b || batchIds.has(b.id)) throw new Error("文件批次标识重复。");
    batchIds.add(b.id);
    batches.set(b.id, b);
  }
  validateDocumentLinks(
    [...batches.values()],
    [...drafts.values(), ...lessons.values()],
  );
  const sessions = new Map(
    (dependencies?.sessions ?? []).map((s) => [s.id, s]),
  );
  for (const s of data.sessions) {
    if (!s || typeof s.id !== "string" || sessionIds.has(s.id))
      throw new Error("文件内有重复或无效训练标识。");
    sessionIds.add(s.id);
    const lesson = lessons.get(s.lessonId);
    if (!lesson) throw new Error("训练课文缺失，不能导入。");
    validateSession(s, lesson);
    sessions.set(s.id, s);
  }
  for (const s of sessions.values()) {
    const lesson = lessons.get(s.lessonId);
    if (!lesson) throw new Error("训练课文缺失，不能导入。");
    validateSession(s, lesson);
    if (s.sourceSessionId !== null) {
      const source = sessions.get(s.sourceSessionId);
      if (!source) throw new Error("来源训练缺失，不能导入。");
      if (
        source.id === s.id ||
        source.status !== "completed" ||
        source.mode !== "sentence_dictation" ||
        s.mode !== "sentence_dictation" ||
        source.lessonId !== s.lessonId ||
        JSON.stringify(summarize(source).wrongIds) !==
          JSON.stringify(s.sentenceIds)
      )
        throw new Error("来源训练关联损坏。");
    }
  }
  const visited = new Set<string>();
  for (const s of sessions.values()) {
    const chain = new Set<string>();
    let current: Session | undefined = s;
    while (current && !visited.has(current.id)) {
      if (chain.has(current.id)) throw new Error("来源训练关联形成循环。");
      chain.add(current.id);
      current = current.sourceSessionId
        ? sessions.get(current.sourceSessionId)
        : undefined;
    }
    chain.forEach((id) => visited.add(id));
  }
  return data;
}

export function parseUserData(text: string): UserData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  // Dependencies are checked against the target snapshot inside the write transaction.
  return value as UserData;
}
