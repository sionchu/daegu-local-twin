# LocalTwin Daegu

**대구 청년창업을 위한 상권·자금 시뮬레이터**

대구의 상권 수요와 도시재생 신호를 지도에서 비교하고, 실제 점포 조건을 넣어 필요한 창업비용·손익분기점·현금흐름·자금부족을 계산하는 2026 AI Blockchain Challenge in Daegu prototype입니다.

> “어디가 뜰까?”가 아니라, **“이 위치·이 임대조건·이 자기자본으로 내가 실제로 버틸 수 있는가?”**

## What is in V0

- 동성로–교동–북성로 corridor의 하나의 육각형 셀 체계와 레이어 토글
- 상권 수요, 교통 접근, Buzz, 거리감쇠 기반 파생수요, 도시재생 맥락, 지역 임대 benchmark, 종합 Opportunity 신호
- 후보 A/B 선택과 업종별 실제 보증금·월세·창업비용 입력
- 월 손익분기 매출, 하루 필요 고객, 관련 이동수요 proxy 대비 필요 전환율, 12개월 현금흐름, 현금고갈, payback, Funding Gap
- 기본 / 이동수요 -20% / 전환율 -20% / 원가율 +10%p / 임대료 +10% / 금리 +1%p / 복합 악화 stress preset
- 대구 청년창업·북성로 창업클러스터·대구신용보증재단의 상담/공고 검토 항목
- 선택적 VWorld 브라우저 provider와 항상 사용 가능한 Demo geometry fallback
- optional offline RF-DETR + tracker + line/zone aggregate pipeline

V0는 은행 신용승인 모델, 대출한도 예측, 성공확률, 매출 예측 oracle, 부동산 매물/공실 DB, SNS 모니터링 시스템이 아닙니다. 지원·보증·대출 여부와 한도는 기관 심사에 따릅니다.

## Evidence boundary

모든 숫자는 `observed`, `official`, `modelled`, `demo` 중 하나로 구분합니다. 이 저장소의 중앙 corridor 숫자는 공개자료 adapter 계약을 보여주는 **demo snapshot**입니다. 공개 데이터 source URL과 제한사항은 [`public/data/provenance.json`](./public/data/provenance.json)에 하나로 모았습니다.

- `public/data/opportunity_cells.json` — 지도에 표시하는 정규화 전 원자료와 provenance IDs
- `public/data/businesses.json` — compact POI snapshot shape
- `public/data/transit.json` — 대구교통공사 역별·일별·시간대별 승하차 공식 파일 snapshot 또는, refresh 전에는 명시적 demo proxy
- `public/data/regeneration.json` — 도시재생/쇠퇴 맥락
- `public/data/rent_benchmark.json` — 상권/지역 benchmark; 해당 점포 실제 월세·공실 아님
- `public/data/buzz.json` — 상대 관심도/게시량 proxy; 절대 검색량 아님
- `public/data/footfall.json` — aggregate-only vision output shape; 현재 커밋은 demo
- `public/data/support_programs.json` — 기관 원문을 다시 확인하는 검토 후보

## Architecture

```text
official/public data (metro first) + permitted local video
          ↓ offline adapters / optional vision
provenance-stamped JSON snapshots
          ↓ static Vite build
React map + candidate scenarios + pure financial engine
          ↓ optional browser-side VWorld adapter
```

React UI and optional WebMCP tools call the same small application action surface. The financial engine in `src/model.ts` is deterministic and has no LLM dependency. Missing metrics remain null; available score weights are renormalized rather than silently treating missing data as zero. The primary mobility source is official public-transport data; CCTV vision is an optional micro-footfall refinement, not a prerequisite.

## Local run

```bash
npm install
npm run dev
```

Optional `.env`:

```text
VITE_VWORLD_API_KEY=
VITE_VWORLD_DOMAIN=localhost
```

Without a key the fallback map remains usable. Never put provider secrets into source control or public JSON.

## Refresh / vision commands

Browser crawling/downloading is handled outside this repository by the Codex Aside browser. Git-side code only consumes the resulting official artifact and normalizes it deterministically.

For a crawled official Daegu Metro CSV/ZIP:

```powershell
python scripts/ingest/refresh_daegu_transit.py --input .\path\to\official-daegu-metro.csv --dataset-version 20260731
```

The crawler should commit only the normalized snapshot and its provenance metadata; raw HTML dumps and browser-session artifacts do not belong in the repository. See [`docs/CRAWL_HANDOFF.md`](./docs/CRAWL_HANDOFF.md).

The latest verified catalog entry at implementation time is `20260731` (modified 2026-09-03). The portal's auto-converted XML/JSON API and national public-transit O/D APIs require a data.go.kr service key, so they are not embedded in the static browser build.

`scripts/ingest/refresh_snapshots.py` remains the guarded entry point for the other unimplemented source adapters.

For an authorized local video, see [`vision/README.md`](./vision/README.md). Vision is optional micro-footfall evidence; the output is aggregate counts only and the pipeline does not claim a live CCTV stream at a specific Daegu point.

## Verification

```bash
npm run typecheck
npm test
npm run build
python -m unittest scripts.ingest.test_refresh_daegu_transit
```

The GitHub workflow runs the same checks, Python syntax checks, and `git diff --check`.

## Sites deployment

This is a static Vite site. Follow [`SITES_DEPLOY.md`](./SITES_DEPLOY.md) for the exact source/build-secret boundary. Keep `.env` out of Git, set `VITE_VWORLD_API_KEY` and the exact deployed host as `VITE_VWORLD_DOMAIN`, and preserve Demo geometry when the provider is unavailable.

## Attribution and independent prototype notice

The implementation baseline was adapted from [`sionchu/spacelab-ai`](https://github.com/sionchu/spacelab-ai). Repository-authored source is MIT-licensed; provider data, VWorld, H3-equivalent geometry, RF-DETR, tracker packages, and Supervision remain subject to their own terms. See [`THIRD_PARTY.md`](./THIRD_PARTY.md).

This is an independent competition prototype. It does not represent official iM Bank affiliation, approval, underwriting, or a financial product.
