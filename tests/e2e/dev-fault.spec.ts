import { expect, test } from "@playwright/test";

test("documented one-shot development fault supports read, draft save and confirm retries", async ({
  page,
}) => {
  await page.goto("/library?storageFailure=once");
  await expect(page.getByRole("alert")).toContainText("已模拟一次存储失败");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(
    page.getByRole("link", { name: "导入课文", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const operation of ["保存草稿", "保存为课文"]) {
    await page.goto("/import?storageFailure=once");
    await page.getByRole("combobox", { name: "语言" }).click();
    await page.getByRole("option", { name: "英语", exact: true }).click();
    await page
      .getByRole("textbox", { name: "正文", exact: true })
      .fill("Retain this sentence.");
    await page.getByRole("button", { name: operation, exact: true }).click();
    if (operation === "保存为课文")
      await page.getByRole("button", { name: "确认保存", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "操作失败" }),
    ).toContainText("已模拟一次存储失败");
    await expect(
      page.getByRole("textbox", { name: "正文", exact: true }),
    ).toHaveValue("Retain this sentence.");
    if (operation === "保存为课文")
      await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: operation, exact: true }).click();
    if (operation === "保存为课文") {
      await page.getByRole("button", { name: "确认保存", exact: true }).click();
      await expect(page).toHaveURL(/\/lessons\//);
    } else
      await expect(
        page.getByRole("status").filter({ hasText: "草稿已保存" }),
      ).toBeVisible();
  }
});
