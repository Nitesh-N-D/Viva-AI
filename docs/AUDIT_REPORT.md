# Audit report

Baseline: commit `27c6a2b` on `main`. Audit and remediation were carried out
from 2026-10-31 to 2026-11-01. Every finding below was checked against the
code or a live service, and the evidence is listed with it.

## Critical findings

| # | Area | Finding (baseline) | Evidence | Resolution |
|---|---|---|---|---|
| C1 | ML honesty | `src/lib/mockModel.ts` returned a fabricated label and confidence whenever no model loaded, and the UI could display it as a result. | `git show 27c6a2b:src/lib/mockModel.ts` | Deleted. The new `src/lib/inference/` loads a model only when `metadata.json` is `validated` and carries metrics and provenance. Otherwise the app shows "MODEL AWAITING CLOUD TRAINING". |
| C2 | ML artifacts | `public/models/{soil,disease}_model` held weights with no dataset, class order, preprocessing or metrics on record. The two tasks shared byte-identical backbone shards. | sha256 comparison of the shards | The files are kept but unused, because no metadata exists. The READMEs explain why. |
| C3 | Firestore | `mapTiles` accepted client-written aggregates. Any signed-in user could set any `scanCount` or `dominantSoilType`. | `git show 27c6a2b:firestore.rules` | `mapTiles` is closed. Scans are write-once and schema-checked. Aggregates are computed from the documents on read (`aggregateScans`, `aggregateRatings`). |
| C4 | XSS | The fabrication sketch was rendered with `dangerouslySetInnerHTML` from a string built from user-influenced input. | `SketchView.tsx:48` at baseline | Replaced with a typed SVG node tree. React renders it, and serialisation escapes everything (`engine/svg.ts`, `escapeXml`). |
| C5 | Data honesty | Weather and mandi prices fell back to hard-coded mock data. Some of it was in Tamil, presented like real markets. | `mandi.ts` (`MOCK_PRICES`) and `weather.ts` (`mockSnapshot`) at baseline | Mock data was removed. The source is `live`, `cached` (with its age) or `unavailable`, and the UI shows which. |
| C6 | Build | A stale compiled `vite.config.js` was tracked and could shadow `vite.config.ts`, and `tsc -b` re-emitted it. | `git diff` of the two files | Emit was redirected to `node_modules/.tmp`. The file and the tsbuildinfo files were untracked and git-ignored. |

## High findings

| # | Area | Finding | Resolution |
|---|---|---|---|
| H1 | Secrets | A Gemini API key was intended to ship in the browser bundle (`VITE_GEMINI_API_KEY`). | The browser-side LLM path was removed; fabrication intent extraction stays rule-based and tested. Gemini is now called only through a server-side proxy (`src/server/aiProxy.ts`, Worker route `/ai/generate`) holding `GEMINI_API_KEY`; the build fails if the key value is in `dist/`. |
| H2 | Offline sync | The IndexedDB queue had no idempotency, so a retry after a timeout could create duplicates. | Each item is keyed by an idempotency key used as the Firestore doc id. Rules allow only identical retries. Backoff applies. |
| H3 | CI/CD | Deploy workflows ran no tests and failed when the service-account secret was missing. | Added a `ci.yml` (test and build). Deploy runs only when the secret exists, and otherwise prints a warning. |
| H4 | Intent extraction | Variable shadowing and rule ordering assigned quantities to the wrong dimension. Phrase boundaries were ignored. | Fixed, with regression tests (`fabrication.test.ts`). |
| H5 | Bundle | TF.js (~1.9 MB) loaded in the main chunk. | It now loads through dynamic `import()` only when a validated model exists. The main chunk is about 244 KB. Firebase is split into its own chunk. |

## Medium and low findings

- i18n: hard-coded English strings and missing Tamil keys. Every key now exists in both files (enforced by `i18n.test.ts`).
- Crop recommendation was presented as "AI". It is a deterministic rule engine and is labelled that way, with per-check results.
- Accessibility: icon-only tiles had no labels. Components now use semantic buttons, labels, focus rings and `aria-live` toasts.
- Data.gov.in key was in the bundle. Mandi calls now go through the server-side proxy (`src/server/mandiProxy.ts`).

## Not changed (out of scope or blocked)

- Cloud Functions (true server-side aggregation and moderation) need the Blaze plan. Read-side aggregation plus strict rules is used instead.
- Model training: completed on Kaggle GPU on 2026-11-02. See `MODEL_EVALUATION_REPORT.md`.

## Second audit pass (2026-11-02)

| Finding | Fix |
|---|---|
| `tsc -b` failed (TS6307): `src/server/aiProxy.ts` was imported by `vite.config.ts` but missing from `tsconfig.node.json`. | Added to the node project's `include`. |
| A model test assumed labels are alphabetical; the disease model's output order is not. Inference already indexes by `metadata.labels`. | The test now compares the label set. |
| With `VITE_AI_PROXY_URL` set, the client called `<url>/generate`, but the Worker serves only `/ai/generate`, so AI would 404 in production. | Client appends `/ai/generate` to either base URL; `worker.test.ts` covers the Worker routes. |
| The five new modules had no unit tests. | `newFeatures.test.ts` (28 tests). |