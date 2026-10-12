import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate } from "react-router";
import {
  Alert,
  Button,
  Checkbox,
  FileButton,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { store } from "../adapters/storage";
import {
  LocalDocument,
  cropRegion,
  lineRegions,
  type PageOutcome,
} from "../adapters/document";
import {
  downloadResources,
  missingResources,
  OCR_NAME,
} from "../adapters/resources";
import { analyze, confirm, type Draft } from "../core/lesson";
import {
  documentDrafts,
  mergeDrafts,
  rebuildDraft,
  splitDraft,
  type FileBatch,
} from "../core/document";
import { english } from "../languages/english";
import { errorMessage } from "./feedback";
import { SourceEditor } from "./source-editor";
import { DeleteDraft } from "./delete-draft";

type Item = { draft: Draft; saved?: Draft; original?: Draft };
const changed = (item?: Item) =>
  !!item &&
  (!item.saved ||
    item.draft.title !== item.saved.title ||
    item.draft.body !== item.saved.body);
export function FileImport({
  initial,
  initialBatch,
  drafts = [],
  languageId = "",
}: {
  initial?: Draft;
  initialBatch?: FileBatch;
  drafts?: Draft[];
  languageId?: string;
}) {
  const navigate = useNavigate();
  const [language, setLanguage] = useState(initial?.languageId ?? languageId),
    [doc, setDoc] = useState<LocalDocument>();
  const [items, setItems] = useState<Item[]>(
      drafts.map((d) => ({ draft: d, saved: d })),
    ),
    [current, setCurrent] = useState(initial?.id ?? drafts[0]?.id ?? "");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState<string>();
  const [outcomes, setOutcomes] = useState<PageOutcome[]>([]),
    [download, setDownload] = useState<number>(),
    [review, setReview] = useState(false),
    [rerun, setRerun] = useState(false);
  const [pending, setPending] = useState<() => void>(),
    [selection, setSelection] = useState<string[]>([]),
    [mergeReview, setMergeReview] = useState(false),
    [splitAt, setSplitAt] = useState<number | string>(1),
    [sourceVisible, setSourceVisible] = useState(false);
  const batches = useRef(
    new Map(initialBatch ? [[initialBatch.id, initialBatch]] : []),
  );
  const bypass = useRef(false);
  const [adjusting, setAdjusting] = useState(false);
  const [structurePrompt, setStructurePrompt] = useState<"split" | "merge">();
  const confirming = useRef(false);
  const [processing, setProcessing] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined),
    lock = useRef(false),
    composing = useRef(false),
    documentRef = useRef<LocalDocument | undefined>(undefined);
  const active = items.find((i) => i.draft.id === current),
    dirty = items.some((i) => changed(i));
  const blocker = useBlocker(() => !bypass.current && (dirty || lock.current));
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty || lock.current) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );
  useEffect(
    () => () => {
      controller.current?.abort();
      documentRef.current?.close();
    },
    [],
  );
  const requestAction = (action: () => void) => {
    if (lock.current || composing.current) return;
    if (changed(active)) setPending(() => action);
    else action();
  };
  const update = (field: "title" | "body", value: string) => {
    setItems((previous) =>
      previous.map((i) =>
        i.draft.id === current
          ? {
              ...i,
              draft:
                field === "body"
                  ? rebuildDraft({ ...i.draft, body: value }, english)
                  : { ...i.draft, title: value },
            }
          : i,
      ),
    );
    setError(undefined);
  };
  const save = async () => {
    if (!active || lock.current || composing.current) return false;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const batch = batches.current.get(active.draft.batchId!);
      if (!batch) throw new Error("来源批次缺失。");
      const draft = rebuildDraft(
        { ...active.draft, updatedAt: new Date().toISOString() },
        english,
        active.draft.sentences.map(
          (s) => s.sourceRefs ?? active.draft.sourceRefs,
        ),
      );
      const saved = await store.saveDocumentDraft(draft, batch);
      setItems((previous) =>
        previous.map((i) =>
          i.draft.id === saved.id ? { draft: saved, saved } : i,
        ),
      );
      window.history.replaceState(
        window.history.state,
        "",
        `/import?draft=${encodeURIComponent(saved.id)}`,
      );
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const read = async (files: File[]) => {
    if (!files.length || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("读取文件");
    setProcessing(true);
    setError(undefined);
    setOutcomes([]);
    const abort = new AbortController();
    controller.current = abort;
    let next: LocalDocument | undefined;
    try {
      next = new LocalDocument(files, language);
      await next.read(abort.signal, setMessage);
      abort.signal.throwIfAborted();
      if (initialBatch && !doc) {
        if (!(await next.matches(initialBatch)))
          throw new Error(
            "所选文件与已保存来源不匹配；正文仍可编辑，请重新选择原文件。",
          );
        // Restore page identity and orientation only after exact file fingerprints match.
        next.pages.forEach((p) => {
          const source = initialBatch.sources.find(
            (s) =>
              s.fileId ===
                initialBatch.files[
                  next!.batch.files.findIndex((f) => f.id === p.source.fileId)
                ].id && s.page === p.source.page,
          );
          if (source) p.source = structuredClone(source);
        });
        next.batch.files = structuredClone(initialBatch.files);
        next.batch.sources = next.pages.map((p) => p.source);
        next.pages.forEach((p) => {
          p.regions = initialBatch.sources
            .filter(
              (s) =>
                s.fileId === p.source.fileId &&
                s.page === p.source.page &&
                s.id.includes(":region:"),
            )
            .sort((a, b) => a.order - b.order)
            .map((s) => structuredClone(s.rect));
        });
      }
      documentRef.current?.close();
      documentRef.current = next;
      setDoc(next);
      setSourceVisible(true);
    } catch (e) {
      next?.close();
      if (!abort.signal.aborted) setError(errorMessage(e));
    } finally {
      if (controller.current === abort) {
        setProcessing(false);
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const finishProposals = (results: PageOutcome[], batch: FileBatch) => {
    const blocks = results.flatMap((r) => r.blocks);
    const next = documentDrafts(batch, blocks, english, {
      id: () => crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (results.some((r) => r.status === "skipped"))
      next.forEach((d) =>
        d.boundaryWarnings.push(
          "已跳过失败页面或区域，正文可能缺失，请核对来源。",
        ),
      );
    if (!next.length) throw new Error("没有可校对的文字，请调整区域后重试。");
    batches.current.set(batch.id, batch);
    const preserved = items
      .filter((i) => i.saved)
      .map((i) => ({ draft: i.saved!, saved: i.saved }));
    setItems([
      ...preserved,
      ...next.map((draft) => ({ draft, original: draft })),
    ]);
    setCurrent(preserved[0]?.draft.id ?? next[0].id);
    setSelection([]);
    setSourceVisible(false);
  };
  const processingBatch = useRef<FileBatch | undefined>(undefined);
  const process = async (retry = false, approved = false) => {
    if (!doc || lock.current) return;
    setError(undefined);
    const needsOcr = doc.pages.some(
      (p, i) =>
        p.mode === "ocr" && (!retry || outcomes[i]?.status === "failed"),
    );
    try {
      if (needsOcr && !approved) {
        const missing = await missingResources();
        if (missing.length) {
          setDownload(missing.reduce((n, r) => n + r.bytes, 0));
          return;
        }
      }
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("准备识别");
    setProcessing(true);
    setDownload(undefined);
    setAdjusting(false);
    const abort = new AbortController();
    controller.current = abort;
    let engine: import("../adapters/ocr").LocalOcr | undefined;
    const batch = retry ? processingBatch.current! : structuredClone(doc.batch);
    if (!retry) {
      batch.id = crypto.randomUUID();
      batch.sources = doc.pages.map((p) => ({
        ...structuredClone(p.source),
        id: crypto.randomUUID(),
      }));
      processingBatch.current = batch;
    }
    const results: PageOutcome[] = retry ? [...outcomes] : [];
    try {
      if (needsOcr) {
        setMessage("下载识别资源");
        await downloadResources(abort.signal, (n, total) =>
          setMessage(
            `下载识别资源 ${Math.round((n / Math.max(1, total)) * 100)}%`,
          ),
        );
        setMessage("初始化本地识别");
        const { LocalOcr } = await import("../adapters/ocr");
        engine = new LocalOcr(abort.signal);
        await engine.initialize();
      }
      for (let index = 0; index < doc.pages.length; index++) {
        if (retry && results[index]?.status !== "failed") continue;
        abort.signal.throwIfAborted();
        setMessage(`处理第 ${index + 1} / ${doc.pages.length} 页`);
        const page = doc.pages[index],
          source = batch.sources[index];
        source.rotation = page.source.rotation;
        try {
          if (page.mode === "text") {
            results[index] = {
              status: "success",
              blocks: [{ text: page.text, sourceRef: source.id }],
            };
          } else {
            const canvas = await doc.render(index);
            try {
              const regions = page.regions.length
                ? page.regions
                : lineRegions(
                    canvas
                      .getContext("2d")!
                      .getImageData(0, 0, canvas.width, canvas.height),
                  );
              if (!regions.length)
                throw new Error("未找到文字行，请在来源预览中框选。");
              const blocks = [];
              const regionResults: NonNullable<PageOutcome["regions"]> = [];
              for (let r = 0; r < regions.length; r++) {
                abort.signal.throwIfAborted();
                setMessage(
                  `第 ${index + 1} 页 · 区域 ${r + 1} / ${regions.length}`,
                );
                const key = JSON.stringify([regions[r], source.rotation]);
                const previous = results[index]?.regions?.find(
                  (result) => result.key === key && !result.error,
                );
                let text: string;
                try {
                  text =
                    previous?.text ??
                    (await engine!.line(cropRegion(canvas, regions[r]))).text;
                  if (!text.trim())
                    throw new Error("区域未识别到文字，请调整框选。");
                } catch (e) {
                  abort.signal.throwIfAborted();
                  regionResults.push({
                    key,
                    sourceRef: `${source.id}:region:${r}`,
                    error: errorMessage(e),
                  });
                  continue;
                }
                const regionSource = {
                  ...source,
                  id: `${source.id}:region:${r}`,
                  rect: regions[r],
                  order: batch.sources.length,
                };
                const old = batch.sources.findIndex(
                  (s) => s.id === regionSource.id,
                );
                if (old < 0) batch.sources.push(regionSource);
                else
                  batch.sources[old] = {
                    ...regionSource,
                    order: batch.sources[old].order,
                  };
                blocks.push({ text, sourceRef: regionSource.id });
                regionResults.push({ key, text, sourceRef: regionSource.id });
              }
              const failed = regionResults.filter((r) => r.error);
              results[index] = {
                status: failed.length ? "failed" : "success",
                blocks,
                regions: regionResults,
                ...(failed.length
                  ? { error: `${failed.length} 个区域失败，请调整或重试。` }
                  : {}),
              };
            } finally {
              canvas.width = canvas.height = 1;
            }
          }
        } catch (e) {
          abort.signal.throwIfAborted();
          results[index] = {
            status: "failed",
            blocks: results[index]?.blocks ?? [],
            error: errorMessage(e),
          };
        }
        setOutcomes([...results]);
      }
      abort.signal.throwIfAborted();
      if (results.every((r) => r.status !== "failed"))
        finishProposals(results, batch);
    } catch (e) {
      if (!abort.signal.aborted) setError(errorMessage(e));
    } finally {
      engine?.close();
      if (controller.current === abort) {
        setProcessing(false);
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    controller.current?.abort();
    processingBatch.current = undefined;
    setOutcomes([]);
    setItems((previous) =>
      previous
        .filter((i) => i.saved)
        .map((i) => ({ draft: i.saved!, saved: i.saved })),
    );
    setBusy(false);
    setProcessing(false);
    lock.current = false;
  };
  const restructure = async (
    kind: "split" | "merge",
    decision?: "save" | "discard",
  ) => {
    if (lock.current || composing.current || !active) return;
    const participants =
      kind === "split"
        ? [active]
        : selection.map((id) => items.find((i) => i.draft.id === id)!);
    if (
      !decision &&
      participants.some((i) => {
        const baseline = i.saved ?? i.original;
        return (
          baseline &&
          (baseline.body !== i.draft.body || baseline.title !== i.draft.title)
        );
      })
    ) {
      setStructurePrompt(kind);
      return;
    }
    try {
      const before = participants.map((i) => {
        const draft =
          decision === "discard" ? (i.saved ?? i.original ?? i.draft) : i.draft;
        return rebuildDraft(
          draft,
          english,
          draft.sentences.map((s) => s.sourceRefs ?? draft.sourceRefs),
        );
      });
      const persist = participants.some((i) => i.saved) || decision === "save";
      const after =
        kind === "split"
          ? splitDraft(before[0], Number(splitAt), crypto.randomUUID(), english)
          : [mergeDrafts(before, english)];
      let next = after;
      if (persist) {
        lock.current = true;
        setBusy(true);
        next = await store.replaceDocumentDrafts(
          before,
          after,
          batches.current.get(before[0].batchId!)!,
          crypto.randomUUID(),
        );
      }
      const ids = new Set(before.map((d) => d.id)),
        position = items.findIndex((i) => i.draft.id === before[0].id);
      const remaining = items.filter((i) => !ids.has(i.draft.id));
      remaining.splice(
        position,
        0,
        ...next.map((draft) => ({
          draft,
          ...(persist ? { saved: draft } : { original: draft }),
        })),
      );
      setItems(remaining);
      setCurrent(next[0].id);
      if (persist)
        window.history.replaceState(
          window.history.state,
          "",
          `/import?draft=${encodeURIComponent(next[0].id)}`,
        );
      setSelection([]);
      setMergeReview(false);
      setStructurePrompt(undefined);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const confirmCurrent = async () => {
    if (!active || lock.current || composing.current || confirming.current)
      return;
    confirming.current = true;
    // Saving the draft first retains a recoverable source even if confirmation fails.
    try {
      if (!(await save())) return;
      lock.current = true;
      setBusy(true);
      const saved = await store.draft(active.draft.id);
      if (!saved) throw new Error("草稿已被删除，请刷新。");
      lock.current = true;
      setBusy(true);
      const lesson = confirm(
        saved,
        { list: () => [english], resolve: () => english },
        {
          revisionId: `${saved.id}:1`,
          sentenceId: (order) => `${saved.id}:sentence:${order}`,
          now: new Date().toISOString(),
        },
      );
      await store.confirm(saved.id, lesson, saved.storageVersion ?? 0);
      const remaining = items.filter((i) => i.draft.id !== saved.id);
      setItems(remaining);
      setCurrent(remaining[0]?.draft.id ?? "");
      setReview(false);
      const nextSaved = remaining.find((i) => i.saved)?.saved;
      if (remaining.length)
        window.history.replaceState(
          window.history.state,
          "",
          nextSaved
            ? `/import?draft=${encodeURIComponent(nextSaved.id)}`
            : "/import?mode=file&language=en",
        );
      if (!remaining.length) {
        bypass.current = true;
        await navigate(`/lessons/${encodeURIComponent(saved.id)}`);
      }
    } catch (e) {
      setError(errorMessage(e));
      setReview(false);
    } finally {
      confirming.current = false;
      lock.current = false;
      setBusy(false);
    }
  };
  const failure = outcomes.some((r) => r.status === "failed");
  return (
    <Stack
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <Group justify="space-between">
        <Title order={1}>导入</Title>
        <Button component={Link} to="/library" variant="subtle" disabled={busy}>
          返回课文库
        </Button>
      </Group>
      <Select
        label="语言"
        placeholder="选择语言"
        data={[{ value: "en", label: "英语" }]}
        value={language || null}
        disabled={busy || items.length > 0 || !!doc}
        allowDeselect={false}
        onChange={(v) => setLanguage(v ?? "")}
      />
      <Group>
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => void navigate("/import")}
        >
          粘贴文本
        </Button>
        <Button variant="light" disabled>
          文件导入
        </Button>
      </Group>
      <Group>
        <FileButton
          accept="application/pdf,.pdf"
          onChange={(f) => {
            if (f)
              requestAction(() => {
                void read([f]);
              });
          }}
        >
          {(props) => (
            <Button {...props} disabled={!language || busy} variant="light">
              {initialBatch ? "重新选择原 PDF" : "选择 PDF"}
            </Button>
          )}
        </FileButton>
        <FileButton
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(files) =>
            requestAction(() => {
              void read(files);
            })
          }
        >
          {(props) => (
            <Button {...props} disabled={!language || busy} variant="light">
              {initialBatch ? "重新选择原图片" : "选择图片"}
            </Button>
          )}
        </FileButton>
        {doc && (
          <Button
            disabled={busy}
            onClick={() => {
              if (failure) void process(true);
              else if (items.length) setRerun(true);
              else void process();
            }}
          >
            开始识别
          </Button>
        )}
      </Group>
      {doc && (
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => setSourceVisible((v) => !v)}
        >
          {sourceVisible ? "返回校对" : "查看来源"}
        </Button>
      )}
      {!doc && initialBatch && (
        <Text size="sm">查看来源或重新识别时，请重新选择原文件。</Text>
      )}
      {sourceVisible && doc && (
        <SourceEditor
          document={doc}
          disabled={busy}
          allowOrder={!failure}
          onChange={(index) => {
            setError(undefined);
            if (failure)
              setOutcomes((previous) =>
                previous.map((r, i) =>
                  i === index ? { ...r, status: "failed" } : r,
                ),
              );
          }}
        />
      )}
      {!sourceVisible && items.length > 0 && (
        <div className="document-editor">
          <Stack className="document-list">
            <Select
              className="document-mobile-select"
              label="待校对课文"
              value={current}
              data={items.map((i) => ({
                value: i.draft.id,
                label: i.draft.title || "未命名课文",
              }))}
              onChange={(v) => {
                if (v) requestAction(() => setCurrent(v));
              }}
            />
            {items.map((item) => (
              <Group key={item.draft.id} wrap="nowrap">
                <Checkbox
                  aria-label={`选择合并 ${item.draft.title || "未命名课文"}`}
                  checked={selection.includes(item.draft.id)}
                  disabled={
                    busy ||
                    (selection.length > 0 &&
                      items.find((i) => i.draft.id === selection[0])?.draft
                        .batchId !== item.draft.batchId)
                  }
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelection((previous) =>
                      checked
                        ? [...previous, item.draft.id]
                        : previous.filter((id) => id !== item.draft.id),
                    );
                  }}
                />
                <Button
                  variant={current === item.draft.id ? "light" : "subtle"}
                  disabled={busy}
                  onClick={() => requestAction(() => setCurrent(item.draft.id))}
                >
                  {item.draft.title || "未命名课文"}
                </Button>
              </Group>
            ))}
            <Button
              variant="light"
              disabled={busy || selection.length < 2}
              onClick={() => setMergeReview(true)}
            >
              合并所选草稿
            </Button>
          </Stack>
          {active && (
            <Stack className="document-body">
              <TextInput
                label="标题"
                value={active.draft.title}
                readOnly={busy}
                onChange={(e) => update("title", e.currentTarget.value)}
              />
              <Textarea
                label="正文"
                description="每行一句"
                className="editor"
                rows={15}
                wrap="off"
                value={active.draft.body}
                readOnly={busy}
                onChange={(e) => update("body", e.currentTarget.value)}
              />
              {analyze(active.draft.body, english).issues.map((issue, i) => (
                <Text key={i} c="red" size="sm">
                  {issue.message}
                </Text>
              ))}
              <Group>
                <NumberInput
                  label="在第几行后拆分"
                  min={1}
                  max={Math.max(1, active.draft.body.split("\n").length - 1)}
                  value={splitAt}
                  onChange={setSplitAt}
                  disabled={busy}
                />
                <Button
                  variant="light"
                  disabled={busy}
                  onClick={() => {
                    void restructure("split");
                  }}
                >
                  拆分课文
                </Button>
              </Group>
              <Text size="sm" c="dimmed" role="status">
                {changed(active) ? "有未保存修改" : "草稿已保存"}
              </Text>
              {active.draft.boundaryWarnings.map((warning, index) => (
                <Text key={index} c="orange" size="sm">
                  {warning}
                </Text>
              ))}
              <Group>
                <Button
                  variant="light"
                  disabled={busy}
                  onClick={() => {
                    void save();
                  }}
                >
                  保存草稿
                </Button>
                <Button
                  disabled={
                    busy || !!analyze(active.draft.body, english).issues.length
                  }
                  onClick={() => {
                    if (!composing.current) setReview(true);
                  }}
                >
                  保存为课文
                </Button>
                {active.saved && (
                  <DeleteDraft
                    id={active.draft.id}
                    title={active.draft.title}
                    disabled={busy}
                    unsaved={changed(active)}
                    onPendingChange={(pending) => {
                      lock.current = pending;
                      setBusy(pending);
                    }}
                    onDeleted={() => {
                      const remaining = items.filter(
                        (i) => i.draft.id !== current,
                      );
                      setItems(remaining);
                      setCurrent(remaining[0]?.draft.id ?? "");
                    }}
                  />
                )}
              </Group>
            </Stack>
          )}
        </div>
      )}
      {error && (
        <Alert color="red" title="操作失败" role="alert">
          {error}
        </Alert>
      )}
      <Modal
        opened={!!structurePrompt}
        title="参与拆合的草稿有未保存修改"
        onClose={() => setStructurePrompt(undefined)}
      >
        <Stack>
          <Group>
            <Button
              disabled={busy}
              onClick={() => {
                if (structurePrompt) void restructure(structurePrompt, "save");
              }}
            >
              保存修改并继续
            </Button>
            <Button
              disabled={busy}
              variant="light"
              onClick={() => {
                if (structurePrompt)
                  void restructure(structurePrompt, "discard");
              }}
            >
              放弃修改并继续
            </Button>
            <Button
              disabled={busy}
              variant="subtle"
              onClick={() => setStructurePrompt(undefined)}
            >
              取消拆合
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={processing || (failure && !adjusting)}
        title={busy ? "处理文件" : "部分页面处理失败"}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <Stack>
          <Text role="status">{message}</Text>
          {outcomes.map((r, i) => (
            <Text key={i} size="sm">
              第 {i + 1} 页：
              {r.status === "success"
                ? "完成"
                : r.status === "skipped"
                  ? "已跳过"
                  : r.error}
            </Text>
          ))}
          <Group>
            {!busy && failure && (
              <>
                <Button
                  onClick={() => {
                    void process(true);
                  }}
                >
                  重试失败页面
                </Button>
                <Button
                  variant="light"
                  onClick={() => {
                    setSourceVisible(true);
                    setAdjusting(true);
                  }}
                >
                  调整来源区域
                </Button>
                <Button
                  variant="light"
                  onClick={() => {
                    const results = outcomes.map((r) =>
                      r.status === "failed"
                        ? { ...r, status: "skipped" as const }
                        : r,
                    );
                    try {
                      finishProposals(results, processingBatch.current!);
                      setOutcomes(results);
                    } catch (e) {
                      setError(errorMessage(e));
                      setOutcomes([]);
                    }
                  }}
                >
                  跳过失败页面并继续
                </Button>
              </>
            )}
            <Button variant="subtle" onClick={cancel}>
              取消识别
            </Button>
          </Group>
          {!busy && failure && (
            <Text size="sm">跳过页面会使正文缺失对应内容。</Text>
          )}
        </Stack>
      </Modal>
      <Modal
        opened={download !== undefined}
        title="下载本地识别资源"
        onClose={() => setDownload(undefined)}
      >
        <Stack>
          <Text>{OCR_NAME}</Text>
          <Text>
            本次下载 {((download ?? 0) / 1000000).toFixed(2)}{" "}
            MB；用于本地图片文字识别。
          </Text>
          <Group>
            <Button
              onClick={() => {
                void process(failure, true);
              }}
            >
              下载并识别
            </Button>
            <Button variant="light" onClick={() => setDownload(undefined)}>
              取消
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={rerun}
        title="重新识别文件"
        onClose={() => setRerun(false)}
      >
        <Stack>
          <Text>未保存草稿及校对修改将被丢弃，已保存草稿保留。</Text>
          <Group>
            <Button
              onClick={() => {
                setRerun(false);
                void process();
              }}
            >
              重新识别
            </Button>
            <Button variant="light" onClick={() => setRerun(false)}>
              取消
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={review}
        title={active?.draft.title || "未命名课文"}
        onClose={() => {
          if (!busy) setReview(false);
        }}
      >
        <Stack>
          <Text>
            确认保存后不可修改内容。课文保存在此浏览器，清除数据会丢失课文和草稿。
          </Text>
          <Group>
            <Button
              disabled={busy}
              onClick={() => {
                void confirmCurrent();
              }}
            >
              确认保存
            </Button>
            <Button
              variant="light"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              继续编辑
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={mergeReview}
        title="合并草稿"
        onClose={() => setMergeReview(false)}
      >
        <Stack>
          {selection.map((id, index) => (
            <Group key={id}>
              <Text>
                {items.find((i) => i.draft.id === id)?.draft.title ||
                  "未命名课文"}
              </Text>
              <Button
                variant="subtle"
                disabled={index === 0 || busy}
                onClick={() =>
                  setSelection((previous) => {
                    const next = [...previous];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    return next;
                  })
                }
              >
                上移
              </Button>
            </Group>
          ))}
          <Group>
            <Button
              disabled={busy}
              onClick={() => {
                void restructure("merge");
              }}
            >
              按此顺序合并
            </Button>
            <Button variant="light" onClick={() => setMergeReview(false)}>
              取消
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={!!pending || blocker.state === "blocked"}
        title="有未保存修改"
        onClose={() => {
          setPending(undefined);
          if (blocker.state === "blocked") blocker.reset();
        }}
      >
        <Stack>
          <Text>
            {busy
              ? "正在处理，请先取消识别。"
              : "保存当前草稿后继续，或放弃修改。"}
          </Text>
          <Group>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await save()) {
                  const action = pending;
                  setPending(undefined);
                  action?.();
                  if (blocker.state === "blocked") blocker.proceed();
                }
              }}
            >
              保存草稿后继续
            </Button>
            <Button
              variant="light"
              disabled={busy}
              onClick={() => {
                setItems((previous) =>
                  previous.map((i) =>
                    i.draft.id === current && (i.saved || i.original)
                      ? { ...i, draft: i.saved ?? i.original! }
                      : i,
                  ),
                );
                const action = pending;
                setPending(undefined);
                action?.();
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              放弃修改后继续
            </Button>
            <Button
              variant="subtle"
              onClick={() => {
                setPending(undefined);
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              取消切换
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
