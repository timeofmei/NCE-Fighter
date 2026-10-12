import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Alert,
  Button,
  Card,
  Group,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { store } from "../adapters/storage";
import { points, type Lesson } from "../core/lesson";
import {
  correct,
  sentenceText,
  type Session,
  type Event,
} from "../core/training";
import { trainingModule } from "../languages/registry";
import type { TrainingLanguage } from "../core/comparison";
import { errorMessage, LoadError } from "../components/feedback";
import { AttemptFeedback } from "../components/diff";
import type { Route } from "./+types/training";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    return { data: await store.session(params.sessionId), error: undefined };
  } catch (error) {
    return { data: undefined, error: errorMessage(error) };
  }
}
export default function Training({ loaderData }: Route.ComponentProps) {
  if (loaderData.error) return <LoadError message={loaderData.error} />;
  if (!loaderData.data) return <Text>训练不存在。</Text>;
  const { session, lesson } = loaderData.data;
  let module: TrainingLanguage;
  try {
    module = trainingModule(session.languageId, session.moduleRef);
    if (module.comparisonProfileId !== session.comparisonProfileId)
      throw new Error("训练比较版本不可用。");
  } catch (error) {
    return (
      <Stack>
        <Alert color="red">{errorMessage(error)}</Alert>
        <Button component={Link} to={`/results/${session.id}`}>
          查看已保存记录
        </Button>
      </Stack>
    );
  }
  if (session.inputKind !== "keyboard")
    return (
      <Stack>
        <Text>此训练仅支持查看已保存记录。</Text>
        <Button component={Link} to={`/results/${session.id}`}>
          查看已保存记录
        </Button>
      </Stack>
    );
  return (
    <Trainer
      key={session.id}
      initial={session}
      lesson={lesson}
      module={module}
    />
  );
}
function Trainer({
  initial,
  lesson,
  module,
}: {
  initial: Session;
  lesson: Lesson;
  module: TrainingLanguage;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState(initial),
    saved = useRef(initial);
  const [input, setInput] = useState(
      initial.mode !== "sentence_dictation" || initial.status === "checked"
        ? initial.input
        : "",
    ),
    draft = useRef(input);
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    composition = useRef(false);
  const [savedNotice, setSavedNotice] = useState(false);
  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(false), 2500);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);
  const [error, setError] = useState<string>();
  const failedEvent = useRef<Event | undefined>(undefined);
  const pending = useRef<
    | {
        kind: "submit" | "skip";
        requestId: string;
        attemptId: string;
        text: string;
      }
    | undefined
  >(undefined);
  const write = useCallback(async (event: Event) => {
    const next = await store.updateSession(
      saved.current.id,
      saved.current.version,
      event,
      new Date().toISOString(),
      saved.current.generation,
    );
    saved.current = next;
    setSession(next);
    return next;
  }, []);
  const operate = useCallback(
    async (event?: Event, target?: string) => {
      if (lock.current || composition.current) return false;
      lock.current = true;
      setBusy(true);
      try {
        const next = event ? await write(event) : saved.current;
        if (event && ["next", "rewrite"].includes(event.kind)) {
          draft.current = next.input;
          setInput(next.input);
          pending.current = undefined;
        }
        if (event?.kind === "save-draft") setSavedNotice(true);
        setError(undefined);
        failedEvent.current = undefined;
        if (target || next.status === "completed") {
          await navigate(target ?? `/results/${next.id}`);
        }
        return true;
      } catch (error) {
        failedEvent.current = event;
        setError(errorMessage(error));
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [write, navigate],
  );
  useEffect(() => {
    if (initial.status === "completed") {
      void navigate(`/results/${initial.id}`, { replace: true });
    }
  }, [initial, navigate]);
  const submit = (kind: "submit" | "skip") => {
    if (composition.current || lock.current) return;
    if (!pending.current || pending.current.kind !== kind)
      pending.current = {
        kind,
        requestId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        text: draft.current,
      };
    void operate(pending.current);
  };
  const full = session.mode !== "sentence_dictation";
  const reference = sentenceText(lesson, session.sentenceIds[session.index]);
  const last = session.attempts
    .filter((a) => a.sentenceId === session.sentenceIds[session.index])
    .at(-1);
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
        <Title order={1} className="break-text">
          {lesson.title || "未命名课文"}
        </Title>
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => void operate(undefined, `/lessons/${lesson.lessonId}`)}
        >
          返回课文
        </Button>
      </Group>
      {!full && (
        <Group justify="space-between">
          <Text>
            {session.index + 1}/{session.sentenceIds.length}
          </Text>
          <Switch
            label={`提示（${module.hintLabel}）`}
            checked={session.hintVisible}
            disabled={busy || session.status !== "answering"}
            onChange={(e) =>
              void operate({ kind: "hint", visible: e.currentTarget.checked })
            }
          />
        </Group>
      )}
      {!full && session.status === "answering" && session.hintVisible && (
        <Card withBorder>
          <Text dir={module.textDirection}>
            {module
              .buildHint(reference, {
                id: session.sentenceIds[session.index],
                order: 0,
                start: 0,
                end: points(reference).length,
              })
              .fragments.join(" ")}
          </Text>
        </Card>
      )}
      <Textarea
        label={full ? "全文默写" : "本句默写"}
        styles={{ input: { fontSize: 16 } }}
        rows={full ? 16 : 8}
        value={input}
        readOnly={session.status !== "answering" || busy}
        dir={module.textDirection}
        onChange={(e) => {
          draft.current = e.currentTarget.value;
          setInput(draft.current);
          pending.current = undefined;
          setError(undefined);
          setSavedNotice(false);
        }}
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            !composition.current &&
            session.status === "answering"
          ) {
            e.preventDefault();
            submit("submit");
          }
        }}
      />
      {savedNotice && (
        <Text size="sm" role="status">
          草稿已保存
        </Text>
      )}
      {error && (
        <Alert color="red" title="操作失败" role="alert">
          {error}
          <Button
            variant="subtle"
            onClick={() => void operate(failedEvent.current)}
          >
            重试保存
          </Button>
        </Alert>
      )}
      {session.status === "checked" && last && (
        <Card withBorder>
          <AttemptFeedback
            attempt={last}
            reference={reference}
            direction={module.textDirection}
          />
        </Card>
      )}
      <Group className="actions">
        {session.status === "answering" ? (
          <>
            {full && (
              <Button
                variant="light"
                disabled={busy}
                onClick={() =>
                  void operate({ kind: "save-draft", text: draft.current })
                }
              >
                保存草稿
              </Button>
            )}
            <Button disabled={busy} onClick={() => submit("submit")}>
              {full ? "提交全文" : "提交本句"}
            </Button>
            {!full && (
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => submit("skip")}
              >
                跳过本句
              </Button>
            )}
          </>
        ) : (
          <>
            {last && !correct(last) && (
              <Button
                variant="light"
                disabled={busy}
                onClick={() => void operate({ kind: "rewrite" })}
              >
                重写本句
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => void operate({ kind: "next" })}
            >
              {session.index === session.sentenceIds.length - 1
                ? "查看本次结果"
                : "下一句"}
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
