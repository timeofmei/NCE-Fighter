import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Group, Modal, Stack, Text, Title } from "@mantine/core";
import {
  clearResources,
  downloadResources,
  missingResources,
  OCR_NAME,
  ocrResources,
} from "../adapters/resources";
import type { DeviceResult } from "../adapters/ocr";
import { UserDataDialog } from "../components/user-data-dialog";
import { errorMessage } from "../components/feedback";

export default function Resources() {
  const [missing, setMissing] = useState<number>(),
    [device, setDevice] = useState<DeviceResult>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState<string>(),
    [confirmDownload, setConfirmDownload] = useState(false),
    [confirmClear, setConfirmClear] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined),
    lock = useRef(false);
  const refresh = async () => {
    try {
      const list = await missingResources();
      setMissing(list.reduce((n, r) => n + r.bytes, 0));
      const raw = localStorage.getItem("nce-fighter-ocr-device");
      const value = raw ? (JSON.parse(raw) as DeviceResult) : undefined;
      setDevice(
        value?.environment === navigator.userAgent &&
          value.model === "ppocr-2612ab37-ort-1.30.0-fp32"
          ? value
          : undefined,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, []);
  const test = async (download = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const abort = new AbortController();
    controller.current = abort;
    let ocr: import("../adapters/ocr").LocalOcr | undefined;
    try {
      if (download) {
        setMessage("下载识别资源");
        await downloadResources(abort.signal, (n, total) =>
          setMessage(`下载 ${Math.round((n / Math.max(1, total)) * 100)}%`),
        );
      }
      setMessage("初始化与预热");
      const { LocalOcr } = await import("../adapters/ocr");
      ocr = new LocalOcr(abort.signal);
      await ocr.initialize();
      setMessage("本地识别可用");
      await refresh();
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(errorMessage(e));
        localStorage.removeItem("nce-fighter-ocr-device");
        setDevice(undefined);
      }
    } finally {
      ocr?.close();
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>本地资源</Title>
        <Button component={Link} to="/library" variant="subtle" disabled={busy}>
          返回课文库
        </Button>
      </Group>
      <Text>{OCR_NAME}</Text>
      <Text>
        {missing === undefined
          ? "检查缓存…"
          : missing === 0
            ? "资源已缓存"
            : `待下载 ${(missing / 1000000).toFixed(2)} MB`}{" "}
        · 总资源{" "}
        {(ocrResources.reduce((n, r) => n + r.bytes, 0) / 1000000).toFixed(2)}{" "}
        MB
      </Text>
      {device && (
        <Text>
          本地识别已通过初始化与预热 ·{" "}
          {new Date(device.testedAt).toLocaleString()} · 初始化{" "}
          {Math.round(device.initializedMs)} ms
        </Text>
      )}
      <Group>
        <Button
          disabled={busy || missing === undefined}
          onClick={() => {
            if (missing) setConfirmDownload(true);
            else void test();
          }}
        >
          {missing ? "下载所需资源" : "重新检测"}
        </Button>
        <Button
          variant="light"
          disabled={busy}
          onClick={() => setConfirmClear(true)}
        >
          清理模型缓存
        </Button>
        <UserDataDialog onImported={() => {}} />
      </Group>
      {busy && (
        <Group>
          <Text role="status">{message}</Text>
          <Button variant="subtle" onClick={() => controller.current?.abort()}>
            取消
          </Button>
        </Group>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
          <Button
            variant="subtle"
            onClick={() => {
              void refresh();
            }}
          >
            重试
          </Button>
        </Alert>
      )}
      <Modal
        opened={confirmDownload}
        title="下载本地识别资源"
        onClose={() => setConfirmDownload(false)}
      >
        <Stack>
          <Text>
            {OCR_NAME} · {(missing ?? 0) / 1000000} MB
          </Text>
          <Group>
            <Button
              onClick={() => {
                setConfirmDownload(false);
                void test(true);
              }}
            >
              下载并检测
            </Button>
            <Button variant="light" onClick={() => setConfirmDownload(false)}>
              取消
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={confirmClear}
        title="清理模型缓存"
        onClose={() => setConfirmClear(false)}
      >
        <Stack>
          <Text>清理后需要重新下载识别资源。课文和训练记录保留。</Text>
          <Group>
            <Button
              onClick={async () => {
                try {
                  await clearResources();
                  setConfirmClear(false);
                  setDevice(undefined);
                  await refresh();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              确认清理
            </Button>
            <Button variant="light" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
