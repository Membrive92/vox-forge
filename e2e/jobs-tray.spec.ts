/**
 * E2E: global job tray (UX-01).
 *
 * Launch a synthesis in Voices, switch to the Workbench mid-flight,
 * confirm the header tray surfaces the running job, and click it to
 * land back on the originating tab. The default synthesize mock
 * resolves instantly, so the spec re-registers the route with a delay
 * (last-registered route wins in Playwright) to keep the job
 * observable while we navigate.
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Job tray — cross-tab progress", () => {
  test("synthesis stays visible from another tab and the tray leads back", async ({ page }) => {
    await installApiMocks(page);
    const fakeMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    await page.route("http://localhost:5180/api/synthesize", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: "audio/mp3",
        headers: {
          "X-Audio-Duration": "1.5",
          "X-Audio-Size": String(fakeMp3.length),
          "X-Audio-Engine": "edge-tts",
          "X-Audio-Chunks": "1",
        },
        body: fakeMp3,
      });
    });
    await page.goto("/");

    // Launch a quick synth from the Voices lab section.
    await page.getByText(/^mis voces$/i).click();
    await page.getByPlaceholder(/escribe o pega/i).fill("Texto para el job tray.");
    await page.getByRole("button", { name: /generar audio/i }).click();

    // Switch away mid-flight — the tray must surface the job.
    await page.getByText(/^mis libros$/i).click();
    const trayButton = page.getByRole("button", { name: "Trabajos en curso" });
    await expect(trayButton).toBeVisible();
    await trayButton.click();
    const row = page.getByRole("button", { name: /síntesis rápida/i });
    await expect(row).toBeVisible();

    // Clicking the entry navigates back to the origin tab.
    await row.click();
    await expect(page.getByRole("tab", { name: /mis voces/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // And the job itself still completes normally.
    await expect(page.getByText(/audio listo/i)).toBeVisible({ timeout: 10_000 });
  });
});
