import { Accordion, Stack, Text } from "@mantine/core";
import type { Attempt } from "../core/training";
import { sentenceText } from "../core/training";
import { points, type Lesson } from "../core/lesson";
import { AttemptFeedback, ColoredText } from "./diff";

export function WholeResult({
  attempt,
  lesson,
  direction,
}: {
  attempt: Attempt;
  lesson: Lesson;
  direction: "ltr" | "rtl";
}) {
  const result = attempt.result!;
  return (
    <Stack>
      {attempt.recognition && (
        <Text>
          基于确认后的识别文本比对 ·{" "}
          {attempt.recognition.wasEdited ? "已修正识别文本" : "识别文本未修改"}
        </Text>
      )}
      <AttemptFeedback
        attempt={attempt}
        showOperations={false}
        reference={lesson.body}
        direction={direction}
      />
      <Accordion
        multiple
        defaultValue={result.sentenceResults
          .filter((r) => r.S + r.D + r.I > 0)
          .map((r) => r.sentenceId)}
      >
        {result.sentenceResults.map((row, i) => {
          const sentence = lesson.sentences.find(
            (s) => s.id === row.sentenceId,
          )!;
          const operations = result.operations.filter(
            (o) => o.sentenceId === row.sentenceId,
          );
          const inputUnits = operations.flatMap((o) =>
            o.actual ? [o.actual] : [],
          );
          const inputStart = inputUnits.length
            ? Math.min(...inputUnits.map((u) => u.sourceRange.start))
            : 0;
          const inputEnd = inputUnits.length
            ? Math.max(...inputUnits.map((u) => u.sourceRange.end))
            : 0;
          return (
            <Accordion.Item key={row.sentenceId} value={row.sentenceId}>
              <Accordion.Control>
                第 {i + 1} 句 ·{" "}
                {row.S + row.D + row.I === 0 ? "完全正确" : "存在差异"}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Text size="sm" c="dimmed">
                    标准原句
                  </Text>
                  <Text dir={direction} className="sentence">
                    <ColoredText
                      text={sentenceText(lesson, row.sentenceId)}
                      side="reference"
                      operations={operations.map((o) => ({
                        ...o,
                        reference: o.reference
                          ? {
                              ...o.reference,
                              sourceRange: {
                                start:
                                  o.reference.sourceRange.start -
                                  sentence.start,
                                end:
                                  o.reference.sourceRange.end - sentence.start,
                              },
                            }
                          : null,
                      }))}
                    />
                  </Text>
                  <Text size="sm" c="dimmed">
                    你的输入
                  </Text>
                  <Text dir={direction} className="sentence">
                    {inputUnits.length ? (
                      <ColoredText
                        text={points(attempt.confirmedText)
                          .slice(inputStart, inputEnd)
                          .join("")}
                        side="actual"
                        operations={operations.map((o) => ({
                          ...o,
                          actual: o.actual
                            ? {
                                ...o.actual,
                                sourceRange: {
                                  start:
                                    o.actual.sourceRange.start - inputStart,
                                  end: o.actual.sourceRange.end - inputStart,
                                },
                              }
                            : null,
                        }))}
                      />
                    ) : (
                      "（空）"
                    )}
                  </Text>
                  {operations
                    .filter((o) => o.kind !== "match")
                    .map((o, index) => (
                      <Text key={index} dir={direction}>
                        {o.kind === "delete"
                          ? `遗漏：${o.reference!.displayText}`
                          : o.kind === "insert"
                            ? `多余：${o.actual!.displayText}`
                            : `替换：${o.reference!.displayText} → ${o.actual!.displayText}`}
                      </Text>
                    ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </Stack>
  );
}
