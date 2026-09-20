"use client";

import {
  Activity,
  Bot,
  Check,
  Copy,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  BusinessScenario,
  FinancialAnalysis,
  LocationEvidence,
  StressPreset,
} from "@/src/types";
import {
  businessCategoryLabels,
  stressPresetLabels,
} from "@/src/types";
import type { LocalTwinToolActivity } from "@/src/webmcp";

type Props = {
  open: boolean;
  webMcpSupported: boolean;
  toolCount: number;
  activeScenario?: BusinessScenario;
  compareScenario?: BusinessScenario;
  activeCell?: LocationEvidence;
  compareCell?: LocationEvidence;
  activeAnalysis?: FinancialAnalysis | null;
  compareAnalysis?: FinancialAnalysis | null;
  activities: LocalTwinToolActivity[];
  onClose: () => void;
  onDemoStress: (preset: StressPreset) => void;
  onRunPromptDemo: (prompt: string) => void;
  onOpenCompare: () => void;
};

const examplePrompt =
  "카페 창업을 준비 중이야. 자기자금 5천만원, 월세 250만원 기준으로 동성로하고 교동을 비교하고 수요전환율 -20% 조건도 같이 검토해줘.";

function man(value: number) {
  return Math.round(value / 10_000).toLocaleString("ko-KR") + "만원";
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "데이터 부족"
    : (value * 100).toFixed(1) + "%";
}

