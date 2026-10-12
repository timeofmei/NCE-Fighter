import { useCallback, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate } from "react-router";
import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { store } from "../adapters/storage";
import {
  analyze,
  checkLimits,
  confirm,
  lines,
  points,
  type Draft,
  type Lesson,
} from "../core/lesson";
import { registry } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import { DeleteDraft } from "../components/delete-draft";
import { FileImport } from "../components/file-import";
import type { Route } from "./+types/import";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const params = new URL(request.url).searchParams;
  const draftId = params.get("draft");
  try {
    const draft = draftId ? await store.draft(draftId) : undefined;
    return {
      draft,
      fileMode: params.get("mode") === "file",
      languageId: params.get("language") === "en" ? "en" : "",
      batch: draft?.batchId ? await store.batch(draft.batchId) : undefined,
      batchDrafts: draft?.batchId ? await store.batchDrafts(draft.batchId) : [],
      id: draftId ?? crypto.randomUUID(),
      error: undefined,
      missing: !!draftId && !draft,
    };
  } catch (error) {
    return {
      draft: undefined,
      fileMode: false,
      languageId: "",
      batch: undefined,
      batchDrafts: [],
      id: draftId ?? "",
      error: errorMessage(error),
      missing: false,
    };
  }
}
export default function Import({ loaderData }: Route.ComponentProps) {
  if (loaderData.error) return <LoadError message={loaderData.error} />;
  if (loaderData.missing)
    return (
      <Stack>
        <Title order={1}>草稿不存在</Title>
        <Button component={Link} to="/library">
          返回课文库
        </Button>
      </Stack>
    );
  return loaderData.fileMode || loaderData.draft?.batchId ? (
    <FileImport
      key={loaderData.id}
      initial={loaderData.draft}
      initialBatch={loaderData.batch}
      drafts={loaderData.batchDrafts}
      languageId={loaderData.languageId}
    />
  ) : (
    <Editor key={loaderData.id} id={loaderData.id} initial={loaderData.draft} />
  );
}
function Editor({ id, initial }: { id: string; initial?: Draft }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    languageId: initial?.languageId ?? "",
  });
  const [saved, setSaved] = useState(JSON.stringify(form));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hasSaved, setHasSaved] = useState(!!initial);
  const [review, setReview] = useState(false);
  const lock = useRef(false);
  const composition = useRef(false);
  const bypass = useRef(false);
  const attempt = useRef<Lesson | undefined>(undefined);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(form) !== saved;
  const blocker = useBlocker(() => !bypass.current && (dirty || lock.current));
  useBeforeUnload(
    useCallback(
      (event) => {
        if ((dirty || lock.current) && !bypass.current) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );
  const language = form.languageId
    ? registry.resolve(form.languageId)
    : undefined;
  const analysis = language ? analyze(form.body, language) : undefined;
  const change = (field: keyof typeof form, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    attempt.current = undefined;
    setError(undefined);
  };
  const makeDraft = (): Draft => {
    if (!language) throw new Error("请先选择课文内容语言。");
    const issues = checkLimits(form.body);
    if (issues.length) throw new Error(issues[0].message);
    return {
      storageVersion: initial?.storageVersion ?? 0,
      schemaVersion: 1,
      id,
      ...form,
      moduleRef: language.moduleRef,
      sourceRefs: [],
      boundaryWarnings: [],
      updatedAt: new Date().toISOString(),
      sentences: analyze(form.body, language).sentences.map((sentence) => ({
        ...sentence,
        id: `${id}:draft:${sentence.order}`,
      })),
    };
  };
  const save = async () => {
    if (lock.current || composition.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await store.saveDraft(makeDraft());
      setSaved(JSON.stringify(form));
      setHasSaved(true);
      setError(undefined);
      // Retain a stable draft URL after refresh, including drafts first saved here.
      window.history.replaceState(
        window.history.state,
        "",
        `/import?draft=${encodeURIComponent(id)}`,
      );
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const finish = async () => {
    if (lock.current || composition.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!attempt.current)
        attempt.current = confirm(makeDraft(), registry, {
          revisionId: `${id}:1`,
          sentenceId: (order) => `${id}:sentence:${order}`,
          now: new Date().toISOString(),
        });
      await store.confirm(id, attempt.current, initial?.storageVersion ?? 0);
      bypass.current = true;
      setReview(false);
      await navigate(`/lessons/${encodeURIComponent(id)}`);
    } catch (error) {
      setReview(false);
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const locate = (line: number) => {
    const element = editor.current;
    if (!element) return;
    const normalized = form.body.replace(/\r\n?/g, "\n");
    const start = lines(normalized)
      .slice(0, line - 1)
      .reduce((total, text) => total + text.length + 1, 0);
    element.focus({ preventScroll: true });
    element.setSelectionRange(
      start,
      start + (lines(normalized)[line - 1]?.length ?? 0),
    );
    const styles = getComputedStyle(element);
    const lineHeight = parseFloat(styles.lineHeight);
    element.scrollTop = Math.max(
      0,
      parseFloat(styles.paddingTop) +
        (line - 1) * lineHeight -
        (element.clientHeight - lineHeight) / 2,
    );
    element.scrollLeft = 0;
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <Stack
      onCompositionStart={() => {
        composition.current = true;
      }}
      onCompositionEnd={() => {
        composition.current = false;
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
        data={registry
          .list()
          .filter((item) => item.capabilities.textImport)
          .map((item) => ({
            value: item.languageId,
            label: item.label,
          }))}
        value={form.languageId || null}
        onChange={(value) => change("languageId", value ?? "")}
        allowDeselect={false}
        readOnly={busy}
        required
      />
      {!initial && (
        <Group>
          <Button variant="light" disabled>
            粘贴文本
          </Button>
          <Button
            variant="subtle"
            disabled={!language || busy}
            onClick={() => {
              if (!form.body && !form.title && !initial) bypass.current = true;
              void navigate(
                `/import?mode=file&language=${encodeURIComponent(form.languageId)}`,
              );
            }}
          >
            文件导入
          </Button>
        </Group>
      )}
      <TextInput
        label="标题"
        placeholder="未命名课文"
        value={form.title}
        disabled={!language}
        readOnly={busy}
        onChange={(event) => change("title", event.currentTarget.value)}
      />
      <Textarea
        className="editor"
        ref={editor}
        label="正文"
        description="每行一句"
        placeholder="粘贴或输入课文"
        rows={12}
        wrap="off"
        value={form.body}
        disabled={!language}
        readOnly={busy}
        dir={language?.textDirection ?? "ltr"}
        onChange={(event) => change("body", event.currentTarget.value)}
      />
      {language && (
        <Text size="sm" c="dimmed">
          {points(form.body).length.toLocaleString()} / 20,000 字符 ·{" "}
          {lines(form.body).filter((line) => line.trim()).length} / 500 句
        </Text>
      )}
      {form.body.length > 0 && analysis && analysis.issues.length > 0 && (
        <Alert color="red" title="正文有误" role="alert">
          <Stack gap="xs">
            {analysis.issues.map((issue, index) => (
              <Group key={index}>
                <Text size="sm">{issue.message}</Text>
                {issue.line && (
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => locate(issue.line!)}
                  >
                    定位第 {issue.line} 行
                  </Button>
                )}
              </Group>
            ))}
          </Stack>
        </Alert>
      )}
      {error && (
        <Alert color="red" title="操作失败" role="alert">
          {error}
        </Alert>
      )}
      <Stack gap="sm">
        {(dirty || hasSaved) && (
          <Text size="sm" c="dimmed" role="status">
            {dirty ? "有未保存修改" : "草稿已保存"}
          </Text>
        )}
        <Group className="actions">
          <Button
            variant="light"
            disabled={!language || busy}
            loading={busy}
            onClick={() => void save()}
          >
            保存草稿
          </Button>
          <Button
            disabled={!language || busy || !!analysis?.issues.length}
            onClick={() => {
              if (!composition.current) setReview(true);
            }}
          >
            保存为课文
          </Button>
          {hasSaved && (
            <DeleteDraft
              id={id}
              title={form.title}
              disabled={busy}
              unsaved={dirty}
              onPendingChange={(pending) => {
                lock.current = pending;
                setBusy(pending);
              }}
              onDeleted={async () => {
                bypass.current = true;
                await navigate("/library");
              }}
            />
          )}
        </Group>
      </Stack>
      <Modal
        opened={review}
        title={form.title || "未命名课文"}
        onClose={() => {
          if (!busy) setReview(false);
        }}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text>
            确认保存后不可修改内容。课文保存在此浏览器，清除数据会丢失课文和草稿。
          </Text>
          <Group>
            <Button
              variant="light"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              继续编辑
            </Button>
            <Button
              loading={busy}
              disabled={busy}
              onClick={() => void finish()}
            >
              确认保存
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={blocker.state === "blocked"}
        onClose={() => blocker.state === "blocked" && blocker.reset()}
        title="离开编辑窗口"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text>{busy ? "正在保存，请稍候。" : "有未保存修改。"}</Text>
          <Group>
            <Button
              variant="light"
              disabled={busy}
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              继续编辑
            </Button>
            <Button
              color="red"
              variant="subtle"
              disabled={busy}
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              放弃修改并离开
            </Button>
            <Button
              disabled={busy || !language}
              onClick={async () => {
                if (await save()) {
                  if (blocker.state === "blocked") blocker.proceed();
                } else if (blocker.state === "blocked") blocker.reset();
              }}
            >
              保存草稿并离开
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
