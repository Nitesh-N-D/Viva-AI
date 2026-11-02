# VIVA AI

A Tamil-first, offline-first PWA for small farmers, with a frugal-fabrication
assistant. It runs entirely on free tiers: React on Firebase Hosting, Firestore
on the Spark plan, and on-device TensorFlow.js. The only server code is a small free-tier Cloudflare Worker that keeps the data.gov.in and Gemini keys off the browser.

**Live:** https://viva-ai-2cc88.web.app

[![CI](https://github.com/Nitesh-N-D/Viva-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Nitesh-N-D/Viva-AI/actions/workflows/ci.yml)

## What works today

| Feature | Status | Notes |
|---|---|---|
| Soil photo classification | Working | MobileNetV2 trained on Kaggle GPU, test accuracy 0.81 (83 images; alluvial is weak). Gated by `metadata.json`; shown as a "model score", not a probability. |
| Tomato leaf condition scan | Working | MobileNetV2 trained on Kaggle GPU, test accuracy 0.93 on lab photos (field accuracy unmeasured). Bilingual guidance for all 10 classes. |
| Crop suggestions | Working | An explainable, deterministic rule engine over soil, season, water, pH and duration, **not ML**. Each score is broken into per-check results, and the 5-day rain forecast only raises timing risks. |
| Weather | Working with `VITE_OPENWEATHER_API_KEY` | Shows the source (live/cached) and its age. With no key it says so. There is no mock data. |
| Mandi prices | Working locally; **production blocked upstream** | data.gov.in Agmarknet daily prices (state → district → market → commodity). The key stays on the server. Arrival date and source are shown; there is no mock data. On 2026-11-02 data.gov.in refused connections from the Cloudflare Worker (521/523), so production shows "price service returned an error". See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). |
| Farm planner | Working | Crop calendar generated from sowing date and crop duration. Reminders appear in the app and as system notifications, plus background checks on installed Chromium PWAs (Periodic Background Sync). Stored on the device. |
| Expense / income tracker | Working | INR entries per crop, profit reports, charts and CSV export. Stored on the device. |
| Irrigation advisor | Working | FAO-56 Hargreaves estimate from weather and crop stage, clearly labelled as an estimate (no sensors). |
| Farming assistant | Working in production | Gemini, Tamil or English, with conversation history and voice input. Called only through the Worker's `/ai/generate` (verified live 2026-11-02). |
| Mandi watchlist | Working (needs mandi data) | Saved commodity/market pairs with price alerts based on prices actually fetched, in the app and in background checks where supported. |
| Community soil map | Working with Firebase | Leaflet map of ~1 km tiles. Star ratings and reviews appear inside each marker popup. One rating per user per tile is enforced by Firestore rules. |
| Fabrication drawings | Working | Parametric, dimension-validated technical drawings with SVG/PNG download and print-to-PDF. Drawings are built by escaping, never with `innerHTML`. |
| Offline | Working | The PWA app shell is precached. Writes go to an IndexedDB queue with idempotency keys and backoff. |
| Language and voice | Working | Tamil (default) and English, with every key translated. "Read this page aloud" on every screen, with pause, resume, next, restart and stop. Uses the device's speech voices; when no Tamil voice is installed the app says so and offers English. Voice input uses the Web Speech API where supported. |

## Quick start

```bash
npm ci
cp .env.example .env.local    # optional keys; every feature degrades clearly without them
npm run dev
```

```bash
npm run typecheck   # tsc -b
npm test            # Vitest: 14 files, 167 tests
npm run build       # production build + custom service worker (src/sw.ts)
npm run e2e         # Playwright smoke tests on installed Edge (12 tests, network mocked)
```

## Architecture

```
src/
  app/            shell, hash router, Zustand store, settings, location, sync/weather hooks
  domain/         taxonomy (model label ids ↔ names), districts
  lib/            firebase (auth, scans, ratings, aggregation), mandi, weather, http, format
  lib/inference/  metadata validation, artifact checks, TF.js classifier (lazy-loaded)
  modules/farm/   scan, guidance, crop recommend, my crop, mandi, soil map, data/*.json
  modules/fabrication/  engine (shapes, drawing, svg), intent extraction, viewer + exporters
  modules/{planner,finance,irrigation,assistant,watchlist}/  the five farm tools (IndexedDB via lib/farmRepo.ts)
  lib/ai/         browser client for the Gemini proxy
  server/         mandi and Gemini proxies, shared by the Vite dev server and the Worker
  shared/         ui components, voice engine + read-aloud, notifications, offline sync queue
  sw.ts           service worker: precache, runtime caches, Periodic Background Sync checks
e2e/                  Playwright smoke tests
  i18n/           ta.json, en.json
packages/ml-models/   cloud GPU training notebooks (Kaggle/Colab only)
scripts/              notebook generator, Kaggle launcher, model import/rollback
server/mandi-worker/  Cloudflare Worker: GET /prices, POST /ai/generate
firestore.rules       all write validation (Spark plan: no Cloud Functions)
```

- **Models.** `public/models/<task>_model/` must contain a `metadata.json`
  with `"status": "validated"`, test metrics and training provenance, plus a
  `labels.json` that matches. Otherwise TF.js is never loaded. See
  `packages/ml-models/README.md`.
- **Aggregation.** Clients never write counts or averages. Map tiles and
  rating summaries are computed from the individual documents on read.
  Rules make those documents write-once (or own-document-only for ratings)
  and schema-validated.
- **Secrets.** Every `VITE_*` value ends up in the public bundle. Restrict each
  key by HTTP referrer in its provider console. The data.gov.in and Gemini keys are never `VITE_*`: they live in the dev server's `.env.local` or as Worker secrets, and the build fails if either value is in `dist/`. `.env*` files are git-ignored.

## Documentation

See [docs/README.md](docs/README.md) for the index.

- [AUDIT_REPORT.md](docs/AUDIT_REPORT.md) covers what was found and what changed.
- [IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md) gives the status of every requirement.
- [TESTING_REPORT.md](docs/TESTING_REPORT.md) lists the commands and their actual results.
- [MODEL_EVALUATION_REPORT.md](docs/MODEL_EVALUATION_REPORT.md) records the training runs and test metrics.
- [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) covers hosting, rules, CI secrets and model import.
- [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) lists the known limitations.
