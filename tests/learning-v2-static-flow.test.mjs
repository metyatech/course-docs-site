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
      await page.getByText("最後はこの商品カードを作ります。まず見た目だけ確認します。").count(),
      1,
    );
    assert.equal(
      await page.locator(".learning-v2").evaluate((element) => getComputedStyle(element).maxWidth),
      "832px",
    );
    await page.setViewportSize({ width: 375, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    assert.ok(
      (await page
        .locator(".learning-v2 iframe")
        .evaluate((element) => element.getBoundingClientRect().height)) >= 352,
    );
    const iframeBounds = await page.locator(".learning-v2 iframe").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, viewportWidth: window.innerWidth };
    });
    assert.ok(
      iframeBounds.left >= 0 && iframeBounds.right <= iframeBounds.viewportWidth,
      `iframe preview exceeds the viewport: ${JSON.stringify(iframeBounds)}`,
    );
    await page.setViewportSize({ width: 1365, height: 1000 });
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME");
    assert.equal(await page.locator(".learning-v2 iframe").getAttribute("title"), "表示結果");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "次へ");
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
      "none",
    );
    assert.equal(await page.locator("[data-activity-id]").count(), 1);
    assert.equal(await page.getByRole("region", { name: "goal-preview" }).count(), 0);
    assert.equal(await page.locator('[data-activity-id="p-selector-prediction"]').count(), 0);
    assert.equal(await page.locator('[data-activity-id="minimal-orientation"]').count(), 0);
    assert.equal(await page.locator(".learning-v2 iframe").count(), 1);
    assert.equal(await page.locator(".learning-v2 pre").count(), 0);
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

    await page
      .locator('[data-activity-id="goal-preview"]')
      .getByRole("button", { name: "次へ" })
      .click();
    assert.equal(
      await page.getByText("CSSのセレクターが、どの要素を選ぶか見てみましょう。").count(),
      1,
    );
    assert.equal(await page.locator('[data-activity-id="p-selector-prediction"]').count(), 0);
    await page
      .locator('[data-activity-id="minimal-orientation"]')
      .getByRole("button", { name: "次へ" })
      .click();
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

    const width = page.locator('[data-activity-id="width-effect-prediction"]');
    await price.getByRole("button", { name: "次へ" }).click();
    await width.getByText(".waku に width: 300px を加えると、どこが変わると思いますか。").waitFor();
    assert.equal(await page.locator('[data-activity-id="height-completion"]').count(), 0);
    assert.equal(await width.locator("iframe").count(), 1);
    assert.doesNotMatch(
      await width.locator("iframe").first().getAttribute("srcdoc"),
      /width:\s*300px/,
    );
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await width.getByLabel("横方向のcontent部分").check();
    await width.getByRole("button", { name: "答えを確認" }).click();
    await width.getByText("正解", { exact: true }).waitFor();
    assert.match(await width.locator("iframe").nth(1).getAttribute("srcdoc"), /width: 300px/);

    const height = page.locator('[data-activity-id="height-completion"]');
    await width.getByRole("button", { name: "次へ" }).click();
    await height.getByRole("textbox", { name: "プロパティ名" }).waitFor();
    assert.doesNotMatch(await height.textContent(), /\bheight\b/);
    await height.getByRole("textbox", { name: "プロパティ名" }).fill("height");
    await height.getByRole("button", { name: "答えを確認" }).click();
    await height.getByText("正解", { exact: true }).waitFor();
    assert.match(await height.locator("iframe").last().getAttribute("srcdoc"), /height: 220px/);

    const size = page.locator('[data-activity-id="size-variation"]');
    await height.getByRole("button", { name: "次へ" }).click();
    await size.getByText("widthだけを300pxから240pxに変えます。どの変化が起きますか。").waitFor();
    await size.getByLabel("横方向のcontent部分が狭くなる").check();
    await size.getByLabel("heightは220pxのまま").check();
    await size.getByRole("button", { name: "答えを確認" }).click();
    await size.getByText("正解", { exact: true }).waitFor();
    assert.match(await size.locator("iframe").last().getAttribute("srcdoc"), /width: 240px/);

    const borderEffect = page.locator('[data-activity-id="border-effect-prediction"]');
    await size.getByRole("button", { name: "次へ" }).click();
    await borderEffect
      .getByText("border: 2px solid #7a4b2a を加えると、どこに変化が出ると思いますか。")
      .waitFor();
    await borderEffect.getByLabel("要素のまわりに線が出る").check();
    await borderEffect.getByRole("button", { name: "答えを確認" }).click();
    await borderEffect.getByText("正解", { exact: true }).waitFor();
    assert.match(
      await borderEffect.locator("iframe").last().getAttribute("srcdoc"),
      /border: 2px solid/,
    );

    const borderGeneration = page.locator('[data-activity-id="border-generation"]');
    await borderEffect.getByRole("button", { name: "次へ" }).click();
    const borderInput = borderGeneration.getByRole("textbox", { name: "border の値" });
    await borderInput.waitFor();
    assert.doesNotMatch(await borderGeneration.textContent(), /3px dashed #c2410c/);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await borderInput.fill("3px dashed #c2410c");
    await borderGeneration.getByRole("button", { name: "答えを確認" }).click();
    await borderGeneration.getByText("正解", { exact: true }).waitFor();

    const fault = page.locator('[data-activity-id="border-missing-style-variation"]');
    await borderGeneration.getByRole("button", { name: "次へ" }).click();
    await fault.getByText("この指定では枠線が見えません。足りないものを選んでください。").waitFor();
    assert.match(
      await fault.locator('pre code[data-language="css"]').textContent(),
      /border: 2px #7a4b2a;/,
    );
    await fault.getByLabel("線の種類").check();
    await fault.getByRole("button", { name: "答えを確認" }).click();
    await fault.getByText("正解", { exact: true }).waitFor();
    assert.match(
      await fault.locator('pre code[data-language="css"]').last().textContent(),
      /border: 2px solid #7a4b2a;/,
    );

    const padding = page.locator('[data-activity-id="padding-prediction"]');
    await fault.getByRole("button", { name: "次へ" }).click();
    await padding.getByText("padding: 20px を加えると、どこに空間が増えると思いますか。").waitFor();
    await padding.getByLabel("contentとborderの間").check();
    await padding.getByRole("button", { name: "答えを確認" }).click();
    await padding.getByText("正解", { exact: true }).waitFor();
    assert.match(await padding.locator("iframe").last().getAttribute("srcdoc"), /padding: 20px/);

    const fourSides = page.locator('[data-activity-id="padding-four-sides"]');
    await padding.getByRole("button", { name: "次へ" }).click();
    for (const side of ["上", "右", "下", "左"]) await fourSides.getByLabel(side).check();
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await fourSides.getByRole("button", { name: "答えを確認" }).click();
    await fourSides.getByText("正解", { exact: true }).waitFor();

    const integrated = page.locator('[data-activity-id="integrated-box-model-prediction"]');
    await fourSides.getByRole("button", { name: "次へ" }).click();
    await integrated.getByLabel("300pxより大きくなる").check();
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await integrated.getByRole("button", { name: "答えを確認" }).click();
    await integrated.getByText("正解", { exact: true }).waitFor();

    const layer = page.locator('[data-activity-id="layer-resolution"]');
    await integrated.getByRole("button", { name: "次へ" }).click();
    await layer.getByText("内側から content → padding → border の順です。").waitFor();
    const changed = page.locator('[data-activity-id="changed-condition-application"]');
    await layer.getByRole("button", { name: "次へ" }).click();
    await changed.getByLabel("contentのwidthは300pxのまま").check();
    await changed.getByLabel("padding部分が広がる").check();
    await changed.getByLabel("外側のboxは大きくなる").check();
    await changed.getByRole("button", { name: "答えを確認" }).click();
    await changed.getByText("正解", { exact: true }).waitFor();
    assert.match(await changed.locator("iframe").last().getAttribute("srcdoc"), /padding: 30px/);

    const finalSelector = page.locator('[data-activity-id="final-profile-selector"]');
    await changed.getByRole("button", { name: "次へ" }).click();
    const selectorInput = finalSelector.getByRole("textbox", { name: "CSSセレクター" });
    await selectorInput.waitFor();
    assert.doesNotMatch(await finalSelector.textContent(), /\.profile-card/);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await selectorInput.fill(".profile-card");
    await finalSelector.getByRole("button", { name: "答えを確認" }).click();
    await finalSelector.getByText("正解", { exact: true }).waitFor();

    const finalWidth = page.locator('[data-activity-id="final-profile-width"]');
    await finalSelector.getByRole("button", { name: "次へ" }).click();
    await finalWidth.getByRole("textbox", { name: "プロパティ名" }).fill("width");
    await finalWidth.getByRole("button", { name: "答えを確認" }).click();
    await finalWidth.getByText("正解", { exact: true }).waitFor();

    const finalBorder = page.locator('[data-activity-id="final-profile-border"]');
    await finalWidth.getByRole("button", { name: "次へ" }).click();
    await finalBorder.getByRole("textbox", { name: "border の値" }).fill("3px solid #2563eb");
    await finalBorder.getByRole("button", { name: "答えを確認" }).click();
    await finalBorder.getByText("正解", { exact: true }).waitFor();

    const finalPadding = page.locator('[data-activity-id="final-profile-padding"]');
    await finalBorder.getByRole("button", { name: "次へ" }).click();
    const paddingInput = finalPadding.getByRole("textbox", { name: "padding の値" });
    await paddingInput.waitFor();
    assert.doesNotMatch(await finalPadding.textContent(), /padding:\s*16px/);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );
    await paddingInput.fill("16px");
    await finalPadding.getByRole("button", { name: "答えを確認" }).click();
    await finalPadding.getByText("正解", { exact: true }).waitFor();
    assert.match(
      await finalPadding.locator("iframe").last().getAttribute("srcdoc"),
      /padding: 16px/,
    );
    assert.equal(await finalPadding.getByRole("button", { name: "次へ" }).count(), 0);
    axe = await auditLearningPlayer(page);
    assert.deepEqual(
      axe.violations.filter(({ impact }) => ["serious", "critical"].includes(impact)),
      [],
    );

    await page.reload();
    assert.equal(
      await page.getByText("最後はこの商品カードを作ります。まず見た目だけ確認します。").count(),
      1,
    );
    assert.equal(await page.locator("[data-activity-id]").count(), 1);
    assert.equal(await page.locator('[data-activity-id="p-selector-prediction"]').count(), 0);
    assert.equal(await page.locator('[data-activity-id="final-profile-padding"]').count(), 0);
  },
);
