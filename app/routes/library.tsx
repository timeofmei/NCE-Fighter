import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import {
  Badge,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { store } from "../adapters/storage";
import { registry } from "../languages/registry";
import { errorMessage, LoadError } from "../components/feedback";
import { DeleteDraft } from "../components/delete-draft";
import { LessonCard } from "../components/lesson-card";
import { formatTime } from "../components/format-time";
import type { Route } from "./+types/library";

export async function clientLoader() {
  try {
    const [data, sessions] = await Promise.all([
      store.list(),
      store.sessions(),
    ]);
    const recentTraining: Record<string, string> = {};
    for (const session of sessions)
      recentTraining[session.lessonId] ??= session.updatedAt;
    return { data, recentTraining, error: undefined };
  } catch (error) {
    return {
      data: undefined,
      recentTraining: {} as Record<string, string>,
      error: errorMessage(error),
    };
  }
}
export default function Library({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const items = loaderData.data
    ? [
        ...loaderData.data.drafts.map((draft) => ({
          id: draft.id,
          title: draft.title,
          sentenceCount: draft.sentences.length,
          languageId: draft.languageId,
          state: "draft",
          date: draft.updatedAt,
        })),
        ...loaderData.data.lessons.map((lesson) => ({
          id: lesson.lessonId,
          title: lesson.title,
          sentenceCount: lesson.sentences.length,
          languageId: lesson.languageId,
          state: "confirmed",
          date: lesson.confirmedAt,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const filtered = items.filter(
    (item) =>
      (item.title || "未命名课文")
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || item.state === status) &&
      (!language || item.languageId === language),
  );
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>课文库</Title>
        <Button component={Link} to="/import">
          导入课文
        </Button>
      </Group>
      {loaderData.error ? (
        <LoadError message={loaderData.error} />
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput
              label="搜索标题"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <Select
              label="内容语言"
              placeholder="全部语言"
              clearable
              data={registry
                .list()
                .map((item) => ({ value: item.languageId, label: item.label }))}
              value={language}
              onChange={setLanguage}
            />
            <Select
              label="状态"
              placeholder="全部状态"
              clearable
              data={[
                { value: "draft", label: "待校对" },
                { value: "confirmed", label: "已确认" },
              ]}
              value={status}
              onChange={setStatus}
            />
          </SimpleGrid>
          {!items.length && (
            <Card withBorder>
              <Text>还没有课文。</Text>
            </Card>
          )}
          {items.length > 0 && !filtered.length && (
            <Text>没有匹配的课文。</Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {filtered.map((item) => {
              const lang = registry
                .list()
                .find((language) => language.languageId === item.languageId);
              const renderCard = (onLongPress?: () => void) => (
                <LessonCard
                  key={item.id}
                  title={item.title}
                  state={item.state}
                  to={
                    item.state === "draft"
                      ? `/import?draft=${encodeURIComponent(item.id)}`
                      : `/lessons/${encodeURIComponent(item.id)}`
                  }
                  onLongPress={onLongPress}
                >
                  <Stack gap="sm">
                    <Group>
                      <Badge color={item.state === "draft" ? "orange" : "teal"}>
                        {item.state === "draft" ? "待校对" : "已确认"}
                      </Badge>
                      <Text size="sm">{lang?.label ?? item.languageId}</Text>
                    </Group>
                    <Text fw={700} className="break-text">
                      {item.title || "未命名课文"}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {item.sentenceCount} 句
                    </Text>
                    {item.state === "confirmed" &&
                      loaderData.recentTraining[item.id] && (
                        <Text size="sm" c="dimmed">
                          最近训练{" "}
                          {formatTime(loaderData.recentTraining[item.id])}
                        </Text>
                      )}
                  </Stack>
                </LessonCard>
              );
              return item.state === "draft" ? (
                <DeleteDraft
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  trigger={renderCard}
                  onDeleted={() => revalidator.revalidate()}
                />
              ) : (
                renderCard()
              );
            })}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
