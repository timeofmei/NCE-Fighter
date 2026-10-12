import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const directory = "tests/fixtures/documents";
await mkdir(directory, { recursive: true });
// Public-domain Aesop, Project Gutenberg #28. Excerpts are reformatted as lessons;
// additional sentences explicitly exercise abbreviation and decimal boundaries.
const pages = [
  [
    "Lesson 1",
    "The Fox and the Grapes",
    "One hot summer's day a Fox was strolling through an orchard",
    "till he came to a bunch of Grapes just ripening on a vine",
    "which had been trained over a lofty branch.",
  ],
  [
    '"Just the thing to quench my thirst," quoth he.',
    "Dr. J. Smith paid 3.50 dollars. Then he went home.",
    "Lesson 2",
    "The Crow and the Pitcher",
    "A Crow, half-dead with thirst, came upon a Pitcher",
    "which had once been full of water; but when the Crow",
    "put its beak into the mouth of the Pitcher he found",
    "that only very little water was left in it.",
  ],
];
await writeFile(
  `${directory}/reference.json`,
  JSON.stringify(pages, null, 2) + "\n",
);
const browser = await chromium.launch();
const page = await browser.newPage();
const images = [];
const blank = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 900;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 900);
  return c.toDataURL("image/png").split(",")[1];
});
await writeFile(`${directory}/blank.png`, Buffer.from(blank, "base64"));
for (let i = 0; i < pages.length; i++) {
  const png = await page.evaluate((lines) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "black";
    ctx.font = "28px Arial";
    lines.forEach((line, index) => ctx.fillText(line, 60, 90 + index * 55));
    return canvas.toDataURL("image/png").split(",")[1];
  }, pages[i]);
  const bytes = Buffer.from(png, "base64");
  images.push(bytes);
  await writeFile(`${directory}/page-${i + 1}.png`, bytes);
}
const rotated = await page.evaluate(async (png) => {
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${png}`)).blob(),
  );
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  return canvas.toDataURL("image/png").split(",")[1];
}, images[0].toString("base64"));
await writeFile(`${directory}/rotated.png`, Buffer.from(rotated, "base64"));
for (const kind of ["text", "scan", "mixed", "stress"]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const count = kind === "stress" ? 50 : 2;
  for (let i = 0; i < count; i++) {
    const pdfPage = doc.addPage([600, 450]);
    if (kind === "scan" || kind === "stress" || (kind === "mixed" && i === 1)) {
      const image = await doc.embedPng(images[i % 2]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: 600, height: 450 });
    } else
      pages[i % 2].forEach((line, index) =>
        pdfPage.drawText(line, {
          x: 30,
          y: 405 - index * 27.5,
          size: 14,
          font,
        }),
      );
  }
  await writeFile(`${directory}/${kind}.pdf`, await doc.save());
}
await writeFile(`${directory}/broken.pdf`, "This is not a PDF.");
await browser.close();
console.log("Generated document acceptance fixtures");
