import {
  analyze,
  lines,
  type Draft,
  type ImportLanguage,
  type Lesson,
} from "./lesson";

export interface SourceFile {
  id: string;
  name: string;
  size: number;
  sha256: string;
  kind: "pdf" | "image";
}
// Rectangles use normalized coordinates in the rotated page. Rotation is explicit,
// so the original source can always be recovered without retaining a bitmap.
export interface Source {
  id: string;
  fileId: string;
  page: number;
  order: number;
  rotation: 0 | 90 | 180 | 270;
  rect: { x: number; y: number; width: number; height: number };
}
export interface FileBatch {
  id: string;
  languageId: string;
  createdAt: string;
  files: SourceFile[];
  sources: Source[];
}
export interface TextBlock {
  text: string;
  sourceRef: string;
}
export interface Proposal {
  sentenceSourceRefs?: string[][];
  title: string;
  body: string;
  sourceRefs: string[];
}
export interface DocumentLanguage extends ImportLanguage {
  proposeDocument(blocks: TextBlock[]): Proposal[];
}

export function documentDrafts(
  batch: FileBatch,
  blocks: TextBlock[],
  language: DocumentLanguage,
  host: { id(): string; now: string },
): Draft[] {
  if (batch.languageId !== language.languageId)
    throw new Error("文件批次语言不一致。");
  const refs = new Set(batch.sources.map((s) => s.id));
  if (blocks.some((b) => !refs.has(b.sourceRef)))
    throw new Error("来源定位缺失。");
  return language.proposeDocument(blocks).map((p) =>
    rebuildDraft(
      {
        schemaVersion: 1,
        id: host.id(),
        batchId: batch.id,
        languageId: language.languageId,
        moduleRef: language.moduleRef,
        title: p.title,
        body: p.body,
        sourceRefs: p.sourceRefs,
        boundaryWarnings: [],
        sentences: [],
        updatedAt: host.now,
      },
      language,
      p.sentenceSourceRefs,
    ),
  );
}
export function rebuildDraft(
  draft: Draft,
  language: ImportLanguage,
  sentenceSourceRefs?: string[][],
): Draft {
  return {
    ...draft,
    sentences: analyze(draft.body, language).sentences.map((s) => ({
      ...s,
      ...(draft.batchId
        ? { sourceRefs: sentenceSourceRefs?.[s.order] ?? draft.sourceRefs }
        : {}),
      id: `${draft.id}:draft:${s.order}`,
    })),
  };
}
export function splitDraft(
  draft: Draft,
  at: number,
  id: string,
  language: ImportLanguage,
): Draft[] {
  const body = lines(draft.body);
  if (
    !draft.batchId ||
    !Number.isInteger(at) ||
    at < 1 ||
    at >= body.length ||
    id === draft.id
  )
    throw new Error("请选择正文中的有效行边界。");
  return [
    rebuildDraft(
      { ...draft, body: body.slice(0, at).join("\n") },
      language,
      draft.sentences.slice(0, at).map((s) => s.sourceRefs ?? draft.sourceRefs),
    ),
    rebuildDraft(
      {
        ...draft,
        id,
        storageVersion: 0,
        title: "",
        body: body.slice(at).join("\n"),
      },
      language,
      draft.sentences.slice(at).map((s) => s.sourceRefs ?? draft.sourceRefs),
    ),
  ];
}
export function mergeDrafts(drafts: Draft[], language: ImportLanguage): Draft {
  const first = drafts[0];
  if (
    drafts.length < 2 ||
    new Set(drafts.map((d) => d.id)).size !== drafts.length ||
    !first.batchId ||
    drafts.some(
      (d) => d.batchId !== first.batchId || d.languageId !== first.languageId,
    )
  )
    throw new Error("只能合并同批次、同语言的不同草稿。");
  return rebuildDraft(
    {
      ...first,
      body: drafts.map((d) => d.body).join("\n"),
      sourceRefs: [...new Set(drafts.flatMap((d) => d.sourceRefs))],
    },
    language,
    drafts.flatMap((d) => d.sentences.map((s) => s.sourceRefs ?? d.sourceRefs)),
  );
}

export function validateBatch(value: unknown): FileBatch {
  const b = value as FileBatch;
  if (
    !b ||
    typeof b.id !== "string" ||
    !b.id ||
    typeof b.languageId !== "string" ||
    !b.languageId ||
    !Number.isFinite(Date.parse(b.createdAt)) ||
    !Array.isArray(b.files) ||
    !b.files.length ||
    !Array.isArray(b.sources) ||
    !b.sources.length
  )
    throw new Error("文件批次数据损坏。");
  const files = new Set<string>(),
    sources = new Set<string>();
  for (const f of b.files) {
    if (
      !f ||
      !f.id ||
      typeof f.id !== "string" ||
      files.has(f.id) ||
      typeof f.name !== "string" ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !["pdf", "image"].includes(f.kind)
    )
      throw new Error("来源文件数据损坏。");
    files.add(f.id);
  }
  if (
    b.files.some((f) => f.kind === "pdf") &&
    (b.files.length !== 1 || b.files[0].kind !== "pdf")
  )
    throw new Error("PDF 批次只能包含一个 PDF。");
  for (const s of b.sources) {
    const r = s?.rect;
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      sources.has(s.id) ||
      !files.has(s.fileId) ||
      !Number.isSafeInteger(s.page) ||
      s.page < 1 ||
      !Number.isSafeInteger(s.order) ||
      s.order < 0 ||
      ![0, 90, 180, 270].includes(s.rotation) ||
      !r ||
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > 1.000001 ||
      r.y + r.height > 1.000001
    )
      throw new Error("来源区域数据损坏。");
    sources.add(s.id);
  }
  return b;
}
export function validateDocumentLinks(
  batches: FileBatch[],
  records: (Draft | Lesson)[],
) {
  const map = new Map<string, FileBatch>();
  for (const b of batches) {
    validateBatch(b);
    if (map.has(b.id)) throw new Error("文件批次标识重复。");
    map.set(b.id, b);
  }
  for (const record of records) {
    if (record.batchId === undefined) {
      if (
        record.sourceRefs?.length ||
        record.sentences.some((sentence) => sentence.sourceRefs !== undefined)
      )
        throw new Error("来源批次缺失。");
      continue;
    }
    const b = map.get(record.batchId);
    if (
      !b ||
      b.languageId !== record.languageId ||
      !record.sourceRefs?.length ||
      record.sourceRefs.some((ref) => !b.sources.some((s) => s.id === ref))
    )
      throw new Error("课文来源关联损坏。");
    for (const sentence of record.sentences)
      if (
        sentence.sourceRefs &&
        (!sentence.sourceRefs.length ||
          sentence.sourceRefs.some((ref) => !record.sourceRefs!.includes(ref)))
      )
        throw new Error("句子来源关联损坏。");
  }
}
