import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Accordion,
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { store } from "../adapters/storage";
import { correct, sentenceText, summarize } from "../core/training";
import { trainingModule } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import { WholeResult } from "../components/whole-result";
import { AttemptFeedback } from "../components/diff";
import { formatTime } from "../components/format-time";
import type { Route } from "./+types/result";
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    return { data: await store.session(params.sessionId), error: undefined };
  } catch (error) {
    return { data: undefined, error: errorMessage(error) };
  }
}
export default function Result({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate(),
    lock = useRef(false);
  const [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const host = useRef<{ id: string; now: string; wrong: boolean } | undefined>(
    undefined,
  );
  if (loaderData.error) return <LoadError message={loaderData.error} />;
  if (!loaderData.data) return <Text>训练不存在。</Text>;
  const { session, lesson } = loaderData.data,
    summary = summarize(session);
  let unavailable: string | undefined;
  try {
    const module = trainingModule(session.languageId, session.moduleRef);
    if (module.comparisonProfileId !== session.comparisonProfileId)
      throw new Error("训练比较版本不可用。");
  } catch (error) {
    unavailable = errorMessage(error);
  }
  const start = async (wrong: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!host.current || host.current.wrong !== wrong)
        host.current = {
          id: crypto.randomUUID(),
          now: new Date().toISOString(),
          wrong,
        };
      const next = await store.startSession(
        lesson.lessonId,
        host.current,
        wrong
          ? { sourceSessionId: session.id }
          : { mode: session.mode, inputKind: session.inputKind },
      );
      await navigate(`/training/${next.id}`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (session.mode !== "sentence_dictation")
    return (
      <Stack>
        <Title order={1} className="break-text">
          {lesson.title || "未命名课文"}
        </Title>
        <Text>
          {session.mode === "recitation" ? "整篇背诵" : "全文默写"} ·{" "}
          {session.completedAt ? formatTime(session.completedAt) : "未完成"}
        </Text>
        {session.attempts[0] && (
          <WholeResult
            attempt={session.attempts[0]}
            lesson={lesson}
            direction={session.textDirection}
          />
        )}
        {(error || unavailable) && (
          <Alert color="red">{error ?? unavailable}</Alert>
        )}
        <Group>
          {session.status === "completed" &&
            session.inputKind === "keyboard" && (
              <Button
                disabled={busy || !!unavailable}
                onClick={() => void start(false)}
              >
                重新默写全文
              </Button>
            )}
          <Button
            component={Link}
            variant="subtle"
            to={`/lessons/${lesson.lessonId}`}
          >
            返回课文
          </Button>
        </Group>
      </Stack>
    );
  const totals = summary.first.reduce(
    (total, a) => ({
      N: total.N + (a.result?.N ?? 0),
      S: total.S + (a.result?.S ?? 0),
      D: total.D + (a.result?.D ?? 0),
      I: total.I + (a.result?.I ?? 0),
    }),
    { N: 0, S: 0, D: 0, I: 0 },
  );
  return (
    <Stack>
      <Title order={1} className="break-text">
        {lesson.title || "未命名课文"}
      </Title>
      <Text>
        逐句默写 ·{" "}
        {session.status === "completed"
          ? formatTime(session.completedAt!)
          : `已完成 ${summary.first.length}/${session.sentenceIds.length}`}
      </Text>
      <Text>
        首次完全正确 {summary.independent + summary.hinted} · 错误{" "}
        {summary.errors} · 跳过 {summary.skipped}
      </Text>
      <Text>
        重试 {summary.retries} 次 · 其中完全正确 {summary.retryCorrect} 次
      </Text>
      {totals.N > 0 && (
        <Text>
          {summary.first.find((a) => a.result)?.result?.accuracyLabel}{" "}
          {(
            Math.max(0, 1 - (totals.S + totals.D + totals.I) / totals.N) * 100
          ).toFixed(1)}
          % · 遗漏 {totals.D} · 多余 {totals.I} · 替换 {totals.S}（
          {summary.first.find((a) => a.result)?.result?.unitLabel}；已提交句）
        </Text>
      )}
      {session.attempts.some((a) => a.hintUsed) && <Text>本次使用过提示</Text>}
      {(error || unavailable) && (
        <Alert color="red">{error ?? unavailable}</Alert>
      )}
      <Accordion
        multiple
        defaultValue={summary.first
          .filter((a) => !correct(a))
          .map((a) => a.sentenceId!)}
      >
        {summary.first.map((a) => (
          <Accordion.Item key={a.sentenceId} value={a.sentenceId!}>
            <Accordion.Control>
              第 {lesson.sentences.findIndex((s) => s.id === a.sentenceId!) + 1}{" "}
              句 ·{" "}
              {a.status === "skipped"
                ? "跳过"
                : correct(a)
                  ? "完全正确"
                  : "错误"}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack>
                {session.attempts
                  .filter((attempt) => attempt.sentenceId === a.sentenceId!)
                  .map((attempt, i) => (
                    <Stack key={attempt.id}>
                      <Text size="sm">{i ? `复练 ${i}` : "首次作答"}</Text>
                      <AttemptFeedback
                        attempt={attempt}
                        reference={sentenceText(lesson, a.sentenceId!)}
                        direction={session.textDirection}
                      />
                    </Stack>
                  ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Group>
        {session.status === "completed" && (
          <>
            <Button
              disabled={busy || !!unavailable || !summary.wrongIds.length}
              onClick={() => void start(true)}
            >
              重练错误与跳过句
            </Button>
            <Button
              variant="light"
              disabled={busy || !!unavailable}
              onClick={() => void start(false)}
            >
              重新练习整篇
            </Button>
          </>
        )}
        <Button
          component={Link}
          variant="subtle"
          to={`/lessons/${lesson.lessonId}`}
        >
          返回课文
        </Button>
      </Group>
    </Stack>
  );
}
