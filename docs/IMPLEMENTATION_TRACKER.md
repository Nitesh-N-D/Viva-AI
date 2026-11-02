# Implementation tracker

Statuses: **COMPLETED AND VERIFIED** means implemented and checked by tests,
a build or a live check. **BLOCKED BY EXTERNAL DEPENDENCY** means the code is
ready but something outside the repo is needed. **NOT COMPLETED** means the
item has not been done. Last updated 2026-11-02.

| # | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 1 | Full repository audit | COMPLETED AND VERIFIED | `AUDIT_REPORT.md` |
| 2 | UI/UX redesign (shell, navigation, cards, dialogs, toasts, error boundary, lazy screens) | COMPLETED AND VERIFIED | `src/app/AppShell.tsx`, `src/shared/ui/*`. All 13 routes render in headless Chrome against the production build (`TESTING_REPORT.md`). |
| 3 | Real soil inference, metadata-gated, no fake predictions | COMPLETED AND VERIFIED | `src/lib/inference/*`, `models.test.ts` checks the shipped artifact (integrity, labels, real forward pass). The soil screen shows "model ready" with `soil-mnv2-20261102T062949Z`. |
| 4 | Real disease inference | COMPLETED AND VERIFIED | Same as #3; `disease-mnv2-20261102T073346Z`, 10 tomato classes with bilingual guidance. |
| 5 | Trained soil and disease models | COMPLETED AND VERIFIED | Trained on Kaggle T4 GPU only (kernels `niteshnd/viva-ai-soil-classifier` v4, `niteshnd/viva-ai-disease-classifier` v4). Test accuracy 0.807 (soil) and 0.927 (disease). See `MODEL_EVALUATION_REPORT.md`. Nothing was trained locally. |
| 6 | Cloud training notebooks (Kaggle/Colab GPU only) | COMPLETED AND VERIFIED | Both ran end to end on Kaggle; `npm run train:cloud` pushes, polls, downloads only the small TF.js output, then imports it. |
| 7 | Model import, validation, atomic swap, rollback | COMPLETED AND VERIFIED | `scripts/import-model.ts`, `src/lib/inference/artifact.ts`. Both models went through it; previous artifacts kept in the ignored `models-rollback/`. |
| 8 | Explainable crop engine (not ML) | COMPLETED AND VERIFIED | `cropEngine.ts`, 12 tests |
| 9 | Leaflet map with ratings in marker popups | COMPLETED AND VERIFIED | `SoilMap.tsx`, `community.test.ts`. Production build shows 53 community scans in 4 areas. |
| 10 | Secure Firestore persistence | COMPLETED AND VERIFIED (compiles) | `firestore.rules`. No emulator rule tests yet (#20). |
| 11 | Deploy Firestore rules | See `DEPLOYMENT_GUIDE.md` and the final report | `firebase deploy --only firestore:rules` |
| 12 | Server-side aggregation | BLOCKED BY EXTERNAL DEPENDENCY | Cloud Functions need the Blaze plan. Aggregation is done on read from rule-validated documents. |
| 13 | Mandi Price Explorer | COMPLETED AND VERIFIED | `MandiPrices.tsx`, `mandi.ts`; live check 2026-11-02 17:00 IST: Tamil Nadu → Villupuram → Tomato returned a real record (Villupuram Uzhavar Sandhai, modal ₹3500/quintal, arrival 02/11/2026). |
| 13a | Server-side mandi key proxy | COMPLETED AND VERIFIED (code + local) / BLOCKED (production Worker deploy) | `src/server/mandiProxy.ts`, `server/mandi-worker`. Production needs the owner's Cloudflare login (`wrangler deploy`) and the `VITE_MANDI_PROXY_URL` secret. |
| 13b | No data.gov.in key in the browser bundle | COMPLETED AND VERIFIED | Build fails if the key value is in `dist/`. |
| 14 | Weather with source and freshness | COMPLETED AND VERIFIED | `weather.ts`, 3 tests. |
| 15 | Parametric technical drawings, SVG/PNG/PDF export | COMPLETED AND VERIFIED | 25 fabrication tests. |
| 16 | Offline sync with idempotency | COMPLETED AND VERIFIED | `SyncQueue.ts`, 6 tests |
| 17 | Tamil and English, voice, accessibility | COMPLETED AND VERIFIED (keys) | `i18n.test.ts` checks key parity for all new screens too. No automated a11y audit (#21). |
| 18 | CI (test and build on push/PR) | COMPLETED | `.github/workflows/ci.yml` |
| 19 | CD (Firebase Hosting) only when credentials exist | COMPLETED | Merge workflow deploys only when `FIREBASE_SERVICE_ACCOUNT_VIVA_AI_2CC88` exists. |
| 20 | Firestore rules unit tests (emulator) | NOT COMPLETED | Needs `@firebase/rules-unit-testing` and the Java emulator |
| 21 | Automated accessibility audit (axe/Lighthouse) | NOT COMPLETED | |
| 22 | Documentation set | COMPLETED | README, AUDIT, TRACKER, TESTING, MODEL_EVALUATION, DEPLOYMENT, KNOWN_LIMITATIONS, `.env.example` |

## New features (2026-11-02)

| # | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 23 | Secure server-side Gemini proxy (strict request validation, key in header only, retries with backoff, model fallback, no retry on 400/401/403/blocked, rate limit) | COMPLETED AND VERIFIED (code + local live) / BLOCKED (production Worker deploy) | `src/server/aiProxy.ts`, route `POST /ai/generate` on the Worker and `/api-ai/generate` on the dev/preview server. Live Tamil and English answers from `gemini-3.5-flash` on 2026-11-02; no key in responses or bundle. Production needs `wrangler secret put GEMINI_API_KEY` + Worker deploy. |
| 24 | App-wide error handling (classification, bilingual messages, recovery actions) | COMPLETED AND VERIFIED | `src/lib/errors.ts`, `ErrorNotice.tsx`, route error boundaries; tests in `newFeatures.test.ts`. |
| 25 | Smart Farm Planner / crop calendar with reminders | COMPLETED AND VERIFIED | `src/modules/planner`; tasks generated from crop durations, stored in IndexedDB, in-app due reminders. |
| 26 | Farm expense / income / profit tracker (INR, CSV, charts, reports) | COMPLETED AND VERIFIED | `src/modules/finance`; report totals, per-month/crop/category, CSV export tested. |
| 27 | Smart Irrigation Advisor | COMPLETED AND VERIFIED | `src/modules/irrigation`; FAO-56 Hargreaves ET0 × Kc minus effective rain, labelled as an estimate; no sensor data claimed. |
| 28 | Gemini farming assistant (ta/en, voice) | COMPLETED AND VERIFIED (local) / BLOCKED (production, see #23) | `src/modules/assistant`; production build shows "AI not configured" until the Worker is deployed. |
| 29 | Mandi price watchlist and in-app alerts | COMPLETED AND VERIFIED | `src/modules/watchlist`; alerts only from prices the app actually fetched (no invented history, no background push). |
