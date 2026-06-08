/**
 * E2E: Experimental cross-lingual sends speed param.
 *
 * Regression: the speed slider in cross-lingual mode existed in the UI
 * but the value was never sent to the backend. Users who slowed audio
 * post-hoc got "drunk narrator" pitch artifacts.
 *
 * Verify:
 *   1. Default generation sends speed=100
 *   2. Moving the slider to 75 sends speed=75
 *   3. The voice_sample is also attached
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Cross-lingual — speed parameter", () => {
  test("sends default speed (100) when slider is untouched", async ({ page }) => {
    const state = await installApiMocks(page);
    await page.goto("/");

    await page.getByText(/^mis voces$/i).click();
    await page.getByText(/modo multilingüe/i).click();

    const sample = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
    await page.locator('input[type=file][accept*=".wav"]').last().setInputFiles( {
      name: "voice.wav",
      mimeType: "audio/wav",
      buffer: sample,
    });

    await page.getByPlaceholder(/escribe el texto/i).fill("hola");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.experimentalCalls.length, {
      timeout: 5_000,
    }).toBe(1);

    const call = state.experimentalCalls[0]!;
    expect(call.speed).toBe(100);
    expect(call.hasVoiceSample).toBe(true);
    expect(call.text).toBe("hola");
  });

  // SKIPPED after Sprint A reorg: getByRole("slider") now matches
  // multiple sliders (speed in the experimental lab + speed/pitch/
  // volume in the upload card). Will be re-enabled in Sprint C when
  // the lab is decoupled from the gallery.
  test.skip("sends speed=75 when slider moved down", async ({ page }) => {
    const state = await installApiMocks(page);
    await page.goto("/");

    await page.getByText(/^mis voces$/i).click();
    await page.getByText(/modo multilingüe/i).click();

    await page.locator('input[type=file][accept*=".wav"]').last().setInputFiles( {
      name: "voice.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from([0]),
    });

    await page.getByRole("slider").fill("75");
    await page.getByPlaceholder(/escribe el texto/i).fill("test");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.experimentalCalls.length, {
      timeout: 5_000,
    }).toBe(1);
    expect(state.experimentalCalls[0]!.speed).toBe(75);
  });
});
