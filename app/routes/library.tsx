import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
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
  const [helpOpened, setHelpOpened] = useState(false);
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
      <Group justify="space-between" wrap="nowrap">
        <Title order={1}>课文库</Title>
        <Button variant="subtle" onClick={() => setHelpOpened(true)}>
          帮助
        </Button>
      </Group>
      <Modal
        opened={helpOpened}
        onClose={() => setHelpOpened(false)}
        withCloseButton={false}
        aria-label="帮助"
      >
        <Stack>
          <div className="library-help-content">
            <s>翻开新概念之前我简直是在乱学英语</s>
            <Text>跟NCE Fighter一起背课文吧！</Text>
            <Text>先导入课文，然后按你喜欢的方式检查背诵成果就好~</Text>
            <Text>（BGM起）</Text>
            <Text>🎵那年仲夏 你背上行囊离开家🎵</Text>
            <Text>🎵古道旁 我欲语泪先下🎵</Text>
          </div>
          <Group justify="center">
            <Button onClick={() => setHelpOpened(false)}>确定</Button>
          </Group>
        </Stack>
      </Modal>
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
          {items.length > 0 && !filtered.length && (
            <Text>没有匹配的课文。</Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Card
              component={Link}
              to="/import"
              aria-label="导入课文"
              withBorder
              className="lesson-card import-card"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </Card>
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
