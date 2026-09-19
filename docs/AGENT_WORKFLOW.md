# Agent workflow

GitHub is the single source of truth for LocalTwin Daegu. Chat sessions, browser
sessions, and local agent scratchpads are disposable; durable project decisions belong
in issues, code, tests, normalized data, and pull requests.

## Roles

### Codex Aside / browser-data agent
Owns browser-only acquisition:
- official pages that require clicking, JavaScript, downloads, or login;
- official CSV/ZIP/API-response collection;
- source URL, dataset version/date, retrieved-at timestamp, and source SHA256;
- running repository normalizers where practical;
- opening a **data-only PR**.

It must not edit product UI unless the issue explicitly requires it.

### Codex coding agent
Owns one narrow implementation issue:
- frontend/map/charts, model, adapter, or QA;
- works in a dedicated branch;
- writes/updates tests with the implementation;
- opens a PR and stops at the PR boundary unless the task explicitly includes merge.

### QA agent
Owns verification, not feature expansion:
- inspect PR diff;
- run unit/build/browser checks;
- reproduce failures;
- keep fixes to the smallest coherent scope;
- attach evidence through GitHub Actions artifacts when useful.

### Git-side integrator
Owns:
- provenance/schema review;
- deterministic model integration;
- PR review and merge;
- derived cell-level calculations;
- release/deployment verification.

## Branch ownership

Use one branch per issue. Prefer:

```text
data/transit-official
data/semas-businesses
data/rent-benchmark
data/regeneration
data/buzz
feat/<narrow-feature>
test/<verification-scope>
fix/<bug>
```

Avoid concurrent edits to the same canonical output file. Data agents should own their
source-specific snapshot only; derived `opportunity_cells.json` integration happens in
a later Git-side integration PR.

## Data PR contract

A data PR should normally contain only:

```text
public/data/<source>.json
scripts/ingest/<source-adapter>.py   # only when needed
adapter tests                         # when needed
public/data/provenance.json           # narrowly scoped source update
```

Every normalized snapshot must preserve:
- source URL;
- source provider/dataset ID;
- source period/version;
- retrieval timestamp;
- SHA256 for downloaded source files when practical;
- `observed` / `official` / `modelled` / `demo` semantics;
- limitations.

Never silently fill missing records.

## Do not commit

- browser profiles, cookies, tokens, API secrets;
- CAPTCHA artifacts;
- raw HTML/browser recordings unless specifically required for an audit;
- unrelated downloads;
- large raw source files when a normalized snapshot plus hash is sufficient;
- invented fallback data presented as official.

## PR verification gate

Every implementation PR should pass the checks applicable to its scope:

```bash
npm run typecheck
npm test
npm run build
npm run e2e
python -m unittest scripts.ingest.test_refresh_daegu_transit
python -m py_compile vision/analyze_footfall.py scripts/ingest/refresh_daegu_transit.py
git diff --check
```

GitHub Actions is the canonical execution evidence. Browser failures should retain
Playwright screenshot/trace/video/report artifacts.

## Integration order for real data

Current preferred order:

1. DATA-01 official Daegu Metro hourly ridership
2. DATA-02 SEMAS businesses / POIs
3. DATA-03 REB rent / vacancy benchmark
4. DATA-04 urban regeneration / decline indicators
5. DATA-05 Naver relative-interest snapshot
6. optional LOCALDATA opening/closure churn
7. support-program refresh

After a source PR lands, create a separate integration PR to derive cell-level features,
update evidence quality, rerun the deterministic opportunity model, and refresh UI
labels/charts.

## Handoff format

Agents should finish with a Git artifact, not a chat-only result.

Preferred handoff:

```text
Issue: #N
Branch: <branch>
PR: #N
Source/version: ...
Files changed: ...
Checks: ...
Known limitations: ...
```

A human or the Git-side integrator can then continue from the PR without needing the
original agent conversation.
