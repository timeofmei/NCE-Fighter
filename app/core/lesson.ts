export interface ModuleRef {
  moduleId: string;
  moduleVersion: string;
  profileVersion: string;
}
export const sameModuleRef = (
  a: ModuleRef | undefined,
  b: ModuleRef | undefined,
) =>
  !!a &&
  !!b &&
  a.moduleId === b.moduleId &&
  a.moduleVersion === b.moduleVersion &&
  a.profileVersion === b.profileVersion;
export interface Sentence {
  sourceRefs?: string[];
  id: string;
  order: number;
  start: number;
  end: number;
}
export interface Draft {
  batchId?: string;
  storageVersion?: number;
  schemaVersion: 1;
  id: string;
  languageId: string;
  moduleRef: ModuleRef;
  title: string;
  body: string;
  sourceRefs: string[];
  boundaryWarnings: string[];
  sentences: Sentence[];
  updatedAt: string;
}
export interface Lesson {
  batchId?: string;
  sourceRefs?: string[];
  storageVersion?: number;
  schemaVersion: 1;
  lessonId: string;
  revisionId: string;
  languageId: string;
  moduleRef: ModuleRef;
  title: string;
  body: string;
  sentences: Sentence[];
  confirmedAt: string;
}
export interface ImportLanguage {
  languageId: string;
  label: string;
  textDirection: "ltr" | "rtl";
  moduleRef: ModuleRef;
  capabilities: { textImport: boolean; training: boolean };
  countUnits(text: string): number;
}
export interface Registry {
  list(): ImportLanguage[];
  resolve(languageId: string, ref?: ModuleRef): ImportLanguage;
}
export interface Issue {
  message: string;
  line?: number;
}
export const MAX_CODE_POINTS = 20_000;
export const MAX_LINES = 500;
export const points = (text: string) => Array.from(text);
export const lines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

export function checkLimits(text: string): Issue[] {
  if (points(text).length > MAX_CODE_POINTS)
    return [{ message: "正文超过 20,000 个字符，请缩短后保存。" }];
  if (lines(text).filter((line) => line.trim()).length > MAX_LINES)
    return [{ message: "正文超过 500 个非空行，请减少行数后保存。" }];
  return [];
}

export function analyze(text: string, language: ImportLanguage) {
  const issues = checkLimits(text);
  const sentences: Omit<Sentence, "id">[] = [];
  if (issues.length) return { body: text, sentences, issues, units: 0 };
  const kept: string[] = [];
  let offset = 0;
  let units = 0;
  lines(text).forEach((line, index) => {
    if (!line.trim()) return;
    const count = language.countUnits(line);
    if (!count)
      issues.push({
        line: index + 1,
        message: `第 ${index + 1} 行没有有效文字或数字，不能仅含标点或符号。`,
      });
    units += count;
    sentences.push({
      order: kept.length,
      start: offset,
      end: offset + points(line).length,
    });
    kept.push(line);
    offset += points(line).length + 1;
  });
  if (!kept.length)
    issues.push({ message: "正文不能为空，请输入至少一句课文。" });
  return { body: kept.join("\n"), sentences, issues, units };
}

