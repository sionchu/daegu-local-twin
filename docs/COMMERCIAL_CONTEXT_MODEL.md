# LocalTwin Daegu — Commercial Context Graph

## 목적

LocalTwin의 다음 단계는 상권을 하나의 점수로 보는 대신 지역, 앵커시설, 이동흐름, 업종, 비용, 정책의 관계망으로 해석하는 것이다.

정량 계산은 결정론적 모델이 담당하고, 지식그래프와 RAG는 계산된 근거를 설명한다. RAG가 매출, 성공확률, 대출승인 가능성을 만들어내지 않는다.

## 연구 기반

### 1. 상권과 거리감쇠

Huff 계열 상권모형은 시설 매력도와 거리를 함께 사용해 공간적 선택 가능성을 표현한다. LocalTwin은 이를 매출예측으로 사용하지 않고 접근 가능한 수요와 경쟁 압력의 상대지표로 사용한다.

참고:
- O'Kelly, Applied retail location models using spatial interaction tools, SAGE Handbook of Spatial Analysis, 2009.
- Li & Liu, Assessing the impact of retail location on store performance, Applied Geography, 2012.
- 손영기·안상현·신영철, GIS 기반의 상권분석 모형 연구 — Huff 확률모형을 중심으로, 2007.
- 황수진·임채근·배재호, AHP 기반의 수정 Huff 모형을 활용한 상권분석, 2014.

### 2. 접근성과 배후수요

Floating catchment와 gravity accessibility의 핵심은 가까운 시설의 영향이 더 크고, 한정된 수요 또는 공급을 여러 시설이 공유한다는 점이다.

참고:
- Luo & Wang, Measures of Spatial Accessibility to Health Care in a GIS Environment, 2003.

### 3. 도시 기능 분류

POI만으로 업무지구, 주거지, 교육지역을 분류하기보다 사람의 유입·유출 시점과 이동 관계를 함께 써야 한다.

참고:
- Yuan, Zheng & Xie, Discovering Regions of Different Functions in a City Using Human Mobility and POIs, KDD 2012.
- Huang et al., Learning Neighborhood Representation from Multi-Modal Multi-Graph, 2021.
- Wu et al., Multi-Graph Fusion Networks for Urban Region Embedding, 2022.

### 4. 직주 관계와 통근

업무지구/베드타운은 고정 라벨보다 직장인구, 거주인구, 유입통근, 유출통근을 이용한 복수 성격 점수로 표현한다.

참고:
- Peng, The Jobs-Housing Balance and Urban Commuting, 1997.
- Ma & Banister, Extended Excess Commuting: A Measure of the Jobs-Housing Imbalance in Seoul, 2006.
- 김형태, 직주균형이 통근통행에 미치는 영향, 2009.

### 5. 앵커 시설

대학과 병원은 고용, 방문, 구매, 서비스 수요를 지속적으로 발생시키는 대표적인 anchor institution이다. 국내 대학캠퍼스 연구에서도 캠퍼스 유치 이후 문화·음식 업종 창업과 근린상권 변화가 관찰됐다.

참고:
- Penn IUR, Anchor Institutions and their Role in Metropolitan Change, 2010.
- Federal Reserve Bank of Philadelphia, Anchor Impact, 2022.
- 지방 중소도시 내 대학캠퍼스 유치가 지역경제에 미치는 영향 — 근린상권 변화를 중심으로, KCI.
- Kang, Spatial access to pedestrians and retail sales in Seoul, 2016.

## 공간 계층

Daegu
- AnalysisZone
  - AdministrativeDong
  - CandidateSite
  - Anchor
  - MobilityFlow
  - BusinessCategory
  - SupportProgram

AnalysisZone은 공식 상권 polygon이 있으면 그것을 우선한다. 공식 경계가 없을 때만 지도 기반 LocalTwin 분석권역을 사용하고 모델 경계임을 명시한다.

## 앵커 분류

