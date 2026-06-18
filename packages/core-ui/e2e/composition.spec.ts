import { expect, test } from "@playwright/test";

// E2E scenarios against the Vite test-app, exercising composition-by-config.
test.describe("core-ui composition shell", () => {
    test("testRegionHostsAContributedView", async ({ page }) => {
        await page.goto("/");
        // The header region hosts the contributed header view.
        await expect(page.getByTestId("header-view")).toHaveText("Welcome to core-ui");
        // The main region hosts the contributed counter view.
        await expect(page.getByTestId("counter-view")).toBeVisible();
    });

    test("testConfigChangeRecomposesTheApp", async ({ page }) => {
        await page.goto("/");
        // The conditionally-contributed view is absent until the flag flips.
        await expect(page.getByTestId("flagged-view")).toHaveCount(0);

        await page.getByTestId("toggle-flag").click();
        await expect(page.getByTestId("flagged-view")).toBeVisible();

        // Toggling back recomposes it away.
        await page.getByTestId("toggle-flag").click();
        await expect(page.getByTestId("flagged-view")).toHaveCount(0);
    });

    test("testCommandAndEventFlowThroughDispatch", async ({ page }) => {
        await page.goto("/");

        // The counter view's view-model dispatches a command on click; the
        // resulting event increments the observed total.
        await page.getByTestId("counter-view").click();
        await page.getByTestId("counter-view").click();
        await expect(page.getByTestId("counter-total")).toHaveText("counter: 2");
    });
});
