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
      page.getByRole("heading", { name: "대구 전역 상권 분석" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "상권잠재", exact: true })).toBeVisible();
    await expect(page.getByTestId("citywide-context-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("citywide-commercial-analysis")).toBeVisible();
    await expect(page.getByText("전역 후보 19개", { exact: true })).toBeVisible();
    await expect(page.getByText(/검색관심: 직접관측 미확보/)).toBeVisible();
    await expect(page.getByText(/생활인구·카드매출: 반출자료 대기/)).toBeVisible();
    await expect(page.getByText("구·군 주민등록인구", { exact: true })).toBeVisible();
    await expect(page.getByText("공식 학교", { exact: true })).toBeVisible();
    await expect(page.getByText("공식 의료시설", { exact: true })).toBeVisible();
    await expect(page.getByText("등록 공장", { exact: true })).toBeVisible();
    await expect(page.getByTestId("housing-capacity-panel")).toBeVisible();
    await expect(page.getByText("공동주택 주거용량", { exact: true })).toBeVisible();
    await expect(page.getByText("공동주택 세대", { exact: true })).toBeVisible();
    await expect(page.getByText(/상권잠재 점수에는/)).toBeVisible();
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

    const metadata = await page.evaluate(async () => {
      const [zoneDocument, commercialDocument, housingDocument] = await Promise.all([
        fetch("/data/daegu_analysis_zones.geojson").then((response) => response.json()),
        fetch("/data/citywide_commercial_candidates.geojson").then((response) =>
          response.json(),
        ),
        fetch("/data/housing_capacity.json").then((response) => response.json()),
      ]);
      return {
        zones: zoneDocument.metadata,
        commercial: commercialDocument.metadata,
        housing: housingDocument.coverage,
      };
    });
    expect(metadata.zones.quality).toBe("official");
    expect(metadata.zones.sourceDatasetId).toBe("15129688");
    expect(metadata.zones.zoneCount).toBe(150);
    expect(metadata.commercial.coverage.localityCandidateCount).toBe(14);
    expect(metadata.commercial.coverage.centralCorridorCount).toBe(5);
    expect(metadata.commercial.coverage.candidateCount).toBe(19);
    expect(metadata.housing.daeguComplexRecords).toBe(9100);
    expect(metadata.housing.daeguHouseholds).toBe(749768);
    expect(metadata.housing.exactNameLinkedZoneCount).toBe(38);
    expect(metadata.housing.householdCoveragePct).toBe(32.84);
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

  test("keeps the app layout stable under the VWorld global CSS reset", async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1120 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "상권 입지 검토" }),
    ).toBeVisible();

    const main = page.locator("main");
    const panel = page.getByTestId("candidate-panel");
    const beforeMain = await main.boundingBox();
    const beforePanel = await panel.boundingBox();

    expect(beforeMain).not.toBeNull();
    expect(beforePanel).not.toBeNull();

    await page.addStyleTag({
      content: `
        @layer vworld {
          * {
            padding: 0;
            margin: 0;
            border: 0;
            outline: 0;
            box-sizing: border-box;
            vertical-align: middle;
          }
        }
      `,
    });

    const afterMain = await main.boundingBox();
    const afterPanel = await panel.boundingBox();

    expect(afterMain).not.toBeNull();
    expect(afterPanel).not.toBeNull();
    expect(afterMain!.x).toBeCloseTo(beforeMain!.x, 0);
    expect(afterMain!.width).toBeCloseTo(beforeMain!.width, 0);
    expect(afterPanel!.x).toBeCloseTo(beforePanel!.x, 0);
    expect(afterPanel!.width).toBeCloseTo(beforePanel!.width, 0);
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
