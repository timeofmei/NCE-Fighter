import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { UserData } from "../../app/core/user-data";
import { characterLanguage } from "../fixtures/character-language";
import { lesson as lessonFixture, now } from "../fixtures/training";
import { beginSession, reduceSession } from "../../app/core/training";
const body = "I had a very good seat.\nDon't stop.\nHello,world!";
async function lesson(page: Page) {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("Full lesson");
  await page.getByRole("textbox", { name: "正文", exact: true }).fill(body);
  await page.getByRole("button", { name: "保存为课文", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\//);
  return page.url();
}
async function full(page: Page) {
  const url = await lesson(page);
  await page.getByRole("button", { name: "全文默写", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "全文默写" })).toBeVisible();
  return url;
}
async function download(page: Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: "导入/导出", exact: true }).click();
  const next = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出全部用户数据", exact: true })
    .click();
  const file = await next;
  const data = await readFile((await file.path())!, "utf8");
  await expect(
    page.getByRole("button", { name: "导出全部用户数据", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  return data;
}
async function selectJSON(page: Page, data: string) {
  await page.getByRole("button", { name: "导入/导出", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "data.json",
    mimeType: "application/json",
    buffer: Buffer.from(data),
  });
}

test("whole dictation saves only explicit drafts, hides answers and restores completed results", async ({
  page,
}) => {
  await full(page);
  const input = page.getByRole("textbox", { name: "全文默写" });
  await input.fill("saved draft");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await input.fill("unsaved change");
  await page.reload();
  await expect(input).toHaveValue("saved draft");
  await expect(
    page.getByText("I had a very good seat.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await input.fill("i HAD a very good seat!!! dont stop hello world");
  await page.getByRole("button", { name: "提交全文", exact: true }).click();
  await expect(page).toHaveURL(/\/results\//);
  const result = page.url();
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重练错误与跳过句" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新默写全文" }).click();
  await expect(page).toHaveURL(/\/training\//);
  await expect(input).toHaveValue("");
  await page.goto(result);
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回课文", exact: true }).click();
  const badge = page
    .locator(".mantine-Badge-root")
    .filter({ hasText: "全文默写" })
    .first();
  await expect(badge).toHaveCSS("background-color", "rgb(102, 8, 116)");
  await expect(badge).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("whole results color missing sentences and preserve later matches, including at narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await full(page);
  await page
    .getByRole("textbox", { name: "全文默写" })
    .fill("extra I had a very good seat Hello world end");
  await page.getByRole("button", { name: "提交全文" }).click();
  await expect(page.getByText(/遗漏 2 · 多余 2 · 替换 0/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "第 2 句 · 存在差异" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("遗漏：Don't", { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-diff="match"]').filter({ hasText: "world" }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("failed draft and submit keep input; composition shortcuts cannot submit", async ({
  page,
}) => {
  await full(page);
  const input = page.getByRole("textbox", { name: "全文默写" });
  await input.fill(body);
  await input.dispatchEvent("compositionstart");
  await input.press("Control+Enter");
  await expect(page).toHaveURL(/\/training\//);
  await input.dispatchEvent("compositionend");
  const fail = () =>
    page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => {
        indexedDB.open = open;
        throw new Error("fixed storage failure");
      };
    });
  await fail();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("存储失败");
  await expect(input).toHaveValue(body);
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await fail();
  await page.getByRole("button", { name: "提交全文" }).click();
  await expect(page.getByRole("alert")).toContainText("存储失败");
  await expect(page.getByText("标准课文", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page).toHaveURL(/\/results\//);
});

test("JSON downloads all saved states, restores an empty database, confirms merges and rejects malformed files", async ({
  page,
}) => {
  const lessonURL = await full(page);
  await page.getByRole("textbox", { name: "全文默写" }).fill("whole draft");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const trainingURL = page.url();
  await page.goto("/import");
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("Unconfirmed draft");
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("Lesson 1\nFirst\nLesson 2\nSecond");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  const draftURL = page.url();
  const json = await download(page),
    file = JSON.parse(json) as UserData;
  expect(file.drafts).toHaveLength(1);
  expect(file.lessons).toHaveLength(1);
  expect(file.sessions[0].input).toBe("whole draft");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("nce-fighter");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
  await page.reload();
  await selectJSON(page, json);
  await expect(page.getByRole("dialog")).toContainText(
    "将合并现有数据，是否确认导入？",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: "Full lesson", exact: true }),
  ).toHaveCount(0);
  await selectJSON(page, json);
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Full lesson", exact: true }),
  ).toBeVisible();
  await page.goto(trainingURL);
  await expect(page.getByRole("textbox", { name: "全文默写" })).toHaveValue(
    "whole draft",
  );
  await page.goto(lessonURL);
  await expect(
    page.getByText("I had a very good seat.", { exact: true }),
  ).toBeVisible();
  await page.goto(draftURL);
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Lesson 1\nFirst\nLesson 2\nSecond");
  await page.goto("/library");
  await selectJSON(page, "{");
  await expect(page.getByRole("alert")).toContainText("JSON");
});

test("JSON import failure stays in the dialog and restored data rejects writes from an open training tab", async ({
  page,
  context,
}) => {
  await full(page);
  const input = page.getByRole("textbox", { name: "全文默写" });
  await input.fill("saved draft");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const library = await context.newPage();
  const json = await download(library);
  await selectJSON(library, json);
  await expect(library.getByRole("dialog")).toContainText("将合并现有数据");
  await library.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      indexedDB.open = open;
      throw new Error("fixed import failure");
    };
  });
  await library.getByRole("button", { name: "导入", exact: true }).click();
  await expect(library.getByRole("dialog").getByRole("alert")).toContainText(
    "存储失败",
  );
  await library.getByRole("button", { name: "导入", exact: true }).click();
  await expect(library.getByRole("dialog")).toHaveCount(0);
  await input.fill(body);
  await page.getByRole("button", { name: "提交全文", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请刷新后继续");
  await page.reload();
  await expect(input).toHaveValue("saved draft");
  await input.fill(body);
  await page.getByRole("button", { name: "提交全文", exact: true }).click();
  await expect(page).toHaveURL(/\/results\//);
});

test("shared results read a grapheme module with its direction and metrics while unavailable training stays blocked", async ({
  page,
}) => {
  const lesson = {
    ...lessonFixture("甲乙。\ne\u0301丙！"),
    languageId: characterLanguage.languageId,
    moduleRef: characterLanguage.moduleRef,
  };
  const result = reduceSession(
    beginSession(
      lesson,
      characterLanguage,
      { id: "character-result", now },
      { mode: "full_dictation" },
    ),
    { kind: "submit", requestId: "r", attemptId: "a", text: "甲乙 e\u0301丙" },
    lesson,
    characterLanguage,
    now,
  );
  const file: UserData = {
    app: "nce-fighter",
    schemaVersion: 1,
    system: { name: null, version: null },
    drafts: [],
    lessons: [lesson],
    sessions: [result],
  };
  await page.goto("/library");
  await selectJSON(page, JSON.stringify(file));
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/results/character-result");
  await expect(page.getByText(/字符准确度 100.0%/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新默写全文" }),
  ).toBeDisabled();
  await expect(
    page.locator('p[dir="rtl"]').filter({ hasText: "甲乙" }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回课文", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "全文默写", exact: true }),
  ).toBeDisabled();
});
