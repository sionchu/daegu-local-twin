# SpaceLab Competition Baseline Acceptance

Date: 2026-09-18 (Asia/Seoul)

Target: `https://spacelab-ai.leeje92.chatgpt.site`

Scope: production acceptance only. No product feature, architecture, UI, or WebMCP implementation changes were made for this run.

## Gate 1 — unauthenticated production access

Status: `BLOCKED`

Observed evidence:

- Sites returned `access_mode: custom`, `status: active`, `current_user_role: owner`, and `latest_version_number: 5` for the target project.
- A fresh Codex In-app Browser tab with no existing Site login session opened the production URL.
- The browser title was `로그인 필요`.
- The visible page showed `거의 다 됐습니다`, `이 사이트는 ChatGPT를 사용해 안전하게 로그인합니다`, and a `ChatGPT로 계속` link.
- The SpaceLab application DOM was not reachable in that unauthenticated session.

Result: the Site is not publicly reachable by a non-logged-in browser under the current access policy.

## Gate 2 — production VWorld and scenario visual acceptance

Status: `NOT RUN`

The production application did not load in the unauthenticated browser, so there is no production observation to support `VWorld Live`, A/B mass geometry, solar shadow, or Compare delta. Local preview evidence is not substituted for production evidence.

## Gate 3 — ChatGPT Site Tools canonical-state acceptance

Status: `NOT RUN`

The following production calls were not issued because Gate 1 did not reach the application surface:

- `get_spatial_workspace`
- `edit_building_mass`
- `compare_scenarios`

No Site Tools result is claimed for this run.

## Tag decision

The acceptance gates did not all pass. The tag `v1.0-competition-baseline` was not created.

## Required next checkpoint

The Site owner must decide whether to change the Sites access policy to a public audience. After that policy change, rerun this exact three-gate sequence without changing product code or adding features.