export default function AiBusinessConsultant({
  open,
  webMcpSupported,
  toolCount,
  activeScenario,
  compareScenario,
  activeCell,
  compareCell,
  activeAnalysis,
  compareAnalysis,
  activities,
  onClose,
  onDemoStress,
  onRunPromptDemo,
  onOpenCompare,
}: Props) {
  const [prompt, setPrompt] = useState(examplePrompt);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const latestActivities = activities.slice(0, 8);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/55 backdrop-blur-[2px]"
      data-testid="ai-business-consultant"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-white/10 bg-[#071018]/98 shadow-2xl motion-safe:animate-[ai-panel-in_220ms_cubic-bezier(0.22,1,0.36,1)]">
        <div className="border-b border-white/8 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                AI 창업분석
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
                말로 조건을 주고, 실제 분석도구를 실행합니다.
              </h2>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
                AI는 조건·도구·근거를 연결하고, 금액·손익분기·현금흐름은
                기존 결정론적 계산엔진이 계산합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/8 p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
              aria-label="AI 창업분석 닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={
                "rounded-full border px-2 py-1 text-[9px] font-medium " +
                (webMcpSupported
                  ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-200"
                  : "border-amber-300/20 bg-amber-300/8 text-amber-200")
              }
            >
              {webMcpSupported
                ? "WebMCP AI 연결 가능"
                : "WebMCP 지원 브라우저에서 AI 연결"}
            </span>
            <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[9px] text-slate-400">
              도구 {toolCount}개
            </span>
            <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[9px] text-slate-400">
              숫자 생성 금지 · model.ts 기준
            </span>
          </div>
        </div>

        <div className="localtwin-no-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold text-slate-200">
                자연어 요청 예시
              </div>
              <button
                type="button"
                onClick={copyPrompt}
                className="flex items-center gap-1 rounded-md border border-white/8 px-2 py-1 text-[9px] text-slate-500 transition hover:text-white"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-300" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-white/8 bg-slate-950/60 px-3 py-2 text-[11px] leading-5 text-slate-200 outline-none transition focus:border-emerald-300/30"
              aria-label="AI 창업분석 요청"
            />
            <div className="mt-2 text-[9px] leading-4 text-slate-600">
              WebMCP 지원 AI가 이 요청을 이해하면 후보선택 → 조건변경 →
              재무분석 → 근거조회 도구를 순서대로 호출할 수 있습니다.
            </div>
            <Button
              size="sm"
              className="mt-2 w-full justify-center gap-1.5"
              onClick={() => onRunPromptDemo(prompt)}
            >
              <Play className="h-3 w-3" />
              자연어 → 도구 실행 데모
            </Button>
            <div className="mt-1.5 text-center text-[8px] leading-4 text-slate-600">
              규칙 기반 시연이며 LLM 추론이 아닙니다. 실제 AI도 동일한 WebMCP 도구를 호출합니다.
            </div>
          </section>

          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-sky-300" />
              <div className="text-[10px] font-semibold text-slate-200">
                현재 AI 분석 컨텍스트
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                <div className="text-[9px] text-slate-600">후보 A</div>
                <div className="mt-1 text-xs font-semibold text-white">
                  {activeCell?.label ?? "미선택"}
                </div>
                <div className="mt-1 text-[9px] text-slate-500">
                  {activeScenario
                    ? businessCategoryLabels[activeScenario.assumptions.category]
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                <div className="text-[9px] text-slate-600">후보 B</div>
                <div className="mt-1 text-xs font-semibold text-white">
                  {compareCell?.label ?? "미선택"}
                </div>
                <div className="mt-1 text-[9px] text-slate-500">
                  {compareScenario
                    ? businessCategoryLabels[compareScenario.assumptions.category]
                    : "—"}
                </div>
              </div>
            </div>

            {activeScenario ? (
              <div className="mt-2 grid grid-cols-3 gap-2 text-[9px]">
                <div className="rounded-lg border border-white/6 p-2">
                  <div className="text-slate-600">월세</div>
                  <div className="mt-1 font-semibold text-slate-200">
                    {man(activeScenario.assumptions.monthlyRentKrw)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 p-2">
                  <div className="text-slate-600">자기자금</div>
                  <div className="mt-1 font-semibold text-slate-200">
                    {man(activeScenario.assumptions.ownerCashKrw)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 p-2">
                  <div className="text-slate-600">스트레스</div>
                  <div className="mt-1 truncate font-semibold text-slate-200">
                    {stressPresetLabels[activeScenario.stressPreset]}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {activeAnalysis ? (
            <section className="rounded-xl border border-emerald-300/12 bg-emerald-300/[0.035] p-3">
              <div className="text-[10px] font-semibold text-emerald-100">
                결정론적 계산 결과
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                  <div className="text-[9px] text-slate-600">월 손익분기</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {man(activeAnalysis.monthlyBreakEvenRevenueKrw)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                  <div className="text-[9px] text-slate-600">필요 고객</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {Math.ceil(activeAnalysis.breakEvenCustomersPerDay)}명/일
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                  <div className="text-[9px] text-slate-600">필요 수요전환율</div>
                  <div className="mt-1 text-sm font-semibold text-emerald-200">
                    {percent(activeAnalysis.requiredCaptureRate)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 bg-black/10 p-2.5">
                  <div className="text-[9px] text-slate-600">부족자금</div>
                  <div className="mt-1 text-sm font-semibold text-amber-200">
                    {man(activeAnalysis.fundingGapKrw)}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="text-[10px] font-semibold text-slate-200">
              AI가 호출할 수 있는 도구
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "상태조회",
                "후보선택",
                "조건변경",
                "업종변경",
                "스트레스",
                "후보비교",
                "재무분석",
                "Graph-RAG 근거",
                "시나리오복제",
              ].map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-sky-300/10 bg-sky-300/[0.035] px-2 py-1 text-[9px] text-sky-100/80"
                >
                  {tool}
                </span>
              ))}
            </div>

            <div className="mt-3 border-t border-white/6 pt-3">
              <div className="text-[9px] font-medium text-slate-400">
                도구 동작 데모
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-[10px]"
                  onClick={() => onDemoStress("conversionDown")}
                >
                  <Play className="mr-1.5 h-3 w-3" />
                  수요전환율 -20%
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-[10px]"
                  onClick={() => onDemoStress("combined")}
                >
                  <Play className="mr-1.5 h-3 w-3" />
                  복합 불리조건
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-[10px]"
                  onClick={() => onDemoStress("base")}
                >
                  기본조건 복원
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start text-[10px]"
                  onClick={onOpenCompare}
                >
                  후보 A/B 비교
                </Button>
              </div>
              <div className="mt-2 text-[8px] leading-4 text-slate-600">
                데모 버튼은 AI 추론이 아니라 동일한 LocalTwin 도구 호출 경로를
                사람이 직접 확인하는 기능입니다.
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-violet-300" />
              <div className="text-[10px] font-semibold text-slate-200">
                AI / 도구 실행 이력
              </div>
            </div>
            <div className="mt-2 space-y-1.5" data-testid="ai-tool-activity">
              {latestActivities.length ? (
                latestActivities.map((activity, index) => (
                  <div
                    key={
                      activity.occurredAt +
                      activity.tool +
                      String(index)
                    }
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/10 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[9px] font-medium text-slate-300">
                        {activity.title}
                      </div>
                      <div className="mt-0.5 text-[8px] text-slate-600">
                        {activity.tool}
                      </div>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[8px] " +
                        (activity.source === "webmcp"
                          ? "bg-violet-300/8 text-violet-200"
                          : "bg-slate-300/8 text-slate-400")
                      }
                    >
                      {activity.source === "webmcp"
                        ? "AI"
                        : "데모"}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-white/8 px-3 py-4 text-center text-[9px] leading-4 text-slate-600">
                  아직 실행된 도구가 없습니다.
                  <br />
                  WebMCP AI 호출 또는 위 데모 버튼을 실행하면 기록됩니다.
                </div>
              )}
            </div>
          </section>

          {activeAnalysis && compareAnalysis && compareCell ? (
            <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <div className="text-[10px] font-semibold text-slate-200">
                A/B 비교 준비됨
              </div>
              <div className="mt-2 text-[9px] leading-4 text-slate-500">
                {activeCell?.label}와 {compareCell.label}의 결정론적 재무결과가
                모두 계산되어 있습니다. AI는 이 값을 읽고 장단점과 추가
                확인사항만 설명합니다.
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