| 앵커 | 규모 변수 | 시간 특성 | 주요 수요 |
| --- | --- | --- | --- |
| 초중고 | 학생수, 교직원수 | 등하교, 학기/방학 | 학생, 학부모, 교직원 |
| 대학 | 재학생수, 교직원수, 캠퍼스 규모 | 학기/방학, 주야간 | 청년, 교직원, 방문객 |
| 병원 | 병상수, 종사자수, 의료기관 등급 | 외래, 교대, 24시간 | 종사자, 환자, 보호자 |
| 오피스·공공기관 | 직장인구, 종사자수 | 평일 출퇴근, 점심 | 직장인 |
| 산업단지 | 종사자수, 제조업 밀도 | 교대시간 | 근로자 |
| 지하철·버스 환승 | 승하차, 환승량 | 출퇴근 피크 | 이동객 |
| 전통시장·대형점포 | 점포수, 방문량, 면적 | 시장·주말 패턴 | 쇼핑객 |
| 관광·문화 | 방문인구, 행사 | 주말, 휴일, 행사 | 관광객 |
| 주거단지 | 세대수, 연령구성 | 저녁, 주말 | 생활소비자 |

학교는 수요효과와 규제효과를 분리한다. 교육환경보호구역은 수요점수가 아니라 RESTRICTED_BY 관계로 관리한다.

## 앵커 영향 알고리즘

지역 z, 앵커 a, 업종 c, 시간 t의 영향은 다음 요소로 구성한다.

AnchorInfluence = Capacity × CategoryCompatibility × ScheduleFactor × SegmentMatch × exp(-beta × TravelCost)

- Capacity: 학생, 종사자, 병상, 승하차, 방문자 등. log1p 또는 분위수 정규화.
- CategoryCompatibility: 앵커 종류와 업종의 적합도 행렬.
- ScheduleFactor: 평일/주말, 학기/방학, 교대, 영업시간.
- SegmentMatch: 앵커 이용자와 업종 목표고객의 일치도.
- TravelCost: 네트워크 보행시간 우선. 없으면 직선거리 fallback.
- beta: 업종별 거리감쇠. 편의점·테이크아웃은 감쇠가 크고 목적형 업종은 작다.

여러 앵커의 합은 무한히 커지지 않도록 포화함수를 사용한다.

AnchorDemandIndex = 100 × (1 - exp(-sum(AnchorInfluence)))

이 값은 매출이나 성공확률이 아니다.

## 경쟁과 집적

같은 업종이 많다고 무조건 나쁜 것이 아니다.

CompetitivePressure = 동일 업종의 매력도 × 거리감쇠의 합

Complementarity = 연관 업종 호환도 × 주변 밀도 × 거리감쇠의 합

UI에는 경쟁강도와 연관업종 집적을 별도 항목으로 표시한다.

## 지역 성격 점수

단일 라벨 대신 복수 점수를 유지한다.

- 업무지구성
- 주거생활권성
- 대학가성
- 산업근로형
- 관광방문형
- 환승거점형
- 전통시장형
- 혼합상권성

예시 기본식:

업무지구성
- 직장인구밀도 30%
- 유입통근 25%
- 평일 교통수요 15%
- 오피스·공공기관 앵커 15%
- 주간 대비 야간 활동성 15%

주거생활권성
- 거주인구밀도 30%
- 유출통근 20%
- 세대·주택 기반 20%
- 저녁·주말 활동성 15%
- 주거용도 비중 15%

가중치는 관측 결과로 보정되기 전까지 모델 가정으로 표시한다.

## 업종 적합도

CategoryFit = ProfileCompatibility + AnchorDemand + TransitAccessibility + Complementarity - CompetitionPressure - RentBurden - RegulatoryConstraint

출력은 성공확률이 아니라 검토용 적합도다.

예:
테이크아웃 커피 적합도 78
- 직장인 유입 강함
- 지하철 접근성 높음
- 병원·오피스 앵커 존재
- 동일업종 경쟁 높음
- 참고 임대료 상위권

## 온톨로지 노드

- Region
- AnalysisZone
- CandidateSite
- AdministrativeDong
- Anchor
- School
- University
- Hospital
- EmployerCluster
- IndustrialCluster
- TransitHub
- Market
- TourismAnchor
- ResidentialCluster
- MobilityFlow
- DemandSegment
- BusinessCategory
- RentEvidence
- SupportProgram
- Regulation
- SourceRecord

## 관계

- LOCATED_IN
- NEAR
- CONNECTED_TO
- ATTRACTS
- SERVES_SEGMENT
- COMMUTES_TO
- COMMUTES_FROM
- COMPETES_WITH
- COMPLEMENTS
- SUPPORTED_BY
- RESTRICTED_BY
- EVIDENCED_BY
- SUITABLE_FOR

모든 파생 관계는 value, unit, source_id, source_date, quality, method, limitations를 가진다.

## Graph-RAG

질의 흐름:

사용자 질문 → 선택 권역/업종 해석 → 1~2 hop subgraph 검색 → EVIDENCED_BY 문서 검색 → 설명 생성

