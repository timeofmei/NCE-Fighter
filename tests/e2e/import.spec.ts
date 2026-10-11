import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "课文内容语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
}
async function fill(
  page: Page,
  body = "Hello. World!\n😀 Café\n\n  Final line.  ",
) {
  await page.getByRole("textbox", { name: "课文标题" }).fill("My lesson");
  await page.getByRole("textbox", { name: "正文", exact: true }).fill(body);
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "确认并保存", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\//);
}
test("language gate, saved draft refresh, line editing, immutable detail and library recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("link", { name: "导入课文", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "课文内容语言" }),
  ).toHaveValue("");
  await page.getByRole("combobox", { name: "课文内容语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await fill(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/draft=/);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Hello. World!\n😀 Café\n\n  Final line.  ");
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("Hello.\nWorld! 😀 Café\n  Final line.  ");
  await confirm(page);
  await expect(page.getByText("World! 😀 Café", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My lesson" })).toBeVisible();
  await page.getByRole("link", { name: "返回课文库" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.reload();
  await expect(page.getByRole("link", { name: "阅读课文" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "继续校对" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索标题" }).fill("absent");
  await expect(page.getByText("没有匹配的课文。")).toBeVisible();
  expect(errors).toEqual([]);
});
test("invalid line, input limits and safe text rendering", async ({ page }) => {
  await start(page);
  await fill(page, "First\n\n!!!");
  await expect(
    page.getByText("第 3 行没有有效文字或数字，不能仅含标点或符号。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并保存" })).toBeDisabled();
  await page.getByRole("button", { name: "定位第 3 行" }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toBeFocused();
  await fill(page, "😀".repeat(20_000) + "a");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作失败" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("😀".repeat(20_000) + "a");
  await fill(page, Array(501).fill("a").join("\n"));
  await expect(
    page.getByText("正文超过 500 个非空行，请减少行数后保存。"),
  ).toBeVisible();
  await fill(page, "<script>window.pwned=true</script>\nHello");
  await confirm(page);
  await expect(
    page.getByText("<script>window.pwned=true</script>", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});
test("unsaved navigation: cancel, save and leave, discard; reload warning", async ({
  page,
}) => {
  await start(page);
  await fill(page);
  await page.getByRole("link", { name: "返回课文库" }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "课文标题" })).toHaveValue(
    "My lesson",
  );
  await page.getByRole("link", { name: "返回课文库" }).click();
  await page.getByRole("button", { name: "保存草稿并离开" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("link", { name: "继续校对" }).click();
  await page.getByRole("textbox", { name: "课文标题" }).fill("Unsaved");
  const dialog = page.waitForEvent("dialog");
  const reload = page.reload();
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.accept();
  await reload;
  await expect(page.getByRole("textbox", { name: "课文标题" })).toHaveValue(
    "My lesson",
  );
  await page.getByRole("textbox", { name: "课文标题" }).fill("Discard");
  await page.getByRole("link", { name: "返回课文库" }).click();
  await page.getByRole("button", { name: "放弃修改并离开" }).click();
  await expect(page.getByText("My lesson", { exact: true })).toBeVisible();
});
test("missing lesson differs from storage read failure and can retry", async ({
  page,
}) => {
  await page.goto("/lessons/missing");
  await expect(page.getByRole("heading", { name: "课文不存在" })).toBeVisible();
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    let fail = true;
    indexedDB.open = (...args) => {
      if (fail) {
        fail = false;
        throw new Error("Injected read failure");
      }
      return original(...args);
    };
  });
  await page.goto("/lessons/missing");
  await expect(page.getByRole("alert")).toContainText("读取失败");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "课文不存在" })).toBeVisible();
});
test("failed draft save and failed confirmation retain input; retry and repeated clicks produce one lesson", async ({
  page,
}) => {
  await start(page);
  await fill(page);
  const injectOnce = async () =>
    page.evaluate(() => {
      const original = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => {
        indexedDB.open = original;
        throw new DOMException(
          "Internal IndexedDB details",
          "QuotaExceededError",
        );
      };
    });
  await injectOnce();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作失败" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作失败" }),
  ).toContainText("浏览器存储空间不足");
  await expect(
    page.getByRole("alert").filter({ hasText: "操作失败" }),
  ).not.toContainText("Internal IndexedDB details");
  await expect(page.getByRole("textbox", { name: "课文标题" })).toHaveValue(
    "My lesson",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await injectOnce();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作失败" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Hello. World!\n😀 Café\n\n  Final line.  ");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await page
    .getByRole("button", { name: "确认保存", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/lessons\//);
  await page.getByRole("link", { name: "返回课文库" }).click();
  await expect(page.getByRole("link", { name: "阅读课文" })).toHaveCount(1);
});
test("editor draft deletion supports cancellation, failure and retry without losing input", async ({
  page,
}) => {
  await start(page);
  await expect(
    page.getByRole("button", { name: "删除草稿", exact: true }),
  ).toHaveCount(0);
  await fill(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  const draftUrl = page.url();
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .fill("Unsaved sentence.");
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "草稿及当前未保存修改将被删除，无法恢复。",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Unsaved sentence.");
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      indexedDB.open = original;
      throw new DOMException("Internal error", "AbortError");
    };
  });
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "删除失败" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Unsaved sentence.");
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await page
    .getByRole("button", { name: "删除", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("link", { name: "继续校对" })).toHaveCount(0);
  await page.goto(draftUrl);
  await expect(page.getByRole("heading", { name: "草稿不存在" })).toBeVisible();
});

test("library draft deletion persists across refresh and keeps confirmed lessons", async ({
  page,
}) => {
  await start(page);
  await fill(page);
  await page
    .getByRole("textbox", { name: "课文标题" })
    .fill("Confirmed lesson");
  await confirm(page);
  await start(page);
  await fill(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("草稿已保存");
  await page.getByRole("link", { name: "返回课文库" }).click();
  await expect(
    page.getByRole("button", { name: "删除草稿", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("link", { name: "继续校对" })).toHaveCount(1);
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("link", { name: "继续校对" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: "阅读课文" })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "删除草稿", exact: true }),
  ).toHaveCount(0);
});

test("narrow layout, long lines and IME composition do not accidentally confirm", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await fill(page, "Long sentence ".repeat(100));
  const editor = page.getByRole("textbox", { name: "正文", exact: true });
  const layout = await editor.evaluate((element: HTMLTextAreaElement) => ({
    horizontalOverflow: element.scrollWidth > element.clientWidth,
    verticalOverflow: element.scrollHeight > element.clientHeight,
    height: element.clientHeight,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(layout.height).toBeGreaterThanOrEqual(layout.lineHeight * 12);
  expect(layout.horizontalOverflow).toBe(true);
  expect(layout.verticalOverflow).toBe(false);
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(
    await editor.evaluate((element: HTMLTextAreaElement) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .dispatchEvent("compositionstart");
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "正文", exact: true })
    .dispatchEvent("compositionend");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "正文", exact: true }),
  ).toHaveValue("Long sentence ".repeat(100));
  await editor.fill("Long sentence ".repeat(100) + "\nNext sentence.");
  await confirm(page);
  await expect(page.getByText("Next sentence.", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
