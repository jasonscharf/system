import { expect, test } from "@playwright/test";

// E2E scenarios against the Vite test-app, exercising regions + config-driven
// menus together.
test.describe("ui-menus regions + menus shell", () => {
    test("testRegionsAndMenusRender", async ({ page }) => {
        await page.goto("/");
        // The header region hosts the contributed header view.
        await expect(page.getByTestId("header-view")).toHaveText("Welcome to ui-menus");
        // The main region hosts the contributed counter view.
        await expect(page.getByTestId("counter-view")).toBeVisible();
        // The primary menu rendered its contributed items.
        await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
        // The admin item is visible because the registry was granted the capability.
        await expect(page.getByRole("button", { name: "Admin" })).toBeVisible();
    });

    test("testMenuCommandFlowsThroughDispatchToEvent", async ({ page }) => {
        await page.goto("/");

        // Activating a menu item dispatches its command, whose wire emits an event
        // the shell observes.
        await page.getByRole("button", { name: "Reports" }).click();
        await expect(page.getByTestId("last-event")).toHaveText("last-event: nav.changed:reports");
    });

    test("testMenuEventKindDispatchesDirectly", async ({ page }) => {
        await page.goto("/");

        // An event-kind item emits the event itself, with no command in between.
        await page.getByRole("button", { name: "Direct event" }).click();
        await expect(page.getByTestId("last-event")).toHaveText("last-event: nav.changed:direct");
    });

    test("testViewModelCommandIncrementsCounter", async ({ page }) => {
        await page.goto("/");

        // The counter view's view-model dispatches a command on click; the
        // resulting event increments the observed total.
        await page.getByTestId("counter-view").click();
        await page.getByTestId("counter-view").click();
        await expect(page.getByTestId("counter-total")).toHaveText("counter: 2");
    });
});
