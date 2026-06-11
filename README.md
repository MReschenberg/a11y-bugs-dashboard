# A11y Bugs Dashboard

Living dashboard of Firefox accessibility bugs (`access` keyword) from Bugzilla.
Build-time ingestion → static JSON → static site on GitHub Pages. Planning docs
(PRD, P0 implementation plan, Step 0 audit) live in Obsidian, not here.

## Develop

```sh
npm install
npm test          # unit tests (classify / aggregate / snapshot)
npm run ingest    # fetch BMO → public/data/*.json  (public bugs only without a key)
npm run dev       # Vite dev server (front-end views are WIP)
npm run build     # static build → dist/
```

Requires Node 18+ (developed on 24).

## Bugzilla API key (optional locally, required in CI for restricted bugs)

Without a key, ingestion sees only **public** `access` bugs. With a read-only key it
also includes **security-restricted** bugs — but the published output stays
**aggregate-only** (no bug IDs; provenance is query-links only). See plan R15.

1. Generate a key: <https://bugzilla.mozilla.org/userprefs.cgi?tab=apikey>
2. Locally: `cp .env.example .env` and paste the key after `BUGZILLA_API_KEY=`
   (`.env` is gitignored).
3. In CI: add a repo secret named `BUGZILLA_API_KEY` (Settings → Secrets and
   variables → Actions). The deploy workflow passes it to the ingest step.

## Layout

- `ingest/` — Node+TS pipeline (`run.ts` orchestrates) and the one-off Step 0
  scripts (`audit.ts`, `reopen-analysis.ts`, `sensitivity.ts`).
- `public/data/` — generated, committed JSON: `current.json` (live week),
  `snapshots/` (frozen ISO weeks), `rollups.json` (monthly/yearly events),
  `aging.json`, `meta.json`.
- `src/` — front-end (Observable Plot + tables); built next.

## Data model

Two grains (see plan §4.2/§4.6): **WeeklySnapshot** = point-in-time backlog state
(frozen per ISO week); **EventRollup** = filed/fixed events (reconstructable from
timestamps). Severity is normalized to S1–S4 (legacy mapped; `major→S3` validated).
Time-to-close uses latest resolution (~7% reopen). Graveyard products excluded;
a11y-engine bugs shown as a flagged series.
