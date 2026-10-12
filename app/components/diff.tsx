import { Stack, Text } from "@mantine/core";
import type { Attempt } from "../core/training";
import { correct } from "../core/training";
import { points } from "../core/lesson";
import type { Operation } from "../core/comparison";

export function ColoredText({
  text,
  operations,
  side,
}: {
  text: string;
  operations: Operation[];
  side: "reference" | "actual";
}) {
  const source = points(text);
  const marks: ("match" | "error" | undefined)[] = new Array(source.length);
  for (const operation of operations) {
    const unit = operation[side];
    if (!unit) continue;
    for (let i = unit.sourceRange.start; i < unit.sourceRange.end; i++) {
      // Expanded normalization may share a range; a difference takes priority.
      if (marks[i] !== "error")
        marks[i] = operation.kind === "match" ? "match" : "error";
    }
  }
  const fragments = [];
  for (let start = 0; start < source.length;) {
    let end = start + 1;
    while (end < source.length && marks[end] === marks[start]) end++;
    const content = source.slice(start, end).join("");
    fragments.push(
      marks[start] ? (
        <Text
          component="span"
          key={start}
          c={marks[start] === "match" ? "green.8" : "red.8"}
          data-diff={marks[start]}
        >
          {content}
        </Text>
      ) : (
        content
      ),
    );
    start = end;
  }
  return fragments;
}

export function AttemptFeedback({
  attempt,
  reference,
  direction,
  showOperations = true,
}: {
  attempt: Attempt;
  reference: string;
  direction: "ltr" | "rtl";
  showOperations?: boolean;
}) {
  const result = attempt.result;
  const summary = result && (
    <Text>
      {result.accuracyLabel} {result.accuracy.toFixed(1)}% · 遗漏 {result.D} ·
      多余 {result.I} · 替换 {result.S}（{result.unitLabel}）
    </Text>
  );
  return (
    <Stack gap="xs">
      <Text fw={700}>
        {attempt.status === "skipped"
          ? "已跳过"
          : correct(attempt)
            ? "完全正确"
            : "存在差异"}
      </Text>
      {attempt.sentenceId === null && summary}
      <Text size="sm" c="dimmed">
        你的输入
      </Text>
      <Text dir={direction} className="sentence">
        {attempt.confirmedText ? (
          <ColoredText
            text={attempt.confirmedText}
            operations={result?.operations ?? []}
            side="actual"
          />
        ) : (
          "（空）"
        )}
      </Text>
      <Text size="sm" c="dimmed">
        {attempt.sentenceId === null ? "标准课文" : "标准原句"}
      </Text>
      <Text dir={direction} className="sentence">
        <ColoredText
          text={reference}
          operations={result?.operations ?? []}
          side="reference"
        />
      </Text>
      {attempt.sentenceId !== null && summary}
      {showOperations &&
        result?.operations
          .filter((o) => o.kind !== "match")
          .map((op, i) => (
            <Text key={i} dir={direction} className="sentence">
              {op.kind === "delete"
                ? `遗漏 1 个${result.unitLabel}：${op.reference!.displayText}`
                : op.kind === "insert"
                  ? `多余 1 个${result.unitLabel}：${op.actual!.displayText}`
                  : `替换 1 个${result.unitLabel}：${op.reference!.displayText} → ${op.actual!.displayText}`}
              <Text component="span" size="xs" c="dimmed">
                {op.reference
                  ? `（原句位置 ${op.reference.sourceRange.start + 1}–${op.reference.sourceRange.end}）`
                  : `（输入位置 ${op.actual!.sourceRange.start + 1}–${op.actual!.sourceRange.end}）`}
              </Text>
            </Text>
          ))}
    </Stack>
  );
}
