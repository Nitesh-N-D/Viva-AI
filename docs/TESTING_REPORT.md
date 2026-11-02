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
$ npx vitest run            # 2026-11-02 ~22:05 IST
 ✓ src/__tests__/weather.test.ts  (3 tests)
 ✓ src/__tests__/cropEngine.test.ts  (12 tests)
 ✓ src/__tests__/syncQueue.test.ts  (6 tests)
 ✓ src/__tests__/inference.test.ts  (9 tests)
 ✓ src/__tests__/fabrication.test.ts  (25 tests)
 ✓ src/__tests__/notify.test.ts  (7 tests)
 ✓ src/__tests__/newFeatures.test.ts  (30 tests)
 ✓ src/__tests__/mandi.test.ts  (34 tests)
 ✓ src/__tests__/community.test.ts  (6 tests)
 ✓ src/__tests__/worker.test.ts  (3 tests)
 ✓ src/__tests__/misc.test.ts  (7 tests)
 ✓ src/__tests__/router.test.ts  (3 tests)
 ✓ src/__tests__/i18n.test.ts  (4 tests)
 ✓ src/__tests__/models.test.ts  (18 tests)
 Test Files  14 passed (14)
      Tests  167 passed (167)
```

`notify` covers background checks: once-per-day reminder marking (and re-reminding on a later day), notification templates that keep their `{count}` placeholder for the service worker, and honest support states (`unsupported`, `needs_permission`, `needs_install` when Periodic Background Sync is not granted, `enabled` with a 12 h interval). `newFeatures` now also covers the AI proxy's next-model fallback on an upstream 400 and the removal of echoed or invented `<app_data>` blocks from answers.

## End-to-end tests (Playwright 1.49.1, installed Microsoft Edge)

`npm run e2e` builds to `dist-e2e` with `VITE_MANDI_PROXY_URL=https://mock-worker.invalid`, serves it with `vite preview` on port 4174, and runs `e2e/smoke.spec.ts` at desktop and 360×740 mobile sizes. All other network is blocked, and speech synthesis is replaced with a deterministic fake, so the tests never call the real Worker, Gemini or data.gov.in.

```
$ npx playwright test
  ✓ [desktop|mobile] every route renders without uncaught errors or raw {placeholders}
  ✓ [desktop|mobile] Soil Scan and Disease Scan are separate navigation items (mobile: no horizontal scroll)
  ✓ [desktop|mobile] language toggle switches to Tamil and is remembered
  ✓ [desktop|mobile] read-aloud starts, pauses, resumes and stops
  ✓ [desktop|mobile] assistant shows an honest error when the AI service fails
  ✓ [desktop|mobile] assistant shows the answer from the Worker and sends the question and history
  12 passed (29.4s)
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
PWA v0.20.5  mode injectManifest  precache 47 entries (3132.86 KiB)   # custom src/sw.ts, ~41 KB
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

## Production Worker checks (2026-11-02, ~21:45 IST)

Against `https://viva-ai-mandi-proxy.nitesh-viva-ai.workers.dev` with the origin header set to the production site. `npx wrangler@4 whoami` confirmed a valid login; `wrangler secret list` shows `AGMARKNET_API_KEY` and `GEMINI_API_KEY` (values never read or printed). The live deployment is version `0eb90ff9`, created 2026-11-02 12:05 UTC.

| Check | Result |
|---|---|
| `POST /ai/generate` from `https://evil.example` | 403 `origin not allowed` |
| AI, English, "What fertilizer is suitable for paddy?" | 200, `gemini-3.5-flash`, 6.7 s; advises a soil test, invents no doses |
| AI, English follow-up with history ("And during heavy rain?") | 200, 8.8 s, uses the earlier turn |
| AI, empty question | 400 `question is required` |
| AI, Tamil (yellow tomato leaves, paddy fertiliser, irrigation in rain) | 200 with Tamil answers. One first attempt returned 400 "rejected by the AI service" and succeeded on a retry; the proxy now falls back to the next model on a 400 (needs a Worker redeploy to take effect) |
| AI, English, "today's tomato price in Villupuram mandi?" | 200; says it does not have today's price (no invented number) |
| AI answer quality | Two answers echoed `<app_data>` tags, and one invented a "model prediction / confidence" block. The proxy now strips `<app_data>` from answers and the prompt forbids it (needs a Worker redeploy) |
| `GET /prices` Tamil Nadu → Villupuram → Tomato (also market Gingee) | **502** `upstream_error` (upstream status 521/523) or `upstream_timeout`, repeatedly, within 0.4–1.4 s |
| Same data.gov.in query directly from this machine (India), with the key | Gingee: 200 in 0.7 s, 1 real record (Gingee Uzhavar Sandhai, Deshi/Local, ₹3800/quintal, 02/11/2026). Villupuram district: timed out at 60 s. Tamil Nadu → Tomato: 200 in 38 s with 0 records (upstream mid-refresh) |
| Production bundle | `VITE_MANDI_PROXY_URL` is built in: the Worker URL appears in the `mandiPlaces` and `AiExplain` chunks |

Conclusion: data.gov.in is reachable from India but Cloudflare's network gets 521/523 from it, so production mandi prices currently show "The price service returned an error." (no fake or cached-as-live data). See `KNOWN_LIMITATIONS.md` for options.

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

- Real camera capture on a device, and real voice input and output (need a device and microphone; e2e uses a fake speech engine)
- Background notifications on a real installed PWA (Periodic Background Sync timing is controlled by the browser and cannot be forced in a test)
- Firestore rules against the emulator
- Automated accessibility audit (axe/Lighthouse)
- The AI proxy changes on the production Worker (they are not redeployed yet)
- Field accuracy of the models on real farm photos
