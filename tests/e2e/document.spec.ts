import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
const fixture = (name: string) =>
  path.resolve("tests/fixtures/documents", name);
async function openFiles(page: Page) {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await page.getByRole("button", { name: "文件导入", exact: true }).click();
  await expect(page.getByRole("button", { name: "选择 PDF" })).toBeEnabled();
}
async function choose(page: Page, files: string[], pdf = false) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: pdf ? "选择 PDF" : "选择图片", exact: true })
    .click();
  await (await chooser).setFiles(files.map(fixture));
  await expect(
    page.getByRole("button", { name: "开始识别", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".mantine-Modal-overlay")).toHaveCount(0);
}
async function recognize(page: Page) {
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  const download = page.getByRole("button", {
    name: "下载并识别",
    exact: true,
  });
  await expect(
    download.or(page.getByRole("textbox", { name: "正文", exact: true })),
  ).toBeVisible();
  if (await download.isVisible()) await download.click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toBeVisible();
}
test("real text PDF crosses pages, proposes multiple lessons and restores sources through JSON", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openFiles(page);
  await choose(page, ["text.pdf"], true);
  await recognize(page);
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("Lesson 1 — The Fox and the Grapes");
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toContainText("");
  const body = await page
    .getByRole("textbox", { name: "正文", exact: true })
    .inputValue();
  expect(body).toContain("Dr. J. Smith paid 3.50 dollars.\nThen he went home.");
  expect(
    requests.some(
      (url) => url.includes("/models/") || url.includes("/resources/ort"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue(body);
  await expect(
    page.getByText("查看来源或重新识别时，请重新选择原文件。"),
  ).toBeVisible();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "重新选择原 PDF" }).click();
  await (await fileChooser).setFiles(fixture("mixed.pdf"));
  await expect(page.getByRole("alert")).toContainText("不匹配");
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue(body);
  const matched = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "重新选择原 PDF" }).click();
  await (await matched).setFiles(fixture("text.pdf"));
  await expect(page.getByRole("combobox", { name: "来源页" })).toBeVisible();
});
test("real image OCR respects image order, uses local resources and confirms one lesson at a time", async ({
  page,
}) => {
  const remoteData: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:") &&
      r.method() !== "GET"
    )
      remoteData.push(r.url());
  });
  await openFiles(page);
  await choose(page, ["page-1.png", "page-2.png"]);
  await recognize(page);
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("Lesson 1 — The Fox and the Grapes");
  const body = await page
    .getByRole("textbox", { name: "正文", exact: true })
    .inputValue();
  expect(body).toContain("One hot summer");
  expect(body).toContain("3.50 dollars");
  await page.getByRole("button", { name: "保存为课文", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("Lesson 2 — The Crow and the Pitcher");
  expect(remoteData).toEqual([]);
  await page.getByRole("button", { name: "保存为课文", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\//);
  await expect(page.getByText(/A Crow, half-dead/)).toBeVisible();
});
test("mixed PDF extracts text and recognizes scanning with the actual model", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["mixed.pdf"], true);
  await recognize(page);
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue(/One hot summer[\s\S]*Dr\. J\. Smith paid 3\.50 dollars/);
});
test("saved draft splitting and merging are atomic and survive a refresh", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["text.pdf"], true);
  await recognize(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.getByLabel("在第几行后拆分").fill("1");
  await page.getByRole("button", { name: "拆分课文", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.reload();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "合并所选草稿" }).click();
  await page.getByRole("button", { name: "按此顺序合并" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
});
test("corrupt PDFs fail clearly", async ({ page }) => {
  await openFiles(page);
  await choose(page, ["broken.pdf"], true).catch(() => {});
  await expect(page.getByRole("alert")).toContainText("PDF 无法读取");
});
test("failed image pages retain successful content until an explicit skip", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["page-1.png", "blank.png"]);
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  await page.getByRole("button", { name: "下载并识别", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "部分页面处理失败" }),
  ).toBeVisible();
  await expect(page.getByText("第 1 页：完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试失败页面" }).click();
  await expect(
    page.getByRole("dialog", { name: "部分页面处理失败" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "跳过失败页面并继续" }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue(/One hot summer/);
  await expect(page.getByText(/正文可能缺失/)).toBeVisible();
});
test("manual crop recognizes only the chosen line of real material", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["printed-cover.jpg"]);
  const canvas = page.getByLabel("来源预览与框选");
  await expect(canvas).toHaveAttribute("width", "652");
  await canvas.evaluate((element) =>
    window.scrollTo(
      0,
      element.getBoundingClientRect().top + window.scrollY - 100,
    ),
  );
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing canvas");
  await page.mouse.move(
    bounds.x + bounds.width * 0.05,
    bounds.y + bounds.height * 0.08,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.57,
    bounds.y + bounds.height * 0.18,
  );
  await page.mouse.up();
  await expect(page.getByText("区域 1", { exact: true })).toBeVisible();
  await recognize(page);
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Fables");
});
test("download failure and cancellation preserve files and permit a fresh retry", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["page-1.png"]);
  await page.route("**/models/ppocr-tiny/inference.onnx", (route) =>
    route.abort("failed"),
  );
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  await page.getByRole("button", { name: "下载并识别", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始识别", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/models/ppocr-tiny/inference.onnx");
  await page.getByRole("button", { name: "开始识别", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下载并识别", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始识别", exact: true }),
  ).toBeEnabled();
  await recognize(page);
});
test("corrupt cached weights require a verified replacement and keyboard routes remain usable", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["page-1.png"]);
  await recognize(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.evaluate(async () => {
    const keys = await caches.keys(),
      key = keys.find((k) => k.startsWith("nce-fighter-ocr-"));
    if (!key) throw new Error("Missing cache");
    await (
      await caches.open(key)
    ).put("/models/ppocr-tiny/inference.onnx", new Response("corrupt"));
  });
  await page.goto("/resources");
  await expect(page.getByText(/待下载 4\.46 MB/)).toBeVisible();
  await page.getByRole("button", { name: "下载所需资源" }).click();
  await page.getByRole("button", { name: "下载并检测" }).click();
  await expect(page.getByText(/资源已缓存/)).toBeVisible();
});
test("resource cache is verified, reused and cleaned independently of learning data", async ({
  page,
}) => {
  await openFiles(page);
  await choose(page, ["page-1.png"]);
  await recognize(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.goto("/resources");
  await expect(page.getByText(/资源已缓存/)).toBeVisible();
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByText(/本地识别已通过初始化/)).toBeVisible();
  await page.getByRole("button", { name: "清理模型缓存", exact: true }).click();
  await page.getByRole("button", { name: "确认清理" }).click();
  await expect(page.getByText(/待下载/)).toBeVisible();
  await page.goto("/library");
  await expect(page.locator('.lesson-card[data-state="draft"]')).toHaveCount(1);
});
test("narrow layout preserves current body and allows source rotation before real OCR", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFiles(page);
  await choose(page, ["rotated.png"]);
  await page.getByRole("button", { name: "旋转 90°" }).click();
  await recognize(page);
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue(/One hot summer/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
