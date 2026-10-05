import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { findFirstFreePort } from "../scripts/port-availability.mjs";
import {
  closeBrowserBounded,
  createRunDevTestEnv,
  killProcessTreeAndWaitForPort,
  waitForDevServerReady,
} from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditLearningPlayer = (page) =>
  new AxeBuilder({ page })
    .include(".learning-v2")
    .setLegacyMode(true)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

test(
  "development pilot follows the fixed commit-before-reveal course flow",
  { timeout: 300_000 },
  async (t) => {
    const port = await findFirstFreePort(3210);
    const baseUrl = `http://127.0.0.1:${port}`;
    const dev = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "--port", String(port)],
      {
        cwd: projectRoot,
        env: createRunDevTestEnv({ label: "learning-v2-static-flow", env: process.env }),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: "inherit",
      },
    );
    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
      await killProcessTreeAndWaitForPort(dev, port);
    });

    await waitForDevServerReady({
      child: dev,
      url: `${baseUrl}/dev/learning-v2/`,
      timeoutMs: 150_000,
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1365, height: 1000 },
      colorScheme: "light",
    });
    const page = await context.newPage();
    await page.goto("/dev/learning-v2/");

    assert.equal(
      await page.getByText("CSSのセレクターが、どの要素を選ぶか見てみましょう。").count(),
      1,
    );
    assert.equal(
      await page.locator(".learning-v2").evaluate((element) => getComputedStyle(element).maxWidth),
      "832px",
    );
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "次へ");
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
      "none",
    );
    assert.equal(await page.locator("[data-activity-id]").count(), 1);
    assert.equal(await page.locator('[data-activity-id="p-selector-prediction"]').count(), 0);
    assert.equal(await page.title(), "CSSの学習");
    let axe;
    await page.emulateMedia({ colorScheme: "dark" });
    const darkContrast = await page.locator(".learning-v2").evaluate((element) => {
      const parse = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
      const luminance = (color) =>
        parse(color)
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
          )
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const styles = getComputedStyle(element);
      const foreground = luminance(styles.color);
      const background = luminance(styles.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(darkContrast >= 4.5, `dark mode text contrast was ${darkContrast}`);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await page.emulateMedia({ colorScheme: "light" });
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );

    await page.getByRole("button", { name: "次へ" }).click();
    const prediction = page.locator('[data-activity-id="p-selector-prediction"]');
    await prediction.getByText("このCSSで色が付く要素をすべて選んでください。").waitFor();
    assert.equal(await prediction.getByRole("checkbox").count(), 4);
    assert.equal(await prediction.locator("iframe").count(), 0);
    assert.equal(await page.locator('[data-activity-id="concrete-result-reasoning"]').count(), 0);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    for (const optionIndex of [0, 2, 3])
      await prediction.getByRole("checkbox").nth(optionIndex).check();
    assert.equal(await prediction.getByRole("button", { name: "次へ" }).count(), 0);
    await prediction.getByRole("button", { name: "答えを確認" }).click();
    await prediction.getByText("正解", { exact: true }).waitFor();
    const tagFrame = prediction.locator('iframe[title="表示結果"]');
    await tagFrame.waitFor();
    const tagDocument = await tagFrame.getAttribute("srcdoc");
    assert.match(tagDocument, /<p>おすすめ<\/p>/);
    assert.match(tagDocument, /<h2>チョコドーナツ<\/h2>/);
    assert.match(tagDocument, /<p>180円<\/p>/);
    assert.match(tagDocument, /p \{/);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );

    await prediction.getByRole("button", { name: "次へ" }).click();
    await page.getByText("p セレクターは、HTML内のすべての p 要素を選びます。").waitFor();
    await page
      .locator('[data-activity-id="concrete-result-reasoning"]')
      .getByRole("button", { name: "次へ" })
      .click();
    const classOnly = page.locator('[data-activity-id="class-added-only"]');
    await classOnly.getByText('class="nedan" だけを追加します。').waitFor();
    assert.match(
      await classOnly.locator('pre code[data-language="html"]').textContent(),
      /class="nedan"/,
    );
    assert.match(await classOnly.locator('pre code[data-language="css"]').textContent(), /^p \{/m);
    assert.doesNotMatch(
      await classOnly.locator('pre code[data-language="css"]').textContent(),
      /^\.nedan \{/m,
    );
    assert.equal(await classOnly.locator('iframe[title="表示結果"]').count(), 1);

    await classOnly.getByRole("button", { name: "次へ" }).click();
    const active = page.locator('[data-activity-id="class-selector-active"]');
    await active
      .getByText(
        "次に、CSSのセレクターだけを .nedan に変えます。どの要素に色が付くか選んでください。",
      )
      .waitFor();
    assert.match(
      await active.locator('pre code[data-language="html"]').textContent(),
      /class="nedan"/,
    );
    assert.match(
      await active.locator('pre code[data-language="css"]').textContent(),
      /^\.nedan \{/m,
    );
    assert.equal(await active.locator("iframe").count(), 0);
    assert.equal(await active.getByRole("checkbox").count(), 4);
    await active.getByLabel('<p class="nedan">180円</p>').check();
    await active.getByRole("button", { name: "答えを確認" }).click();
    await active.getByText("正解", { exact: true }).waitFor();
    const activeDocument = await active.locator('iframe[title="表示結果"]').getAttribute("srcdoc");
    assert.match(activeDocument, /class="nedan"/);
    assert.match(activeDocument, /\.nedan \{/);

    await active.getByRole("button", { name: "次へ" }).click();
    const waku = page.locator('[data-activity-id="waku-independent-generation"]');
    const wakuInput = waku.getByRole("textbox", { name: "CSSセレクター" });
    await wakuInput.waitFor();
    assert.doesNotMatch(await waku.textContent(), /\.waku/);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await wakuInput.fill(".waku");
    await waku.getByRole("button", { name: "答えを確認" }).click();
    await waku.getByText("正解", { exact: true }).waitFor();
    assert.equal(await waku.getByText(".waku", { exact: true }).count(), 1);

    await waku.getByRole("button", { name: "次へ" }).click();
    const price = page.locator('[data-activity-id="price-fresh-variation"]');
    const priceInput = price.getByRole("textbox", { name: "CSSセレクター" });
    await priceInput.fill(".price");
    await price.getByRole("button", { name: "答えを確認" }).click();
    await price.getByText("正解", { exact: true }).waitFor();
    assert.equal(await price.getByText(".price", { exact: true }).count(), 1);

    await page.reload();
    assert.equal(
      await page.getByText("CSSのセレクターが、どの要素を選ぶか見てみましょう。").count(),
      1,
    );
    assert.equal(await page.locator("[data-activity-id]").count(), 1);
    assert.equal(await page.locator('[data-activity-id="p-selector-prediction"]').count(), 0);
  },
);
