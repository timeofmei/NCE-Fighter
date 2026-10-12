import { useRef, useState } from "react";
import {
  Alert,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { store } from "../adapters/storage";
import { systemInfo } from "../adapters/system";
import { parseUserData, type UserData } from "../core/user-data";
import { errorMessage } from "./feedback";

export function UserDataDialog({
  onImported,
}: {
  onImported(): void | Promise<void>;
}) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(),
    [data, setData] = useState<UserData>();
  const [exporting, setExporting] = useState(false);
  const lock = useRef(false);
  const read = async (file: File | null) => {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setData(await store.checkImport(parseUserData(await file.text())));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const exportAll = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setExporting(true);
    setError(undefined);
    try {
      const data = await store.exportData(await systemInfo());
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "nce-fighter.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
      setExporting(false);
    }
  };
  const importAll = async () => {
    if (!data || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await store.importData(data);
      setData(undefined);
      setOpened(false);
      await onImported();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="subtle"
        onClick={() => {
          setError(undefined);
          setData(undefined);
          setOpened(true);
        }}
      >
        导入/导出
      </Button>
      <Modal
        centered
        opened={opened}
        title={data ? "导入用户数据" : exporting ? "正在导出" : "导入/导出"}
        onClose={() => {
          if (!lock.current) {
            setOpened(false);
            setData(undefined);
          }
        }}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          {error && (
            <Alert role="alert" color="red">
              {error}
            </Alert>
          )}
          {exporting ? (
            <Group>
              <Loader size="sm" />
              <Text>正在导出全部已保存用户数据，请稍候。</Text>
            </Group>
          ) : data ? (
            <>
              <Text>将合并现有数据，是否确认导入？</Text>
              <Group>
                <Button
                  variant="light"
                  disabled={busy}
                  onClick={() => {
                    setData(undefined);
                    setError(undefined);
                  }}
                >
                  取消
                </Button>
                <Button
                  loading={busy}
                  disabled={busy}
                  onClick={() => void importAll()}
                >
                  导入
                </Button>
              </Group>
            </>
          ) : (
            <Group>
              <FileButton
                accept="application/json,.json"
                onChange={(file) => void read(file)}
              >
                {(props) => (
                  <Button {...props} disabled={busy}>
                    导入 JSON
                  </Button>
                )}
              </FileButton>
              <Button
                variant="light"
                disabled={busy}
                onClick={() => void exportAll()}
              >
                导出全部用户数据
              </Button>
            </Group>
          )}
        </Stack>
      </Modal>
    </>
  );
}
