import { test, expect } from '@playwright/test';


test('can navigate to about', async ({ page }) => {
    await page.goto('/');
    await page.click('text=About');
    await expect(page).toHaveURL(/about/);
});