RAG가 답하기 적합한 질문:
- 왜 이 지역이 업무지구 성격인가
- 학교 영향이 어떤 업종에 연결되는가
- 카페 후보에 긍정/부정 요인이 무엇인가
- A/B 후보의 구조적 차이가 무엇인가
- 어떤 지원사업과 연결되는가

RAG만으로 만들면 안 되는 것:
- 매출예측
- 대출승인 예측
- 창업 성공확률
- 상관관계를 인과로 표현
- 결측 데이터 생성

## 대구 데이터 우선순위

공개 배포 가능:
- 공공데이터포털: 상가정보, 교통, 임대·공실, 학교/대학, 교육환경보호구역
- SGIS/국가통계: 거주·직장인구, 사업체·종사자
- NAVER DataLab: 검색관심 상대지수
- VWorld / OpenStreetMap: 공간 맥락

D-데이터허브 / DIP 후보:
- 카드 거래
- 통신사 관광지 방문인구
- 통신사 생활인구
- 유동인구
- EDS 학교 공시
- 사회경제지표 및 OD
- 대구 버스·도시철도·택시
- 병원·약국
- 대규모점포·먹거리골목·시장·주차장
- 대구로 배달 거래
- 대구 소재 기업 데이터
- PA 목적 OD / 주수단 OD

센터 내 제한 데이터는 원시자료를 저장소나 공개 서비스에 반출하지 않는다. 승인된 집계 결과만 provenance와 함께 사용한다.

## UI 계약

기본:
- 권역 면은 낮은 투명도
- 테두리는 읽히되 겹치는 면이 과도하게 섞이지 않음
- 라벨은 polygon 내부 대표점 사용
- 후보점은 보조 정보

Hover:
- 해당 권역 면 밝기 상승
- 테두리 두께 및 glow 강화
- 라벨이 이름 + 현재 지표 점수로 확장
- 다른 권역 감쇠
- pointer cursor

Click:
- 후보 선택
- 카메라 포커스
- 우측 패널 갱신
- 입지 관계도 1회 재생

## 구현 순서

P0
- 헤더/탭 여백
- polygon 내부 대표점 라벨
- hover 강조 및 다른 권역 감쇠
- 후보점 라벨 제거

P1 — 현재 구현된 기반
- SGIS 2025Q2 공식 행정동 150개를 대구 전역 canonical 분석단위로 사용
- SEMAS 2026Q2 대구 영업중 업소 118,357개를 공식 행정동에 100% spatial join
- HIRA 2026.6 병·의원·약국 5,649개 공식 좌표 반영
- 대구교육청 학교대장 482개 중 330개를 공개지도 좌표와 보수적으로 연결
- 대구 제조업체 공장대장 11,744개와 구·군 주민등록인구 공식요약 반영
- 교육·의료·업무·산업·교통·시장·문화관광·주차 8축 거리감쇠 지표
- 상업밀도·업종다양성 2축 공식 SEMAS 상권구조 레이어
- SEMAS 점포밀도·다양성 + 교통·시장·업무·문화·의료 접근성을 결합한 전역 상권잠재 후보 레이어
  - 기존 중앙도심 5개 정밀 corridor 유지
  - SGIS 행정동 후보는 최소 점수·최소 점포수·중앙상권 중복 제한·구별 최대 2개·후보간 최소거리 규칙 적용
  - 후보 행정동은 공식 상권 경계가 아니며 매출·유동인구·성공확률로 해석하지 않음
- `NEAR` + `HAS_BUSINESS_PROFILE` evidence graph 생성

P1 — 아직 필요한 데이터
- 동/격자 수준 직장인구·종사자
- 동/격자 수준 거주·생활인구
- 출퇴근/목적 OD
- 공식 주차장 전역 좌표·주차면수
- 학교 학생수·대학 재학생/교직원 capacity 보강

P2
- 허용 가능한 생활인구·카드·방문인구·OD 집계 결과로 가중치 보정
- 위 데이터가 확보될 때 업무지구성·주거생활권성·통근형 분류를 활성화

P3
- 그래프 검색과 RAG 설명
- Neo4j나 벡터DB는 실제 규모가 필요할 때만 도입

## 증거 규칙

항상 구분한다:
- 관측·공식
- 공개 snapshot
- 파생지표
- 사용자 입력
- 모델 가정

온톨로지나 RAG를 붙여도 원 데이터의 증거 수준은 올라가지 않는다.
