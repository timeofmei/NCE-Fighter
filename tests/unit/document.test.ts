import { describe, expect, it } from "vitest";
import {
  mergeDrafts,
  splitDraft,
  validateBatch,
} from "../../app/core/document";
import { english } from "../../app/languages/english";
import { englishSentences } from "../../app/languages/english-document";
import { analyze } from "../../app/core/lesson";
import { lineRegions, readPdfText } from "../../app/adapters/document";
import { batch, proposals } from "../fixtures/document";
describe("document proposals and draft boundaries", () => {
  it("forms cross-page lessons and same-page lessons with source references", () => {
    const drafts = proposals();
    expect(drafts).toHaveLength(2);
    expect(drafts[0].body).toBe(
      "Dr. Smith saw a fox.\nIt cost $3.50.\nThen it ran away.",
    );
    expect(drafts[0].title).toBe("Lesson 1 — The Fox");
    expect(drafts[0].sourceRefs).toEqual(["page1", "page2"]);
    expect(drafts[1].sourceRefs).toEqual(["page2"]);
    expect(drafts[0].sentences.map((s) => s.sourceRefs)).toEqual([
      ["page1"],
      ["page1"],
      ["page2"],
    ]);
  });
  it("keeps abbreviations, initials, decimals and closing quotes intact", () => {
    expect(
      englishSentences(
        'Mr. J. Smith lives in the U.S.A. He paid 3.14 dollars. "Hello!" Then left.',
      ),
    ).toEqual([
      "Mr. J. Smith lives in the U.S.A. He paid 3.14 dollars.",
      '"Hello!"',
      "Then left.",
    ]);
    expect(analyze("Hello. World!\nNext.", english).sentences).toHaveLength(2);
  });
  it("splits and merges only drafts from the same batch without losing provenance", () => {
    const original = proposals()[0];
    const split = splitDraft(original, 1, "second", english);
    expect(split[0].id).toBe(original.id);
    expect(split[1].id).toBe("second");
    expect(mergeDrafts(split, english).body).toBe(original.body);
    expect(() =>
      mergeDrafts([original, { ...split[1], batchId: "other" }], english),
    ).toThrow();
    expect(() => splitDraft(original, 0, "x", english)).toThrow();
  });
  it("rejects invalid rectangles and file references", () => {
    const invalid = structuredClone(batch);
    invalid.sources[0].rect.width = 2;
    expect(() => validateBatch(invalid)).toThrow();
    invalid.sources[0].rect.width = 1;
    invalid.sources[0].fileId = "missing";
    expect(() => validateBatch(invalid)).toThrow();
  });
  it("reads columns by coordinates rather than PDF item stream order", () => {
    const item = (str: string, x: number, y: number) => ({
      str,
      transform: [1, 0, 0, 12, x, y],
      width: 100,
      height: 12,
    });
    expect(
      readPdfText(
        [
          item("right two", 330, 90),
          item("left one", 20, 100),
          item("right one", 330, 100),
          item("left two", 20, 90),
        ],
        600,
      ),
    ).toBe("left one\nleft two\nright one\nright two");
  });
  it("uses projection to find separate lines and ignores a blank image", () => {
    const image = {
      width: 100,
      height: 50,
      data: new Uint8ClampedArray(100 * 50 * 4).fill(255),
    } as ImageData;
    expect(lineRegions(image)).toEqual([]);
    for (const y of [10, 11, 12, 13, 30, 31, 32, 33])
      for (let x = 10; x < 60; x++) {
        const p = (y * 100 + x) * 4;
        image.data[p] = image.data[p + 1] = image.data[p + 2] = 0;
      }
    expect(lineRegions(image)).toHaveLength(2);
  });
});
