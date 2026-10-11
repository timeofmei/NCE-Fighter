import { expect, test, type Page } from "@playwright/test";
async function start(
  page: Page,
  body = "I had a very good seat.\nDon't stop.\nHello,world!",
) {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "语言" }).click();
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("Sentence lesson");
  await page.getByRole("textbox", { name: "正文", exact: true }).fill(body);
  await page.getByRole("button", { name: "保存为课文", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\//);
  await page.getByRole("button", { name: "逐句默写", exact: true }).click();
  await expect(page).toHaveURL(/\/training\//);
  await expect(page.getByRole("textbox", { name: "本句默写" })).toBeVisible();
}
async function answer(page: Page, text: string) {
  await page.getByRole("textbox", { name: "本句默写" }).fill(text);
  await page.getByRole("button", { name: "提交本句", exact: true }).click();
  await expect(page.getByText("标准原句", { exact: true })).toBeVisible();
}
test("unfinished record deletion supports cancellation, failure, retry and refresh", async ({
  page,
}) => {
  await start(page, "One sentence.");
  const training = page.url();
  await page.getByRole("textbox", { name: "本句默写" }).fill("saved input");
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "返回课文", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\//);
  const lessonUrl = page.url();
  const remove = page.getByRole("button", { name: /删除 .* 的训练记录/ });
  await remove.click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "继续训练", exact: true }),
  ).toBeVisible();
  await remove.click();
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      indexedDB.open = open;
      throw new Error("injected");
    };
  });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("删除失败");
  await expect(
    page.getByRole("link", { name: "继续训练", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "删除", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "继续训练", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sentence lesson" }),
  ).toBeVisible();
  await expect(remove).toHaveCount(0);
  await page.goto(training);
  await expect(page.getByText("训练不存在。", { exact: true })).toBeVisible();
  await page.goto(lessonUrl);
  await expect(page.getByText("One sentence.", { exact: true })).toBeVisible();
});
test("deleting a source result preserves its practice and other records", async ({
  page,
}) => {
  await start(page, "One sentence.");
  const sourceId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "跳过本句" }).click();
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page).toHaveURL(/\/results\//);
  const sourceResult = page.url();
  await page.getByRole("button", { name: "重练错误与跳过句" }).click();
  await expect(page).toHaveURL(/\/training\//);
  const practiceId = page.url().split("/").at(-1)!;
  await page.getByRole("textbox", { name: "本句默写" }).fill("one sentence");
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "返回课文", exact: true }).click();
  await page
    .locator(`[data-session-id="${sourceId}"]`)
    .getByRole("button", { name: /删除/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("相关重练记录会保留");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`[data-session-id="${sourceId}"]`)).toHaveCount(0);
  await page
    .locator(`[data-session-id="${practiceId}"]`)
    .getByRole("link", { name: "继续训练" })
    .click();
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue(
    "one sentence",
  );
  await page.getByRole("button", { name: "提交本句" }).click();
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page.getByText(/首次完全正确 1/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/首次完全正确 1/)).toBeVisible();
  await page.goto(sourceResult);
  await expect(page.getByText("训练不存在。", { exact: true })).toBeVisible();
});
test("hidden answer, autosave, hint exposure, rewrites, skips, history and immutable wrong-sentence practice", async ({
  page,
}) => {
  await start(page);
  const origin = page.url();
  await expect(
    page.getByText("I had a very good seat.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "本句默写" })
    .fill("I had a good seat");
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue(
    "I had a good seat",
  );
  await page
    .getByRole("button", { name: "提交本句", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByText(/遗漏 1 个词：very/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("标准原句", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重写本句" }).click();
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue("");
  await expect(page.getByText("标准原句", { exact: true })).toHaveCount(0);
  await answer(page, "I had a very good seat");
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一句" }).click();
  await expect(
    page.getByText("I had a very good seat.", { exact: true }),
  ).toHaveCount(0);
  const hint = page.getByRole("switch");
  await hint.click();
  await expect(hint).toBeChecked();
  await expect(page.getByText("d s", { exact: true })).toBeVisible();
  await hint.click();
  await expect(hint).not.toBeChecked();
  await expect(page.getByText("d s", { exact: true })).toHaveCount(0);
  await answer(page, "dont stop");
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一句" }).click();
  await page.getByRole("button", { name: "跳过本句" }).click();
  await expect(page.getByText("Hello,world!", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page).toHaveURL(/\/results\//);
  const result = page.url();
  await expect(page.getByText(/首次完全正确 1.*错误 1.*跳过 1/)).toBeVisible();
  await expect(page.getByText(/重试 1 次.*其中完全正确 1 次/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "重练错误与跳过句" }).click();
  await expect(page).toHaveURL(/\/training\//);
  expect(page.url()).not.toBe(origin);
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  await answer(page, "I had a very good seat");
  await page.getByRole("button", { name: "下一句" }).click();
  await answer(page, "hello world");
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page.getByText(/首次完全正确 2/)).toBeVisible();
  await page.goto(result);
  await expect(page.getByText(/首次完全正确 1.*错误 1.*跳过 1/)).toBeVisible();
  await page.getByRole("link", { name: "返回课文", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "查看结果", exact: true }),
  ).toHaveCount(2);
});
test("storage failure retains draft, retry works and return resumes input", async ({
  page,
}) => {
  await start(page, "Only one sentence.");
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      indexedDB.open = original;
      throw new DOMException("injected", "QuotaExceededError");
    };
  });
  await page
    .getByRole("textbox", { name: "本句默写" })
    .fill("Only one sentence");
  await expect(page.getByRole("alert")).toContainText("存储空间不足");
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue(
    "Only one sentence",
  );
  await expect(page.getByText("标准原句", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "返回课文", exact: true }).click();
  await page.getByRole("link", { name: "继续训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue(
    "Only one sentence",
  );
  await page.getByRole("button", { name: "提交本句" }).click();
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page).toHaveURL(/\/results\//);
  await page.reload();
  await expect(page.getByText(/首次完全正确 1/)).toBeVisible();
});
test("narrow viewport and IME block shortcuts; empty input and replacements give feedback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page, "I had a good seat.");
  const editor = page.getByRole("textbox", { name: "本句默写" });
  await page.getByRole("button", { name: "提交本句" }).click();
  await expect(page.getByRole("alert")).toContainText("有效文字");
  await editor.fill("I have a good seat");
  await editor.dispatchEvent("compositionstart");
  await editor.press("Control+Enter");
  await expect(page.getByText("标准原句", { exact: true })).toHaveCount(0);
  await editor.dispatchEvent("compositionend");
  await editor.press("Control+Enter");
  await expect(page.getByText(/替换 1 个词：had → have/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "重写本句" }).click();
  await answer(page, "I had a good good seat");
  await expect(page.getByText(/多余 1 个词：good/)).toBeVisible();
  await page.screenshot({
    path: "test-results/training-narrow.png",
    fullPage: true,
  });
});
test("failed submit and next retain visible state until a successful retry", async ({
  page,
}) => {
  await start(page, "First sentence.\nSecond sentence.");
  await page.getByRole("textbox", { name: "本句默写" }).fill("First sentence");
  await expect(page.getByRole("status")).toHaveText("已保存");
  const fail = async () =>
    page.evaluate(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => {
        indexedDB.open = open;
        throw new Error("injected transaction failure");
      };
    });
  await fail();
  await page.getByRole("button", { name: "提交本句" }).click();
  await expect(page.getByRole("alert")).toContainText("存储失败");
  await expect(page.getByText("标准原句", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue(
    "First sentence",
  );
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByText("完全正确", { exact: true })).toBeVisible();
  await fail();
  await page.getByRole("button", { name: "下一句" }).click();
  await expect(page.getByRole("alert")).toContainText("存储失败");
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本句默写" })).toHaveValue("");
  await page.reload();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await expect(page.getByText("标准原句", { exact: true })).toHaveCount(0);
});

test("unavailable pinned module permits history reading and prevents recomparison", async ({
  page,
}) => {
  await start(page, "One sentence.");
  await answer(page, "one sentence");
  await page.getByRole("button", { name: "查看本次结果" }).click();
  await expect(page).toHaveURL(/\/results\//);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("nce-fighter", 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction(["lessons", "sessions"], "readwrite");
        for (const name of ["lessons", "sessions"]) {
          const os = tx.objectStore(name),
            all = os.getAll();
          all.onsuccess = () => {
            for (const record of all.result) {
              record.moduleRef.moduleVersion = "missing";
              for (const attempt of record.attempts ?? [])
                if (attempt.result)
                  attempt.result.moduleRef.moduleVersion = "missing";
              os.put(record);
            }
          };
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.getByText(/首次完全正确 1/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新练习整篇" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "返回课文", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "逐句默写", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "返回课文库", exact: true }).click();
  await page
    .getByRole("link", { name: "Sentence lesson", exact: true })
    .click();
  await page.getByRole("link", { name: "查看结果", exact: true }).click();
  await expect(page.getByText(/首次完全正确 1/)).toBeVisible();
});
