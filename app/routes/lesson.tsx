import { useRef, useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import { Alert, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { store } from "../adapters/storage";
import { points } from "../core/lesson";
import { trainingModule } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import { DeleteSession } from "../components/delete-session";
import type { Route } from "./+types/lesson";

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
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string>();
  const lock = useRef(false),
    host = useRef<{ id: string; now: string } | undefined>(undefined);
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
      <Title order={1} className="break-text lesson-title">
        {lesson.title || "未命名课文"}
      </Title>
      <Card withBorder>
        <Stack>
          {lesson.sentences.map((sentence) => (
            <Group key={sentence.id} align="start" wrap="nowrap">
              <Text c="dimmed" size="sm" w={28} style={{ flexShrink: 0 }}>
                {sentence.order + 1}
              </Text>
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
            <Group
              key={session.id}
              justify="space-between"
              data-session-id={session.id}
            >
              <Text>
                {new Date(session.updatedAt).toLocaleString()} ·{" "}
                {session.status === "completed" ? "已完成" : "未完成"}
              </Text>
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
          ))}
        </Stack>
      )}
    </Stack>
  );
}
