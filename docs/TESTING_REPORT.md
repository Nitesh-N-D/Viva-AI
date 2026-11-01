# Testing report

Run on 2026-11-01 on Windows 11 with Node v22.20.0, from the working tree that
was committed with this report. All outputs below are copied from the actual
runs.

## Type check

```
$ npx tsc -b
(no output, exit code 0)
```

## Unit and integration tests (Vitest 1.6.1, jsdom, fake-indexeddb)

```
$ npx vitest run
 ✓ src/__tests__/router.test.ts  (3 tests)
 ✓ src/__tests__/i18n.test.ts  (4 tests)
 ✓ src/__tests__/weather.test.ts  (3 tests)
 ✓ src/__tests__/mandi.test.ts  (10 tests)
 ✓ src/__tests__/inference.test.ts  (9 tests)
 ✓ src/__tests__/fabrication.test.ts  (25 tests)
 ✓ src/__tests__/cropEngine.test.ts  (12 tests)
 ✓ src/__tests__/syncQueue.test.ts  (6 tests)
 ✓ src/__tests__/models.test.ts  (14 tests)
 ✓ src/__tests__/community.test.ts  (6 tests)
 ✓ src/__tests__/misc.test.ts  (7 tests)
 Test Files  11 passed (11)
      Tests  99 passed (99)
```

| File | What it covers |
|---|---|
| inference | Metadata schema; unverified, missing or inconsistent models are refused without loading TF.js; topK |
| models | Taxonomy ↔ guidance ↔ class_map ↔ notebook consistency; the GPU refusal guard is present; checkArtifact (missing shard, size mismatch, sha256, output width, path traversal, unverified, graph-model); MobileNetV2 normalisation (0 → −1, 255 → 1); **a real TF.js forward pass** through `createClassifier` with an in-memory untrained fixture model (scores sum to 1); refusal on an output-width mismatch |
| mandi | Real record parsing (dd/mm/yyyy, numeric prices); live/cached/unavailable labelling; no-key behaviour |
| weather | Parsing; source and age; no mock data |
| community | Tile aggregation; rating document id and shape (matching the rules); average ratings |
| syncQueue | Idempotency keys, retries with backoff, dedupe |
| fabrication | Shape parameter validation; bilingual intent extraction (including regression cases); SVG serialisation escapes markup |
| cropEngine | Deterministic ranking, missing inputs, pH, rain risks, growth stages |
| i18n | Tamil and English key parity; no empty strings |
| router, misc | Hash route parsing and sanitisation; formatting helpers |

The fixture model has random weights and exists only to exercise the
pipeline. It was created in memory, and no training happened.

## Production build

```
$ npm run build
dist/assets/SoilMap-*.js     164.74 kB │ gzip:  48.92 kB   (lazy)
dist/assets/index-*.js       243.57 kB │ gzip:  83.07 kB   (entry)
dist/assets/firebase-*.js    437.96 kB │ gzip: 102.99 kB
dist/assets/index-*.js     1,915.93 kB │ gzip: 305.92 kB   (TF.js, lazy)
✓ built
PWA v0.20.5  mode generateSW  precache 37 entries (2875.94 KiB)
```

## Notebook static checks

```
$ node scripts/build-notebooks.mjs
wrote packages/ml-models/soil_classifier/train_colab.ipynb (18 cells)
wrote packages/ml-models/disease_classifier/train_colab.ipynb (18 cells)
$ python -I nbcheck.py <both notebooks>     # ast.parse of every code cell
ok packages/ml-models/soil_classifier/train_colab.ipynb
ok packages/ml-models/disease_classifier/train_colab.ipynb
```

The notebooks have **not** been executed. Execution needs a Kaggle or Colab GPU.

## Firestore rules

```
$ firebase deploy --only firestore:rules --dry-run
+  cloud.firestore: rules file firestore.rules compiled successfully
+  Dry run complete!
```

No emulator-based rule tests exist yet (see `KNOWN_LIMITATIONS.md`).

## Browser smoke test (production build)

`vite preview` was served on port 4173, and each route was rendered with
headless Chrome (`--dump-dom`, 8 s virtual time):

| Route | Result |
|---|---|
| `#/` | Renders the location setup card in Tamil |
| `#/soil` | "மாடல் கிளவுட் பயிற்சிக்காக காத்திருக்கிறது" (model awaiting cloud training) plus manual soil picker |
| `#/disease` | Tomato-only notice, awaiting-training notice, condition browser |
| `#/guidance/tomato_late_blight` | Safety warning, urgency banner, symptoms |
| `#/crops` | Crop form; notes that no rain forecast is available |
| `#/farm` | "No crop selected" empty state |
| `#/market` | Crop and district selectors |
| `#/maker` | Fabrication form with example and part types |
| `#/settings` | Language and location settings |
| `#/map` | Map and filters render, then an error: **"Missing or insufficient permissions"** because production Firestore still had the baseline rules. Fixed by deploying `firestore.rules` (see the final report). |

Also checked over HTTP: `/sw.js` 200, `/manifest.webmanifest` 200, and
`/models/soil_model/metadata.json` returns the SPA HTML fallback. The
classifier treats that as "no metadata" and shows the awaiting-training
state.

## Not tested

- Real camera capture on a device, and voice input and output (both need a device or microphone)
- Firestore rules against the emulator
- Automated accessibility audit
- Execution of the cloud training notebooks
