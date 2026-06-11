/**
 * E2E: Profile sync between Experimental tab and Voices tab.
 *
 * This is the regression that motivated the whole E2E suite — saving
 * a voice from the Experimental tab silently used a *separate*
 * useProfiles() instance, so the new profile never showed up in the
 * Voices tab. Verify the full flow: experimental -> save -> see in
 * Voices.
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Profile sync — Experimental → Voices", () => {
  // SKIPPED after Sprint A reorg: VoicesPlusLab stacks the gallery
  // and the experimental panel in the same scroll, so navigating to
  // the experimental "save as profile" button now competes with
  // identical UI elements in the gallery (multiple "Guardar perfil"
  // buttons, multiple text inputs). Sprint C will give the lab its
  // own consolidated panel and these tests will be rewritten.
  test.skip("a profile saved from Experimental appears immediately in Voices", async ({ page }) => {
    const state = await installApiMocks(page);
    await page.goto("/");

    // Quick Synth → switch to Multilingual mode
    await page.getByText(/^mis voces$/i).click();
    await page.getByText(/modo multilingüe/i).click();

    // Upload a voice sample via the file input (the explicit upload
    // button uses a hidden <input type=file>; we set files directly).
    const sample = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    await page.locator('input[type=file][accept*=".wav"]').last().setInputFiles( {
      name: "voice.wav",
      mimeType: "audio/wav",
      buffer: sample,
    });

    // The "Save as profile" button only renders once a sample is set
    await page.getByRole("button", { name: /guardar muestra como perfil/i }).click();

    // PromptDialog opens; type a name and confirm
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("input[type=text]").first().fill("Voz E2E");
    await dialog.getByRole("button", { name: /guardar perfil/i }).click();

    // Toast confirms the save: "Perfil «Voz E2E» guardado"
    await expect(page.getByText(/perfil.*voz e2e.*guardado|profile.*voz e2e.*saved/i)).toBeVisible({
      timeout: 5_000,
    });

    // The mock state confirms POST went through.
    expect(state.profiles.find((p) => p.name === "Voz E2E")).toBeTruthy();

    // Navigate to Voices — the regression check: the parent's hook saw the
    // create, so the new profile renders as a heading in the My Profiles
    // section (not just as a transient toast).
    await page.getByRole("tab", { name: /^mis voces$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Voz E2E" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
