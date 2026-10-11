import { useRef, useState, type ReactNode } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { store } from "../adapters/storage";
import { errorMessage } from "./feedback";

interface Props {
  id: string;
  title: string;
  disabled?: boolean;
  unsaved?: boolean;
  trigger?(open: () => void): ReactNode;
  onPendingChange?(pending: boolean): void;
  onDeleted(): void | Promise<void>;
}

export function DeleteDraft({
  id,
  title,
  disabled,
  unsaved,
  trigger,
  onPendingChange,
  onDeleted,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const open = () => {
    if (disabled || lock.current) return;
    setError(undefined);
    setOpened(true);
  };
  const remove = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onPendingChange?.(true);
    try {
      await store.deleteDraft(id);
      await onDeleted();
      setOpened(false);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
      onPendingChange?.(false);
    }
  };
  return (
    <>
      {trigger ? (
        trigger(open)
      ) : (
        <Button
          color="red"
          variant="subtle"
          disabled={disabled || busy}
          onClick={open}
        >
          删除草稿
        </Button>
      )}
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title={title || "未命名课文"}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text>
            {unsaved
              ? "草稿及当前未保存修改将被删除，无法恢复。"
              : "删除后无法恢复。"}
          </Text>
          {error && (
            <Alert color="red" title="删除失败" role="alert">
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
              loading={busy}
              disabled={busy}
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
