import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import {
  Alert,
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Popover,
  UnstyledButton,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { store } from "../adapters/storage";
import { points } from "../core/lesson";
import type { Session } from "../core/training";
import { trainingModule } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import { DeleteSession } from "../components/delete-session";
import { formatTime } from "../components/format-time";
import type { Route } from "./+types/lesson";

const trainingModes: Record<Session["mode"], { label: string; color: string }> =
  {
    sentence_dictation: { label: "逐句默写", color: "blue" },
  };

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    const lesson = await store.lesson(params.lessonId);
    return {
      lesson,
      sessions: lesson ? await store.sessions(lesson.lessonId) : [],
      error: undefined,
    };
  } catch (error) {
    return { lesson: undefined, sessions: [], error: errorMessage(error) };
  }
}
export default function Lesson({ loaderData }: Route.ComponentProps) {
  const { lesson, error } = loaderData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const clipboard = useClipboard();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string>();
  const lock = useRef(false),
    host = useRef<{ id: string; now: string } | undefined>(undefined);
  useEffect(() => {
    if (lesson) window.getSelection()?.removeAllRanges();
  }, [lesson?.lessonId]);
  if (error) return <LoadError message={error} />;
  if (!lesson)
    return (
      <Stack>
        <Title order={1}>课文不存在</Title>
        <Button component={Link} to="/library">
          返回课文库
        </Button>
      </Stack>
    );
  let language: ReturnType<typeof trainingModule> | undefined,
    unavailable: string | undefined;
  try {
    language = trainingModule(lesson.languageId, lesson.moduleRef);
  } catch (error) {
    unavailable = errorMessage(error);
  }
  const body = points(lesson.body);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      host.current ??= {
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
      };
      const session = await store.startSession(lesson.lessonId, host.current);
      await navigate(`/training/${session.id}`);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Group justify="space-between" wrap="nowrap" align="center">
        <Title order={1} className="break-text lesson-title">
          {lesson.title || "未命名课文"}
        </Title>
        <Popover
          opened={clipboard.copied || !!clipboard.error}
          onDismiss={clipboard.reset}
          position="bottom-end"
          withArrow
          withRoles={false}
        >
          <Popover.Target>
            <ActionIcon
              size="lg"
              variant="subtle"
              aria-label={clipboard.copied ? "已复制全部课文" : "复制全部课文"}
              style={{ flexShrink: 0 }}
              onClick={() => clipboard.copy(lesson.body)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {clipboard.copied ? (
                  <path d="m5 12 4 4L19 6" />
                ) : (
                  <>
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </>
                )}
              </svg>
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm" role={clipboard.error ? "alert" : "status"}>
              {clipboard.error ? "复制失败，请重试。" : "已复制全部课文"}
            </Text>
          </Popover.Dropdown>
        </Popover>
      </Group>
      <Card withBorder>
        <Stack>
          {lesson.sentences.map((sentence) => (
            <Group key={sentence.id} align="baseline" wrap="nowrap" gap="xs">
              <UnstyledButton
                c="dimmed"
                className="sentence-number"
                aria-label={`选中第 ${sentence.order + 1} 行课文`}
                onClick={(event) => {
                  const text =
                    event.currentTarget.parentElement?.querySelector(
                      ".sentence",
                    );
                  const selection = window.getSelection();
                  if (!text || !selection) return;
                  const range = document.createRange();
                  range.selectNodeContents(text);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }}
              >
                {sentence.order + 1}
              </UnstyledButton>
              <Text dir={language?.textDirection} className="sentence">
                {body.slice(sentence.start, sentence.end).join("")}
              </Text>
            </Group>
          ))}
        </Stack>
      </Card>
      <Group>
        <Button disabled={busy || !!unavailable} onClick={() => void start()}>
          逐句默写
        </Button>
        <Button component={Link} to="/library" variant="light">
          返回课文库
        </Button>
      </Group>
      {failure && <Alert color="red">{failure}</Alert>}
      {unavailable && <Alert color="red">{unavailable}</Alert>}
      {loaderData.sessions.length > 0 && (
        <Stack gap="xs">
          <Title order={2}>训练记录</Title>
          {loaderData.sessions.map((session) => (
            <Card key={session.id} withBorder radius="md" padding="sm">
              <Group justify="space-between" data-session-id={session.id}>
                <Group gap="xs">
                  <Badge
                    color={trainingModes[session.mode].color}
                    variant="light"
                    size="lg"
                  >
                    {trainingModes[session.mode].label}
                  </Badge>
                  <Badge
                    color={session.status === "completed" ? "teal" : "orange"}
                    variant="light"
                    size="lg"
                  >
                    {session.status === "completed" ? "已完成" : "未完成"}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {formatTime(session.updatedAt)}
                  </Text>
                </Group>
                <Group gap="xs">
                  <Button
                    component={Link}
                    variant="light"
                    to={
                      session.status === "completed"
                        ? `/results/${session.id}`
                        : `/training/${session.id}`
                    }
                  >
                    {session.status === "completed" ? "查看结果" : "继续训练"}
                  </Button>
                  <DeleteSession
                    session={session}
                    lessonTitle={lesson.title}
                    hasPractice={loaderData.sessions.some(
                      (item) => item.sourceSessionId === session.id,
                    )}
                    disabled={busy || revalidator.state !== "idle"}
                    onDeleted={() => revalidator.revalidate()}
                  />
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
