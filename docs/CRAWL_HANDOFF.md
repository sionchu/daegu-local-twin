# Crawl handoff contract

Network/browser crawling is intentionally separated from Git-side product work.

## Responsibility split

### Codex Aside browser
Use the browser for:
- official pages that require clicking, JavaScript, download controls, CAPTCHA/user interaction, or login;
- downloading official CSV/ZIP files;
- recording source URL, dataset version, retrieval time, and source-file SHA256;
- running the repository's local normalizer when practical;
- committing the normalized artifact to the repository.

Do not scrape Instagram or bypass access controls.

### Git-side LocalTwin work
Use GitHub for:
- reviewing committed crawl output;
- validating provenance and schema;
- transforming official source snapshots into cell-level model inputs;
- updating deterministic opportunity/financial calculations;
- tests, PR review, merge, and deployment verification.

## Daegu Metro handoff

Official catalog:

- Dataset ID: `15002503`
- Provider: 대구교통공사
- Source: https://www.data.go.kr/data/15002503/fileData.do?recommendDataYn=Y

The crawler should obtain the official file and run:

```powershell
python scripts/ingest/refresh_daegu_transit.py \
  --input <downloaded-official-csv-or-zip> \
  --dataset-version <YYYYMMDD> \
  --source-sha256 <SHA256> \
  --retrieved-at <ISO-8601> \
  --output public/data/transit.json
```

Then commit **only** the normalized `public/data/transit.json` unless the raw source is specifically needed for audit.

The committed file must contain:
- `mode: "official-snapshot"`
- provider/dataset ID/version/source URL
- retrieval timestamp
- source SHA256 when available
- station numbers
- days observed
- average daily boarding + alighting totals
- average daily 10:00–22:00 demand
- explicit limitations

Target stations for the current corridor:
- 중앙로역
- 반월당역
- 서문시장역
- 대구역

## Do not commit

- browser profiles/cookies;
- credentials or API keys;
- CAPTCHA artifacts;
- raw HTML dumps;
- full browser recordings;
- unrelated downloaded files;
- large raw source files when the normalized snapshot is sufficient.

## Commit convention

Use a commit message similar to:

`data: refresh official Daegu transit snapshot`

After that commit lands, the Git-side step will:
1. inspect the snapshot and provenance;
2. calculate station-to-cell distance-decay mobility demand;
3. replace demo transit/cell mobility values;
4. update evidence quality;
5. run regression tests and build;
6. deploy and smoke-test the public site.
