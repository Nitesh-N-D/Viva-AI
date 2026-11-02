# Testing report

Run on 2026-11-02 on Windows 11 with Node v22.20.0, from the working tree that
was committed with this report. All outputs below are copied from the actual
runs. API keys were read from the local `.env` by the proxies and were never
printed.

## Type check

```
$ npm run typecheck        # tsc -b
(no output, exit code 0)
```

## Unit and integration tests (Vitest 1.6.1, jsdom, fake-indexeddb)

```
$ npx vitest run
 ✓ src/__tests__/i18n.test.ts (4 tests)
 ✓ src/__tests__/fabrication.test.ts (25 tests)
 ✓ src/__tests__/weather.test.ts (3 tests)
 ✓ src/__tests__/inference.test.ts (9 tests)
 ✓ src/__tests__/cropEngine.test.ts (12 tests)
 ✓ src/__tests__/mandi.test.ts (34 tests)
 ✓ src/__tests__/newFeatures.test.ts (28 tests)
 ✓ src/__tests__/syncQueue.test.ts (6 tests)
 ✓ src/__tests__/worker.test.ts (3 tests)
 ✓ src/__tests__/misc.test.ts (7 tests)
 ✓ src/__tests__/community.test.ts (6 tests)
 ✓ src/__tests__/router.test.ts (3 tests)
 ✓ src/__tests__/models.test.ts (18 tests)
 Test Files  13 passed (13)
      Tests  158 passed (158)
```

| File | What it covers |
|---|---|
| models | The **shipped** soil and disease artifacts: metadata status `validated`, label set matches the taxonomy, shard sizes and SHA-256, output width; a real TF.js forward pass; checkArtifact refusal cases |
| newFeatures | Planner task generation, buckets and once-per-day reminders; finance validation, report totals, per-month/crop/category and CSV escaping; irrigation FAO-56 Ra/Hargreaves ET0, Kc, effective rain, drip vs surface; watchlist validation, observation dedupe, alert rules; error classification and recovery; AI proxy request validation (unknown fields such as `apiKey` rejected), key sent only in a header and never returned, no retry on 403, backoff and model fallback on 500/429, blocked/empty answers, rate limit |
| worker | Production Worker: `POST /ai/generate` works for the app origin without leaking the key, foreign origins get 403, GET gets 405, CORS preflight only for allowed origins, unknown paths 404 |
| mandi | Proxy validation, pinned resource, caching, pagination, explorer filtering/sorting, record parsing |
| inference, cropEngine, weather, community, syncQueue, fabrication, i18n, router, misc | As before (see git history of this file) |

## Production build

```
$ npm run build
dist/assets/PlannerScreen-*.js       11.34 kB │ gzip:   4.21 kB   (lazy)
dist/assets/FinanceScreen-*.js       11.57 kB │ gzip:   3.96 kB   (lazy)
dist/assets/IrrigationScreen-*.js    10.39 kB │ gzip:   4.06 kB   (lazy)
dist/assets/WatchlistScreen-*.js     10.46 kB │ gzip:   3.87 kB   (lazy)
dist/assets/AssistantScreen-*.js      8.36 kB │ gzip:   3.45 kB   (lazy)
dist/assets/index-*.js              280.17 kB │ gzip:  98.41 kB   (entry)
dist/assets/firebase-*.js           437.96 kB │ gzip: 102.99 kB
dist/assets/index-*.js            1,915.93 kB │ gzip: 305.92 kB   (TF.js, lazy)
PWA v0.20.5  mode generateSW  precache 48 entries (3006.86 KiB)
```

The build plugin `forbidSecretsInBundle` scans every emitted file for the
data.gov.in and Gemini key values and fails the build if either appears. It
passed.

## Cloud training (Kaggle T4 GPU)

Both notebooks ran on Kaggle; only the small TF.js output was downloaded and
imported. Details and metrics are in `MODEL_EVALUATION_REPORT.md`.

## Live service checks (2026-11-02, ~17:00 IST)

| Check | Result |
|---|---|
| Gemini through `handleAiProxy`, task `assistant`, Tamil | 200, model `gemini-3.5-flash`, Tamil answer with a "பரிந்துரை:" section; key absent from response |
| Gemini, task `assistant`, English | 200 |
| Gemini, task `disease_explain`, English | 200 |
| Mandi through `handleMandiProxy`: Tamil Nadu → Villupuram → Tomato | 1 record, Villupuram (Uzhavar Sandhai), Deshi/Local, min/max/modal ₹3500/quintal, arrival 02/11/2026; key absent from response |
| Mandi: Tamil Nadu → Tomato (all districts) | 67 records |

## Browser smoke test (production build)

`vite preview` on port 4173; each route rendered with headless Chrome
(`--dump-dom`, 390×844, 8 s virtual time). No route hit the error boundary.

| Route | Result |
|---|---|
| `#/` | Dashboard renders |
| `#/soil` | "Model ready", version `soil-mnv2-20261102T062949Z` |
| `#/disease` | "Model ready", version `disease-mnv2-20261102T073346Z`, tomato-only notice |
| `#/planner`, `#/finance`, `#/watchlist` | Empty states with "add" actions |
| `#/irrigation` | Form plus the "FAO-56 estimate, not a sensor reading" disclaimer |
| `#/assistant` | "AI not configured" (expected: this build had no `VITE_MANDI_PROXY_URL`/`VITE_AI_PROXY_URL`) |
| `#/market`, `#/crops`, `#/maker`, `#/settings` | Render normally |
| `#/map` | 53 community scans in 4 areas |

## Not tested

- Real camera capture on a device, and voice input and output (need a device and microphone)
- Firestore rules against the emulator
- Automated accessibility audit
- The production Cloudflare Worker itself (not deployed from this machine; its routing is covered by `worker.test.ts`)
- Field accuracy of the models on real farm photos
