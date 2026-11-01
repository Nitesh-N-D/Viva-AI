# VIVA AI

A Tamil-first, offline-first PWA for small farmers, with a frugal-fabrication
assistant. It runs entirely on free tiers: React on Firebase Hosting, Firestore
on the Spark plan, and on-device TensorFlow.js. There is no custom backend.

**Live:** https://viva-ai-2cc88.web.app

[![CI](https://github.com/Nitesh-N-D/Viva-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Nitesh-N-D/Viva-AI/actions/workflows/ci.yml)

## What works today

| Feature | Status | Notes |
|---|---|---|
| Soil photo classification | **Awaiting cloud training** | The pipeline is complete and gated by `metadata.json`. The app shows "MODEL AWAITING CLOUD TRAINING" and never makes a fake prediction. |
| Tomato leaf condition scan | **Awaiting cloud training** | Same as soil. Bilingual guidance is ready for all 10 classes. |
| Crop suggestions | Working | An explainable, deterministic rule engine over soil, season, water, pH and duration, **not ML**. Each score is broken into per-check results, and the 5-day rain forecast only raises timing risks. |
| Weather | Working with `VITE_OPENWEATHER_API_KEY` | Shows the source (live/cached) and its age. With no key it says so. There is no mock data. |
| Mandi prices | Working with `VITE_AGMARKNET_API_KEY` | data.gov.in Agmarknet daily prices. Arrival date and source are shown, and cached data is never labelled live. There is no mock data. |
| Community soil map | Working with Firebase | Leaflet map of ~1 km tiles. Star ratings and reviews appear inside each marker popup. One rating per user per tile is enforced by Firestore rules. |
| Fabrication drawings | Working | Parametric, dimension-validated technical drawings with SVG/PNG download and print-to-PDF. Drawings are built by escaping, never with `innerHTML`. |
| Offline | Working | The PWA app shell is precached. Writes go to an IndexedDB queue with idempotency keys and backoff. |
| Language and voice | Working | Tamil (default) and English, with every key translated. Voice uses the Web Speech API where the browser supports it. |

## Quick start

```bash
npm ci
cp .env.example .env.local    # optional keys; every feature degrades clearly without them
npm run dev
```

```bash
npm run typecheck   # tsc -b
npm test            # Vitest: 11 files
npm run build       # production build + service worker
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
  shared/         ui components, voice engine, offline sync queue
  i18n/           ta.json, en.json
packages/ml-models/   cloud GPU training notebooks (Kaggle/Colab only)
scripts/              notebook generator, Kaggle launcher, model import/rollback
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
  key by HTTP referrer in its provider console. `.env*` files are git-ignored.

## Documentation

- [AUDIT_REPORT.md](AUDIT_REPORT.md) covers what was found and what changed.
- [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) gives the status of every requirement.
- [TESTING_REPORT.md](TESTING_REPORT.md) lists the commands and their actual results.
- [MODEL_EVALUATION_REPORT.md](MODEL_EVALUATION_REPORT.md) records the model status (no trained model yet).
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) covers hosting, rules, CI secrets and model import.
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) lists the known limitations.
