import { useRef, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { store } from "../adapters/storage";
import { errorMessage } from "./feedback";
import type { Session } from "../core/training";

export function DeleteSession({
  session,
  lessonTitle,
  hasPractice,
  disabled,
  onDeleted,
}: {
  session: Session;
  lessonTitle: string;
  hasPractice: boolean;
  disabled?: boolean;
  onDeleted(): void | Promise<void>;
}) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const lock = useRef(false);
  const label = `${lessonTitle || "未命名课文"} · ${new Date(session.updatedAt).toLocaleString()}`;
  const remove = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await store.deleteSession(session.id);
      setOpened(false);
      await onDeleted();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        color="red"
        variant="subtle"
        disabled={disabled || busy}
        aria-label={`删除 ${label} 的训练记录`}
        onClick={() => {
          setError(undefined);
          setOpened(true);
        }}
      >
        删除记录
      </Button>
      <Modal
        opened={opened}
        title={label}
        onClose={() => {
          if (!lock.current) setOpened(false);
        }}
        withCloseButton={!busy}
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
      >
        <Stack>
          <Text>
            这次训练的输入、作答和结果将被删除，无法恢复。
            {hasPractice ? "相关重练记录会保留。" : ""}
          </Text>
          {error && (
            <Alert role="alert" color="red" title="删除失败">
              {error}
            </Alert>
          )}
          <Group>
            <Button
              variant="light"
              disabled={busy}
              onClick={() => setOpened(false)}
            >
              取消
            </Button>
            <Button
              color="red"
              disabled={busy}
              loading={busy}
              onClick={() => void remove()}
            >
              删除
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
