/**
 * E2E: Workbench tab smoke test.
 *
 * Verifies the most important Workbench surface: the empty-state UI
 * renders, the "+ Nuevo proyecto" button is present, and the layout
 * doesn't blow up. Project creation requires a working /api/projects
 * endpoint mock — kept minimal here on purpose so the test is robust.
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Workbench — smoke", () => {
  test("renders the empty state with a 'Nuevo proyecto' button", async ({ page }) => {
    await installApiMocks(page); // installs a default empty-projects mock
    await page.goto("/");
    // Workbench is the default tab. The empty-state CTA should render.
    await expect(page.getByRole("button", { name: /\+ nuevo proyecto/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
