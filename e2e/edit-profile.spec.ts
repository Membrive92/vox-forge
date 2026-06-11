/**
 * E2E: Edit profile flow with scroll.
 *
 * Regression: the edit pencil button changed React state but didn't
 * scroll the form into view, so users on tall pages thought "nothing
 * happened". Verify clicking edit:
 *   1. Populates the form
 *   2. Switches the save button label to "Confirmar"
 *   3. Scrolls the form into view (window.scrollY ~ 0)
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Edit profile — scroll + populate", () => {
  test("clicking edit fills the form and scrolls the page to the top", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");

    // Open Voices tab
    await page.getByRole("tab", { name: /^mis voces$/i }).click();

    // Create a profile
    await page.getByPlaceholder(/ej:/i).fill("Voz para editar");
    await page.getByRole("button", { name: /guardar perfil/i }).click();

    await expect(page.getByText("Voz para editar")).toBeVisible({ timeout: 5_000 });

    // Scroll down so the test can verify the edit click scrolled back up
    await page.evaluate(() => window.scrollTo({ top: 800 }));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    // Click the edit (pencil) icon — its aria-label is "Editar" in ES
    await page.getByRole("button", { name: /^editar$/i }).click();

    // Form populated with the profile name
    await expect(page.getByPlaceholder(/ej:/i)).toHaveValue("Voz para editar");

    // Save button label switched to Confirmar
    await expect(page.getByRole("button", { name: /^confirmar$/i })).toBeVisible();

    // Page scrolled back to top (smooth scroll → wait briefly)
    await expect.poll(async () => page.evaluate(() => window.scrollY), {
      timeout: 3_000,
    }).toBeLessThan(50);
  });
});
