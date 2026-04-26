/**
 * E2E: Quick Synth standard flow.
 *
 * Covers the most common path a user takes: navigate to Quick Synth,
 * type some text, hit Generate, and confirm the audio is ready.
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Quick Synth — standard flow", () => {
  test("user generates audio from text and sees the player", async ({ page }) => {
    const state = await installApiMocks(page);
    await page.goto("/");

    // Default tab is Workbench — switch to Quick Synth
    await page.getByText(/síntesis rápida/i).click();

    const textarea = page.getByPlaceholder(/escribe o pega/i);
    await textarea.fill("Hola mundo desde el e2e.");

    const generate = page.getByRole("button", { name: /generar audio/i });
    await expect(generate).toBeEnabled();
    await generate.click();

    // Toast confirms generation completed
    await expect(page.getByText(/audio listo/i)).toBeVisible({ timeout: 10_000 });
    // The synthesis call was recorded with the typed text
    expect(state.synthesisCalls).toHaveLength(1);
    expect(state.synthesisCalls[0]!.text).toContain("Hola mundo");
  });

  test("Generate button is disabled with empty text", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await page.getByText(/síntesis rápida/i).click();

    const generate = page.getByRole("button", { name: /generar audio/i });
    await expect(generate).toBeDisabled();
  });
});
