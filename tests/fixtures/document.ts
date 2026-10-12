import { documentDrafts, type FileBatch } from "../../app/core/document";
import { english } from "../../app/languages/english";
export const batch: FileBatch = {
  id: "batch",
  languageId: "en",
  createdAt: "2026-10-12T00:00:00Z",
  files: [
    {
      id: "file",
      name: "sample.pdf",
      size: 20,
      sha256: "a".repeat(64),
      kind: "pdf",
    },
  ],
  sources: [1, 2].map((page, order) => ({
    id: `page${page}`,
    fileId: "file",
    page,
    order,
    rotation: 0,
    rect: { x: 0, y: 0, width: 1, height: 1 },
  })),
};
export function proposals() {
  let id = 0;
  return documentDrafts(
    batch,
    [
      {
        sourceRef: "page1",
        text: "Lesson 1\nThe Fox\nDr. Smith saw a fox. It cost $3.50.",
      },
      {
        sourceRef: "page2",
        text: "Then it ran away.\nLesson 2\nThe Crow\nA crow sat in a tree.",
      },
    ],
    english,
    { id: () => `draft${++id}`, now: batch.createdAt },
  );
}
