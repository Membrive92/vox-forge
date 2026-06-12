/**
 * E2E: keyboard navigation of the main tablist (F5 acceptance).
 *
 * The nav implements the ARIA tabs pattern: role=tablist/tab,
 * aria-selected, and a roving tabindex driven by Arrow/Home/End keys.
 * This spec walks every visible tab without the mouse and verifies
 * both selection and focus follow the arrows.
 */
import { expect, test } from "@playwright/test";

import { installApiMocks } from "./fixtures/api-mocks";

test.describe("Keyboard navigation — main tabs", () => {
  test("arrow keys move selection and focus across all tabs and wrap around", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Only the active tab is in the tab order (roving tabindex).
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

    // Focus the active tab, then walk right through every tab.
    await tabs.first().focus();
    for (let i = 1; i < count; i++) {
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
      await expect(tabs.nth(i)).toBeFocused();
    }

    // One more ArrowRight wraps back to the first tab.
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toBeFocused();

    // ArrowLeft wraps backwards to the last tab; Home returns to the first.
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(count - 1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toBeFocused();
  });
});
