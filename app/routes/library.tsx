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
import type { Route } from "./+types/library";

export async function clientLoader() {
  try {
    return { data: await store.list(), error: undefined };
  } catch (error) {
    return { data: undefined, error: errorMessage(error) };
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
              const lang = registry.resolve(item.languageId);
              return (
                <Card withBorder key={item.id}>
                  <Stack gap="sm">
                    <Group>
                      <Badge color={item.state === "draft" ? "orange" : "teal"}>
                        {item.state === "draft" ? "待校对" : "已确认"}
                      </Badge>
                      <Text size="sm">{lang.label}</Text>
                    </Group>
                    <Text fw={700} className="break-text">
                      {item.title || "未命名课文"}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {item.sentenceCount} 句
                    </Text>
                    <Group>
                      <Button
                        component={Link}
                        variant="light"
                        to={
                          item.state === "draft"
                            ? `/import?draft=${encodeURIComponent(item.id)}`
                            : `/lessons/${encodeURIComponent(item.id)}`
                        }
                      >
                        {item.state === "draft" ? "继续编辑" : "阅读课文"}
                      </Button>
                      {item.state === "draft" && (
                        <DeleteDraft
                          id={item.id}
                          title={item.title}
                          onDeleted={() => revalidator.revalidate()}
                        />
                      )}
                    </Group>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
