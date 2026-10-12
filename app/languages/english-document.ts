import type { Proposal, TextBlock } from "../core/document";

// File-only suggestions. Editor confirmation continues to use explicit user lines.
export function englishSentences(text: string): string[] {
  const input = text.replace(/\s+/g, " ").trim();
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    if (!/[.!?]/.test(input[i])) continue;
    if (input[i] === ".") {
      if (/\d/.test(input[i - 1] ?? "") && /\d/.test(input[i + 1] ?? ""))
        continue;
      const word =
        input.slice(start, i + 1).match(/([\p{L}.]+)\.$/u)?.[1] ?? "";
      if (
        /^(Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e)$/i.test(word) ||
        /^[A-Z]$/.test(word) ||
        /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)
      )
        continue;
    }
    let end = i + 1;
    while (/[.!?"'”’)]/.test(input[end] ?? "\0")) end++;
    if (end < input.length && input[end] !== " ") continue;
    const sentence = input.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  const tail = input.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
export function proposeEnglishDocument(blocks: TextBlock[]): Proposal[] {
  const output: Proposal[] = [];
  let title = "",
    text: string[] = [],
    refs = new Set<string>(),
    pendingTitle = false;
  let bodySources: string[] = [];
  const flush = () => {
    if (text.some((t) => t.trim())) {
      const input = text.join(" "),
        sentences = englishSentences(input);
      let offset = 0;
      const spans = text.map((line, i) => {
        const start = offset;
        offset += line.length + 1;
        return { start, end: offset - 1, ref: bodySources[i] };
      });
      let cursor = 0;
      const sentenceSourceRefs = sentences.map((sentence) => {
        const start = input.indexOf(sentence, cursor),
          end = start + sentence.length;
        cursor = end;
        return [
          ...new Set(
            spans
              .filter((span) => span.start < end && span.end > start)
              .map((span) => span.ref),
          ),
        ];
      });
      output.push({
        title,
        body: sentences.join("\n"),
        sentenceSourceRefs,
        sourceRefs: [...refs],
      });
    }
    title = "";
    text = [];
    refs = new Set();
    pendingTitle = false;
    bodySources = [];
  };
  for (const block of blocks) {
    for (const raw of block.text.split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (/^(?:lesson|unit|chapter)\s+\d+(?:\b|[.:])/i.test(line)) {
        flush();
        title = line;
        pendingTitle = /^(?:lesson|unit|chapter)\s+\d+\s*$/i.test(line);
        refs.add(block.sourceRef);
        continue;
      }
      if (pendingTitle && line.length < 100 && !/[.!?]$/.test(line)) {
        title += ` — ${line}`;
        pendingTitle = false;
        refs.add(block.sourceRef);
        continue;
      }
      pendingTitle = false;
      text.push(line);
      bodySources.push(block.sourceRef);
      refs.add(block.sourceRef);
    }
  }
  flush();
  return output;
}
