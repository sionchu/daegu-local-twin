import { expect, test } from "@playwright/test";

test.describe("LocalTwin critical evidence path", () => {
  test("loads the spatial dashboard with the simplified map surface", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "상권 입지 검토" }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "입지종합", exact: true })).toBeVisible();

    // The primary VWorld renderer and the MapLibre fallback share one spatial-map contract.
    const map = page.getByTestId("spatial-map").first();
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await map.boundingBox())?.height ?? 0).toBeGreaterThan(400);
    await expect(page.getByTestId("market-relation-graph")).toBeVisible();

    // Below-fold Recharts are intentionally deferred until the chart region approaches view.
    const deferredCharts = page.getByTestId("deferred-map-charts");
    await deferredCharts.scrollIntoViewIfNeeded();
    await expect(page.getByText("임대여건과 수요", { exact: true })).toBeVisible();
    await expect(page.getByText("입지종합 구성", { exact: true })).toBeVisible();
    await expect(page.getByText("12개월 현금흐름", { exact: true })).toBeVisible();

    await expect(page.getByText(/태양 고도/)).toHaveCount(0);
    await expect(page.getByLabel("시간 선택")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("loads Daegu-wide context layers and the regional evidence panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "대구 전체", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "대구 전역 지역맥락" }),
    ).toBeVisible();
    await expect(page.getByTestId("citywide-context-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("구·군 주민등록인구", { exact: true })).toBeVisible();
    await expect(page.getByText("공식 학교", { exact: true })).toBeVisible();
    await expect(page.getByText("공식 의료시설", { exact: true })).toBeVisible();
    await expect(page.getByText("등록 공장", { exact: true })).toBeVisible();
    await expect(page.getByText("공식 상가업소 구조", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "의료", exact: true }).click();
    await expect(page.getByText("의료", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/거리감쇠 상대지표/)).toBeVisible();

    await page.getByRole("button", { name: "상업밀도", exact: true }).click();
    await expect(page.getByText("상업밀도", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/SEMAS 2026Q2 점포밀도 상대지표/)).toBeVisible();

    await page.getByRole("button", { name: "업종다양성", exact: true }).click();
    await expect(page.getByText("업종다양성", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/SEMAS 2026Q2 업종다양성/)).toBeVisible();

    const zoneMetadata = await page.evaluate(async () => {
      const response = await fetch("/data/daegu_analysis_zones.geojson");
      const document = await response.json();
      return document.metadata;
    });
    expect(zoneMetadata.quality).toBe("official");
    expect(zoneMetadata.sourceDatasetId).toBe("15129688");
    expect(zoneMetadata.zoneCount).toBe(150);
  });

  test("keeps the map and review panel side by side at tablet-desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "상권 입지 검토" }),
    ).toBeVisible();

    const map = page.getByTestId("spatial-map").first();
    const panel = page.getByTestId("candidate-panel");
    await expect(map).toBeVisible();
    await expect(panel).toBeVisible();

    const [mapBox, panelBox, layout] = await Promise.all([
      map.boundingBox(),
      panel.boundingBox(),
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ]);

    expect(mapBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width - 8);
    expect(panelBox!.y).toBeLessThan(mapBox!.y + mapBox!.height / 2);
    expect(layout.scrollWidth).toBe(layout.clientWidth);
  });

  test("recalculates candidate finance assumptions in the compare view", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /후보비교/ }).click();

    await expect(
      page.getByRole("heading", { name: "같은 업종, 다른 입지 조건." }),
    ).toBeVisible();

    const scenarioA = page.locator('[data-testid="scenario-a"]');
    await expect(scenarioA).toBeVisible();

    const rentInput = scenarioA.getByLabel("실제 월세");
    const before = await scenarioA.textContent();

    await rentInput.fill("5200000");
    await expect(rentInput).toHaveValue("5200000");

    await expect.poll(async () => scenarioA.textContent()).not.toBe(before);
    await expect(scenarioA.getByText("필요 수요전환율", { exact: true })).toBeVisible();
    await expect(scenarioA.getByText("부족자금", { exact: true })).toBeVisible();
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
