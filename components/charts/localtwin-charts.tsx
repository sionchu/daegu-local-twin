"use client";

import {
  Area,
  AreaChart,
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
import { computeOpportunityScores } from "@/src/model";
import type {
  FinancialAnalysis,
  LocationEvidence,
  OpportunityScores,
} from "@/src/types";

const tooltipStyle = {
  background: "rgba(7, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  color: "#eef6f7",
  fontSize: 12,
};

const demandWeights = [
  [6, 0.18],
  [7, 0.32],
  [8, 0.48],
  [9, 0.58],
  [10, 0.64],
  [11, 0.72],
  [12, 0.84],
  [13, 0.78],
  [14, 0.75],
  [15, 0.81],
  [16, 0.9],
  [17, 1.0],
  [18, 1.12],
  [19, 1.08],
  [20, 0.96],
  [21, 0.83],
  [22, 0.62],
  [23, 0.38],
] as const;

const weightSum = demandWeights.reduce((sum, [, weight]) => sum + weight, 0);

function formatCompact(value: number) {
  if (Math.abs(value) >= 10_000) return (value / 10_000).toFixed(1) + "만";
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + "천";
  return Math.round(value).toLocaleString("ko-KR");
}

function formatMan(value: number) {
  return Math.round(value / 10_000).toLocaleString("ko-KR") + "만원";
}

export function DemandTimelineChart({
  dailyDemand,
  currentHour,
}: {
  dailyDemand: number | null;
  currentHour: number;
}) {
  const data = demandWeights.map(([hour, weight]) => ({
    hour: String(hour).padStart(2, "0") + ":00",
    demand: dailyDemand ? Math.round(dailyDemand * (weight / weightSum)) : 0,
  }));
  const marker = String(Math.max(6, Math.min(23, currentHour))).padStart(2, "0") + ":00";

  return (
    <ChartContainer>
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="hour"
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={2}
        />
        <YAxis
          tickFormatter={formatCompact}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [formatCompact(Number(value)) + "명 proxy", "시간대 수요"]}
        />
        <ReferenceLine
          x={marker}
          stroke="var(--chart-3)"
          strokeDasharray="4 4"
          label={{ value: "현재", fill: "#f4b860", fontSize: 10 }}
        />
        <Area
          type="monotone"
          dataKey="demand"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#demandFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function RentDemandScatterChart({
  cells,
  selectedCellId,
}: {
  cells: LocationEvidence[];
  selectedCellId?: string;
}) {
  const data = cells
    .filter((cell) => cell.rentBenchmark !== null)
    .map((cell) => {
      const scores = computeOpportunityScores(cell, cells);
      return {
        id: cell.cellId,
        name: cell.label,
        rent: (cell.rentBenchmark ?? 0) / 10_000,
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
          name="월 임대 benchmark"
          unit="만원"
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="demand"
          name="Demand"
          domain={[0, 100]}
          tick={{ fill: "#7f93a4", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            name === "월 임대 benchmark" ? Number(value).toLocaleString("ko-KR") + "만원" : value,
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
    { metric: "임대여력", value: Math.round(scores.rentRelief ?? 0) },
    { metric: "도시재생", value: Math.round(scores.regeneration ?? 0) },
    { metric: "Buzz", value: Math.round(scores.buzz ?? 0) },
    { metric: "파생수요", value: Math.round(scores.spillover ?? 0) },
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
    { label: "Funding Gap", value: analysis.fundingGapKrw },
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