export function confirm(
  draft: Draft,
  registry: Registry,
  host: { revisionId: string; sentenceId(order: number): string; now: string },
): Lesson {
  const language = registry.resolve(draft.languageId, draft.moduleRef);
  const result = analyze(draft.body, language);
  if (result.issues.length)
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  return {
    schemaVersion: 1,
    ...(draft.batchId
      ? { batchId: draft.batchId, sourceRefs: [...draft.sourceRefs] }
      : {}),
    lessonId: draft.id,
    revisionId: host.revisionId,
    languageId: draft.languageId,
    moduleRef: { ...draft.moduleRef },
    title: draft.title,
    body: result.body,
    sentences: result.sentences.map((sentence) => ({
      ...sentence,
      ...(draft.batchId
        ? {
            sourceRefs:
              draft.sentences[sentence.order]?.sourceRefs ?? draft.sourceRefs,
          }
        : {}),
      id: host.sentenceId(sentence.order),
    })),
    confirmedAt: host.now,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("本地数据损坏，无法读取。");
  return value as Record<string, unknown>;
}
function base(value: unknown, registry: Registry) {
  const record = object(value);
  if (record.schemaVersion !== 1) throw new Error("本地数据版本不受支持。");
  if (
    typeof record.languageId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.body !== "string"
  )
    throw new Error("本地数据字段损坏。");
  if (
    !record.languageId ||
    (record.storageVersion !== undefined &&
      (!Number.isSafeInteger(record.storageVersion) ||
        (record.storageVersion as number) < 0))
  )
    throw new Error("本地数据字段损坏。");
  const ref = object(record.moduleRef);
  if (
    typeof ref.moduleId !== "string" ||
    !ref.moduleId ||
    typeof ref.moduleVersion !== "string" ||
    !ref.moduleVersion ||
    typeof ref.profileVersion !== "string" ||
    !ref.profileVersion
  )
    throw new Error("语言版本字段损坏。");
  const language = registry.resolve(
    record.languageId,
    ref as unknown as ModuleRef,
  );
  if (checkLimits(record.body).length) throw new Error("本地正文超出限制。");
  if (!Array.isArray(record.sentences)) throw new Error("句子范围数据损坏。");
  return { record, language };
}
function validateSentences(value: unknown[], expected: Omit<Sentence, "id">[]) {
  const ids = new Set<string>();
  if (value.length !== expected.length) throw new Error("句子边界数据损坏。");
  value.forEach((item, i) => {
    const sentence = object(item);
    if (
      typeof sentence.id !== "string" ||
      !sentence.id ||
      ids.has(sentence.id) ||
      sentence.order !== expected[i].order ||
      sentence.start !== expected[i].start ||
      sentence.end !== expected[i].end
    )
      throw new Error("句子范围数据损坏。");
    if (
      sentence.sourceRefs !== undefined &&
      (!Array.isArray(sentence.sourceRefs) ||
        !sentence.sourceRefs.every((ref) => typeof ref === "string" && ref))
    )
      throw new Error("句子来源数据损坏。");
    ids.add(sentence.id);
  });
}
const validDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export function validateDraft(value: unknown, registry: Registry): Draft {
  const { record, language } = base(value, registry);
  if (
    typeof record.id !== "string" ||
    !record.id ||
    !validDate(record.updatedAt) ||
    !Array.isArray(record.sourceRefs) ||
    !record.sourceRefs.every((item) => typeof item === "string") ||
    !Array.isArray(record.boundaryWarnings) ||
    !record.boundaryWarnings.every((item) => typeof item === "string")
  )
    throw new Error("草稿数据损坏。");
  validateSentences(
    record.sentences as unknown[],
    analyze(record.body as string, language).sentences,
  );
  return value as Draft;
}
export function validateLesson(value: unknown, registry: Registry): Lesson {
  const { record, language } = base(value, registry);
  if (
    typeof record.lessonId !== "string" ||
    !record.lessonId ||
    typeof record.revisionId !== "string" ||
    !record.revisionId ||
    !validDate(record.confirmedAt)
  )
    throw new Error("课文版本数据损坏。");
  const result = analyze(record.body as string, language);
  if (result.issues.length || result.body !== record.body)
    throw new Error("确认正文数据损坏。");
  validateSentences(record.sentences as unknown[], result.sentences);
  return value as Lesson;
}

export interface LessonStore {
  list(): Promise<{ drafts: Draft[]; lessons: Lesson[] }>;
  draft(id: string): Promise<Draft | undefined>;
  lesson(id: string): Promise<Lesson | undefined>;
  saveDraft(draft: Draft): Promise<void>;
  deleteDraft(id: string): Promise<void>;
  confirm(draftId: string, lesson: Lesson): Promise<void>;
}
