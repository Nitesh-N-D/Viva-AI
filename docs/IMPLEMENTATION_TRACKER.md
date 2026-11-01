# Implementation tracker

Statuses: **COMPLETED AND VERIFIED** means implemented and checked by tests,
a build or a live check. **BLOCKED BY EXTERNAL DEPENDENCY** means the code is
ready but something outside the repo is needed. **NOT COMPLETED** means the
item has not been done. Last updated 2026-11-01.

| # | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 1 | Full repository audit | COMPLETED AND VERIFIED | `AUDIT_REPORT.md` |
| 2 | UI/UX redesign (shell, navigation, cards, dialogs, toasts, error boundary, lazy screens) | COMPLETED AND VERIFIED | `src/app/AppShell.tsx`, `src/shared/ui/*`. All 10 routes were rendered in headless Chrome against the production build (`TESTING_REPORT.md`). |
| 3 | Real soil inference, metadata-gated, no fake predictions | COMPLETED AND VERIFIED (pipeline) | `src/lib/inference/*`, `models.test.ts` (a real TF.js forward pass on a fixture model) and `inference.test.ts`. The UI shows "awaiting cloud training". |
| 4 | Real disease inference | COMPLETED AND VERIFIED (pipeline) | Same as #3. 10 tomato classes, each with bilingual guidance. |
| 5 | Trained soil and disease models | BLOCKED BY EXTERNAL DEPENDENCY | Needs a Kaggle API token (`~/.kaggle/kaggle.json`), then `npm run train:cloud -- <task>`. Local training is prohibited and the notebooks refuse to run locally. |
| 6 | Cloud training notebooks (Kaggle/Colab GPU only) | COMPLETED AND VERIFIED (static) | `scripts/build-notebooks.mjs` generates both. The Python passes an `ast` syntax check, and a test checks the class map against the notebook and taxonomy. **They have not been run in the cloud yet.** |
| 7 | Model import, validation, atomic swap, rollback | COMPLETED AND VERIFIED | `scripts/import-model.ts`, `src/lib/inference/artifact.ts`. Seven checkArtifact tests. |
| 8 | Explainable crop engine (not ML) | COMPLETED AND VERIFIED | `cropEngine.ts`, 12 tests |
| 9 | Leaflet map with ratings in marker popups | COMPLETED AND VERIFIED (code) | `SoilMap.tsx`, `community.test.ts`. Production shows a permissions error until the new rules are deployed (#11). |
| 10 | Secure Firestore persistence | COMPLETED AND VERIFIED (compiles) | `firestore.rules`. `firebase deploy --dry-run` reported "compiled successfully". No emulator rule tests yet (#20). |
| 11 | Deploy Firestore rules | See `DEPLOYMENT_GUIDE.md` and the final report | Uses `firebase deploy --only firestore:rules` |
| 12 | Server-side aggregation | BLOCKED BY EXTERNAL DEPENDENCY | Cloud Functions need the Blaze plan. Aggregation is done on read from rule-validated documents, and no client writes aggregates. |
| 13 | Live mandi prices, honest freshness | COMPLETED AND VERIFIED | `mandi.ts`, 10 tests. The live API, its record shape and CORS were verified on 2026-11-01. |
| 14 | Weather with source and freshness | COMPLETED AND VERIFIED | `weather.ts`, 3 tests. With no key it reports "unavailable", not mock data. |
| 15 | Parametric technical drawings, SVG/PNG/PDF export, XSS-safe | COMPLETED AND VERIFIED | `engine/*`, `exporters.ts`, 25 fabrication tests. PDF goes through the browser's print dialog. |
| 16 | Offline sync with idempotency | COMPLETED AND VERIFIED | `SyncQueue.ts`, 6 tests (fake-indexeddb) |
| 17 | Tamil and English, voice, accessibility | COMPLETED AND VERIFIED (keys) | `i18n.test.ts` checks key parity. Voice uses the Web Speech API. No automated a11y audit has been run (#21). |
| 18 | CI (test and build on push/PR) | COMPLETED (runs after push) | `.github/workflows/ci.yml` |
| 19 | CD (Firebase Hosting) only when credentials exist | COMPLETED | The merge workflow deploys only when the `FIREBASE_SERVICE_ACCOUNT_VIVA_AI_2CC88` secret is present. |
| 20 | Firestore rules unit tests (emulator) | NOT COMPLETED | Needs `@firebase/rules-unit-testing` and the Java-based emulator |
| 21 | Automated accessibility audit (axe/Lighthouse) | NOT COMPLETED | |
| 22 | Documentation set | COMPLETED | README, AUDIT, TRACKER, TESTING, MODEL_EVALUATION, DEPLOYMENT, KNOWN_LIMITATIONS, `.env.example` |
