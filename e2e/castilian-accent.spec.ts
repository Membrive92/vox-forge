/**
 * E2E: Castilian-accent controls in the cross-lingual experimental tab.
 *
 * Covers the three escape hatches added when XTTS v2 was producing seseo
 * regardless of the user's intent:
 *   B  — castilian_warmup: prepend a Castilian phrase + trim
 *   C  — candidates: generate N takes and pick the best
 *   D1 — use_castilian_reference: substitute a backend reference voice
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

async function gotoExperimental(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByText(/síntesis rápida/i).click();
  await page.getByText(/modo multilingüe/i).click();
}

async function uploadSample(page: import("@playwright/test").Page): Promise<void> {
  await page.setInputFiles('input[type=file][accept*=".wav"]', {
    name: "voice.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]),
  });
}

test.describe("Cross-lingual — Castilian warm-up (B)", () => {
  test("forwards castilian_warmup=true when toggle is checked", async ({ page }) => {
    const state = await installApiMocks(page);
    await gotoExperimental(page);
    await uploadSample(page);

    // Tick the warm-up checkbox (label = "Anclar acento con frase castellana")
    await page.getByLabel(/anclar acento/i).check();

    await page.getByPlaceholder(/escribe el texto/i).fill("buenas tardes");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.experimentalCalls.length, {
      timeout: 5_000,
    }).toBe(1);

    expect(state.experimentalCalls[0]!.castilianWarmup).toBe(true);
  });

  test("hides the warm-up toggle when target language is English", async ({ page }) => {
    await installApiMocks(page);
    await gotoExperimental(page);
    await uploadSample(page);

    // Switch to English
    await page.getByRole("button", { name: /^english$/i }).click();
    await expect(page.getByLabel(/anclar acento/i)).toHaveCount(0);
  });
});

test.describe("Cross-lingual — multi-candidate (C)", () => {
  test("generating with N=3 hits the candidates endpoint and renders 3 players", async ({
    page,
  }) => {
    const state = await installApiMocks(page);
    await gotoExperimental(page);
    await uploadSample(page);

    // Click the "3" button under "Versiones"
    await page.getByRole("button", { name: "3", exact: true }).click();

    await page.getByPlaceholder(/escribe el texto/i).fill("hola mundo");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.candidatesCalls.length, {
      timeout: 5_000,
    }).toBe(1);
    expect(state.candidatesCalls[0]!.candidates).toBe(3);

    // The single-take endpoint must NOT be hit
    expect(state.experimentalCalls).toHaveLength(0);

    // Three audio players should be visible
    await expect(page.locator("audio")).toHaveCount(3);
  });

  test("default count of 1 still uses the single-take endpoint", async ({ page }) => {
    const state = await installApiMocks(page);
    await gotoExperimental(page);
    await uploadSample(page);

    await page.getByPlaceholder(/escribe el texto/i).fill("hola");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.experimentalCalls.length, {
      timeout: 5_000,
    }).toBe(1);
    expect(state.candidatesCalls).toHaveLength(0);
  });
});

test.describe("Cross-lingual — Castilian reference voice (D1)", () => {
  test("toggle is disabled when no reference is configured", async ({ page }) => {
    await installApiMocks(page);
    await gotoExperimental(page);
    await uploadSample(page);

    const ref = page.getByLabel(/usar voz castellana de referencia/i);
    await expect(ref).toBeDisabled();
  });

  test("toggle is enabled when a reference is configured, and forwards the flag", async ({
    page,
  }) => {
    const state = await installApiMocks(page);
    state.setReferenceVoice({ configured: true, filename: "alvaro.wav" });
    await gotoExperimental(page);
    await uploadSample(page);

    const ref = page.getByLabel(/usar voz castellana de referencia/i);
    await expect(ref).toBeEnabled({ timeout: 5_000 });
    await ref.check();

    await page.getByPlaceholder(/escribe el texto/i).fill("hola");
    await page.getByRole("button", { name: /^generar$/i }).click();

    await expect.poll(() => state.experimentalCalls.length, {
      timeout: 5_000,
    }).toBe(1);
    expect(state.experimentalCalls[0]!.useCastilianReference).toBe(true);
  });
});
