"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import {
  computeOpportunityScores,
  type OpportunityScores,
} from "@/src/model";
import type {
  FinancialAnalysis,
  LocationEvidence,
} from "@/src/types";

const tooltipStyle = {
  background: "rgba(7, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  color: "#eef6f7",
  fontSize: 12,
};

function formatCompact(value: number) {
  if (Math.abs(value) >= 10_000) return (value / 10_000).toFixed(1) + "만";
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + "천";
  return Math.round(value).toLocaleString("ko-KR");
}

function formatMan(value: number) {
  return Math.round(value / 10_000).toLocaleString("ko-KR") + "만원";
}

export function RentDemandScatterChart({
  cells,
  selectedCellId,
}: {
  cells: LocationEvidence[];
  selectedCellId?: string;
}) {
  const data = cells
    .filter((cell) => cell.rentBenchmarkKrwPerSqm !== null)
    .map((cell) => {
      const scores = computeOpportunityScores(cell, cells);
      return {
        id: cell.cellId,
        name: cell.label,
        rent: (cell.rentBenchmarkKrwPerSqm ?? 0) / 1_000,
        demand: Math.round(scores.demandScore ?? 0),
        selected: cell.cellId === selectedCellId,
      };
    });

  return (
    <ChartContainer>
      <ScatterChart margin={{ top: 12, right: 18, bottom: 12, left: -10 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" />
        <XAxis
          type="number"
          dataKey="rent"
          name="참고 임대료"
          unit="천원/㎡"
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="demand"
          name="수요여건"
          domain={[0, 100]}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            name === "참고 임대료" ? Number(value).toLocaleString("ko-KR") + "천원/㎡" : value,
            name,
          ]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ""}
        />
        <Scatter data={data} fill="var(--chart-1)">
          {data.map((item) => (
            <Cell
              key={item.id}
              fill={item.selected ? "var(--chart-3)" : "var(--chart-1)"}
              stroke={item.selected ? "#fff" : "transparent"}
              strokeWidth={item.selected ? 2 : 0}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  );
}

export function CashRunwayChart({
  base,
  stressed,
  stressLabel,
}: {
  base: FinancialAnalysis;
  stressed: FinancialAnalysis;
  stressLabel: string;
}) {
  const data = base.monthlyTimeline.map((point, index) => ({
    month: "M" + point.month,
    base: Math.round(point.cashBalanceKrw / 10_000),
    stress: Math.round((stressed.monthlyTimeline[index]?.cashBalanceKrw ?? 0) / 10_000),
  }));

  return (
    <ChartContainer>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -6 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(value) => value.toLocaleString("ko-KR")}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          unit="만"
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            Number(value).toLocaleString("ko-KR") + "만원",
            name === "base" ? "기본" : stressLabel,
          ]}
        />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" />
        <Line
          type="monotone"
          dataKey="base"
          stroke="var(--chart-1)"
          strokeWidth={2.3}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="stress"
          stroke="var(--chart-3)"
          strokeWidth={2}
          dot={false}
          strokeDasharray="5 4"
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

export function OpportunityCompositionChart({
  scores,
}: {
  scores: OpportunityScores;
}) {
  const data = [
    { metric: "수요", value: Math.round(scores.demandScore ?? 0) },
    { metric: "임대여건", value: Math.round(scores.rentRelief ?? 0) },
    { metric: "도시재생", value: Math.round(scores.regeneration ?? 0) },
    { metric: "검색관심", value: Math.round(scores.buzz ?? 0) },
    { metric: "주변집객", value: Math.round(scores.spillover ?? 0) },
  ];

  return (
    <ChartContainer>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 16, bottom: 0, left: 6 }}
      >
        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="metric"
          width={58}
          tick={{ fill: "#a7b6c2", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [String(value) + " / 100", "정규화 지표"]}
        />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} fill="var(--chart-2)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

export function FinanceBridgeChart({
  analysis,
}: {
  analysis: FinancialAnalysis;
}) {
  const data = [
    { label: "창업 필요", value: analysis.startupCapitalNeedKrw },
    { label: "초기 지출", value: analysis.upfrontUsesKrw },
    { label: "운전자금", value: analysis.openingWorkingCapitalKrw },
    { label: "부족자금", value: analysis.fundingGapKrw },
  ];

  return (
    <ChartContainer className="h-[210px]">
      <BarChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(value) => formatCompact(Number(value))}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [formatMan(Number(value)), "금액"]}
        />
        <Bar dataKey="value" fill="var(--chart-4)" radius={[5, 5, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
