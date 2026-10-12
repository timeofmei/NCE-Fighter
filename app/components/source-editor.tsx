import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { lineRegions, type LocalDocument } from "../adapters/document";
import type { Source } from "../core/document";
import { errorMessage } from "./feedback";

export function SourceEditor({
  document: doc,
  disabled,
  onChange,
  allowOrder = true,
}: {
  document: LocalDocument;
  disabled: boolean;
  onChange(index: number): void;
  allowOrder?: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null),
    rendered = useRef<HTMLCanvasElement | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const [zoom, setZoom] = useState<number | string>(100);
  const item = doc.pages[pageIndex];
  const change = () => {
    onChange(pageIndex);
    setRevision((n) => n + 1);
  };
  useEffect(() => {
    let active = true;
    void doc
      .render(pageIndex)
      .then((canvas) => {
        if (!active) {
          canvas.width = 1;
          return;
        }
        rendered.current = canvas;
        const preview = canvasRef.current;
        if (preview) {
          preview.width = canvas.width;
          preview.height = canvas.height;
          const ctx = preview.getContext("2d")!;
          ctx.drawImage(canvas, 0, 0);
          ctx.strokeStyle = "#00856a";
          ctx.lineWidth = Math.max(2, canvas.width / 400);
          item.regions.forEach((r, i) => {
            ctx.strokeRect(
              r.x * canvas.width,
              r.y * canvas.height,
              r.width * canvas.width,
              r.height * canvas.height,
            );
            ctx.font = `${Math.max(16, canvas.width / 60)}px sans-serif`;
            ctx.fillStyle = "#00856a";
            ctx.fillText(
              String(i + 1),
              r.x * canvas.width + 3,
              r.y * canvas.height + 20,
            );
          });
        }
        setError(undefined);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
      if (rendered.current) rendered.current.width = 1;
      rendered.current = undefined;
    };
  }, [doc, pageIndex, revision, item]);
  const coordinates = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const updateRect = (
    index: number,
    field: keyof Source["rect"],
    value: number,
  ) => {
    const r = { ...item.regions[index], [field]: value / 100 };
    if (
      r.x >= 0 &&
      r.y >= 0 &&
      r.width > 0 &&
      r.height > 0 &&
      r.x + r.width <= 1.000001 &&
      r.y + r.height <= 1.000001
    ) {
      item.regions[index] = r;
      change();
    }
  };
  return (
    <Stack>
      <Select
        label="来源页"
        data={doc.pages.map((p, i) => ({
          value: String(i),
          label: `${i + 1} · ${doc.batch.files.find((f) => f.id === p.source.fileId)?.name ?? ""}`,
        }))}
        value={String(pageIndex)}
        disabled={disabled}
        onChange={(v) => setPageIndex(Number(v))}
      />
      <Select
        label="处理方式"
        data={[
          { value: "text", label: "提取文字层" },
          { value: "ocr", label: "图片文字识别" },
        ]}
        value={item.mode}
        disabled={disabled || !item.text}
        onChange={(v) => {
          item.mode = v as "text" | "ocr";
          change();
        }}
      />
      <Group>
        <Button
          variant="subtle"
          disabled={disabled || !allowOrder || pageIndex === 0}
          onClick={() => {
            [doc.pages[pageIndex - 1], doc.pages[pageIndex]] = [
              doc.pages[pageIndex],
              doc.pages[pageIndex - 1],
            ];
            doc.pages.forEach((p, i) => (p.source.order = i));
            setPageIndex(pageIndex - 1);
            change();
          }}
        >
          来源上移
        </Button>
        <Button
          variant="subtle"
          disabled={
            disabled || !allowOrder || pageIndex === doc.pages.length - 1
          }
          onClick={() => {
            [doc.pages[pageIndex + 1], doc.pages[pageIndex]] = [
              doc.pages[pageIndex],
              doc.pages[pageIndex + 1],
            ];
            doc.pages.forEach((p, i) => (p.source.order = i));
            setPageIndex(pageIndex + 1);
            change();
          }}
        >
          来源下移
        </Button>
        <Button
          variant="light"
          disabled={disabled}
          onClick={() => {
            item.source.rotation = ((item.source.rotation + 90) %
              360) as Source["rotation"];
            item.regions = [];
            change();
          }}
        >
          旋转 90°
        </Button>
        {item.mode === "ocr" && (
          <>
            <Button
              variant="light"
              disabled={disabled}
              onClick={() => {
                const canvas = rendered.current;
                if (!canvas) return;
                item.regions = lineRegions(
                  canvas
                    .getContext("2d")!
                    .getImageData(0, 0, canvas.width, canvas.height),
                );
                change();
              }}
            >
              自动分行
            </Button>
            <Button
              variant="subtle"
              disabled={disabled}
              onClick={() => {
                item.regions = [];
                change();
              }}
            >
              清除区域
            </Button>
          </>
        )}
      </Group>
      {item.mode === "ocr" && (
        <Text size="sm">框选一行文字；区域按列表顺序识别。</Text>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <NumberInput
        label="预览缩放 %"
        min={50}
        max={300}
        value={zoom}
        onChange={setZoom}
      />
      <div style={{ overflow: "auto", maxHeight: "75vh" }}>
        <canvas
          ref={canvasRef}
          aria-label="来源预览与框选"
          className="source-canvas"
          style={{ width: `${Number(zoom) || 100}%` }}
          onPointerDown={(event) => {
            if (disabled || item.mode !== "ocr") return;
            drag.current = coordinates(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onPointerUp={(event) => {
            if (!drag.current || disabled) return;
            const end = coordinates(event),
              start = drag.current;
            drag.current = undefined;
            const r = {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width: Math.abs(start.x - end.x),
              height: Math.abs(start.y - end.y),
            };
            if (r.width > 0.005 && r.height > 0.005) {
              item.regions.push(r);
              change();
            }
          }}
        />
      </div>
      {item.mode === "ocr" &&
        item.regions.map((r, index) => (
          <Stack key={index} gap="xs">
            <Text size="sm">区域 {index + 1}</Text>
            <Group grow>
              {(["x", "y", "width", "height"] as const).map((field, i) => (
                <NumberInput
                  key={field}
                  label={["左侧 %", "顶部 %", "宽度 %", "高度 %"][i]}
                  value={Math.round(r[field] * 10000) / 100}
                  min={field === "x" || field === "y" ? 0 : 0.01}
                  max={100}
                  decimalScale={2}
                  disabled={disabled}
                  onChange={(v) => {
                    if (typeof v === "number") updateRect(index, field, v);
                  }}
                />
              ))}
            </Group>
            <Group>
              <Button
                size="xs"
                variant="subtle"
                disabled={disabled}
                onClick={() => {
                  const upper = { ...r, height: r.height / 2 },
                    lower = {
                      ...r,
                      y: r.y + r.height / 2,
                      height: r.height / 2,
                    };
                  item.regions.splice(index, 1, upper, lower);
                  change();
                }}
              >
                上下拆分
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={disabled || index === item.regions.length - 1}
                onClick={() => {
                  const other = item.regions[index + 1],
                    x = Math.min(r.x, other.x),
                    y = Math.min(r.y, other.y);
                  item.regions.splice(index, 2, {
                    x,
                    y,
                    width: Math.max(r.x + r.width, other.x + other.width) - x,
                    height:
                      Math.max(r.y + r.height, other.y + other.height) - y,
                  });
                  change();
                }}
              >
                合并下一区域
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={disabled || index === 0}
                onClick={() => {
                  [item.regions[index - 1], item.regions[index]] = [
                    item.regions[index],
                    item.regions[index - 1],
                  ];
                  change();
                }}
              >
                上移
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={disabled || index === item.regions.length - 1}
                onClick={() => {
                  [item.regions[index + 1], item.regions[index]] = [
                    item.regions[index],
                    item.regions[index + 1],
                  ];
                  change();
                }}
              >
                下移
              </Button>
              <Button
                size="xs"
                color="red"
                variant="subtle"
                disabled={disabled}
                onClick={() => {
                  item.regions.splice(index, 1);
                  change();
                }}
              >
                删除区域
              </Button>
            </Group>
          </Stack>
        ))}
    </Stack>
  );
}
