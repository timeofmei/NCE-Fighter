import { Link } from "react-router";
import { Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { store } from "../adapters/storage";
import { points } from "../core/lesson";
import { registry } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import type { Route } from "./+types/lesson";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    return { lesson: await store.lesson(params.lessonId), error: undefined };
  } catch (error) {
    return { lesson: undefined, error: errorMessage(error) };
  }
}
export default function Lesson({ loaderData }: Route.ComponentProps) {
  const { lesson, error } = loaderData;
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
  const language = registry.resolve(lesson.languageId, lesson.moduleRef);
  const body = points(lesson.body);
  return (
    <Stack>
      <Group>
        <Badge>已确认 · 只读</Badge>
        <Text>
          {language.label} · {lesson.sentences.length} 句
        </Text>
      </Group>
      <Title order={1} className="break-text">
        {lesson.title || "未命名课文"}
      </Title>
      <Card withBorder>
        <Stack>
          {lesson.sentences.map((sentence) => (
            <Group key={sentence.id} align="start" wrap="nowrap">
              <Text c="dimmed" size="sm" w={28} style={{ flexShrink: 0 }}>
                {sentence.order + 1}
              </Text>
              <Text dir={language.textDirection} className="sentence">
                {body.slice(sentence.start, sentence.end).join("")}
              </Text>
            </Group>
          ))}
        </Stack>
      </Card>
      <Group>
        <Button component={Link} to="/library" variant="light">
          返回课文库
        </Button>
        <Button component={Link} to="/import">
          新建导入
        </Button>
      </Group>
    </Stack>
  );
}
