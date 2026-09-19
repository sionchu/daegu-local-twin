import { expect, test } from "@playwright/test";

test.describe("LocalTwin critical evidence path", () => {
  test("loads the spatial dashboard with the simplified map surface", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /사람이 많은 곳보다/ }),
    ).toBeVisible();

    await expect(page.getByText("종합 Opportunity", { exact: true }).first()).toBeVisible();

    // The primary VWorld renderer and the MapLibre fallback share one spatial-map contract.
    const map = page.getByTestId("spatial-map").first();
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await map.boundingBox())?.height ?? 0).toBeGreaterThan(400);

    // Below-fold Recharts are intentionally deferred until the chart region approaches view.
    const deferredCharts = page.getByTestId("deferred-map-charts");
    await deferredCharts.scrollIntoViewIfNeeded();
    await expect(page.getByText("시간대별 이동수요", { exact: true })).toBeVisible();
    await expect(page.getByText("임대료 vs 수요", { exact: true })).toBeVisible();
    await expect(page.getByText("12개월 Cash Runway", { exact: true })).toBeVisible();

    await expect(page.getByText(/태양 고도/)).toHaveCount(0);
    await expect(page.getByLabel("시간 선택")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("recalculates candidate finance assumptions in the compare view", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /후보비교/ }).click();

    await expect(
      page.getByRole("heading", { name: "같은 업종, 다른 생존 조건." }),
    ).toBeVisible();

    const scenarioA = page.locator('[data-testid="scenario-a"]');
    await expect(scenarioA).toBeVisible();

    const rentInput = scenarioA.getByLabel("실제 월세");
    const before = await scenarioA.textContent();

    await rentInput.fill("5200000");
    await expect(rentInput).toHaveValue("5200000");

    await expect.poll(async () => scenarioA.textContent()).not.toBe(before);
    await expect(scenarioA.getByText("필요 포착률", { exact: true })).toBeVisible();
    await expect(scenarioA.getByText("Funding Gap", { exact: true })).toBeVisible();
  });

  test("updates funding stack inputs without leaving the deterministic flow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /자금계획/ }).click();

    await expect(
      page.getByRole("heading", { name: "필요한 돈과 검토 경로를 한 화면에." }),
    ).toBeVisible();

    const fundingCard = page.locator('[data-testid="funding-structure"]');
    await expect(fundingCard).toBeVisible();

    const ownerCash = fundingCard.getByLabel("자기자금");
    const before = await fundingCard.textContent();

    await ownerCash.fill("25000000");
    await expect(ownerCash).toHaveValue("25000000");
    await expect.poll(async () => fundingCard.textContent()).not.toBe(before);

    await expect(page.getByText("공식 지원·금융 검토 후보", { exact: true })).toBeVisible();
  });
});
