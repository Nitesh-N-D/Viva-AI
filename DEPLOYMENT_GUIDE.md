# Deployment guide

Firebase project: `viva-ai-2cc88` (see `.firebaserc`). Everything runs on the
free Spark plan.

## 1. Environment

Copy `.env.example` to `.env.local` for local work. Every key is optional
except Firebase, and each feature degrades with a clear message:

| Variable | Used for |
|---|---|
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID` | Anonymous auth, scans, ratings |
| `VITE_OPENWEATHER_API_KEY` | Weather |
| `VITE_AGMARKNET_API_KEY` | Mandi prices (data.gov.in) |
| `VITE_MANDI_PROXY_URL` (optional) | Only if data.gov.in ever stops sending CORS headers |

Restrict each key by HTTP referrer (`viva-ai-2cc88.web.app`,
`viva-ai-2cc88.firebaseapp.com`, `localhost`) in the provider console.

## 2. Firebase console, one time

1. Authentication → Sign-in method → enable **Anonymous**.
2. Firestore → create a database in production mode.

## 3. Firestore rules

```bash
firebase deploy --only firestore:rules --dry-run   # compile check
firebase deploy --only firestore:rules
```

The map and ratings read `soilScans` and `ratings`. Until these rules are
deployed, the map shows "Missing or insufficient permissions".

## 4. Hosting

Manual:

```bash
npm ci && npm test && npm run build
firebase deploy --only hosting
```

Automatic, through GitHub Actions:

- `ci.yml` runs `npm ci`, `npm test` and `npm run build` on every push and PR.
- `firebase-hosting-merge.yml` runs the same steps on push to `main`, then
  deploys to the live channel.
- `firebase-hosting-pull-request.yml` deploys a preview channel for each PR.

Both deploy workflows deploy only if the secret exists. Otherwise they print
a warning and pass.

GitHub → Settings → Secrets and variables → Actions:

| Secret | Notes |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_VIVA_AI_2CC88` | Service-account JSON created by `firebase init hosting:github` |
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | The same values as `.env.local` |
| `VITE_OPENWEATHER_API_KEY`, `VITE_AGMARKNET_API_KEY` | Optional |

## 5. Models

Models are trained on Kaggle GPU and never on a laptop:

```bash
pip install kaggle                       # once; put the token in ~/.kaggle/kaggle.json
npm run train:cloud -- disease           # push → wait → download → validate → install
npm run train:cloud -- soil
npm test && npm run build
git add public/models/<task>_model && git commit
```

To roll back, run `npm run model:rollback -- <task>`. Model files are served
network-first and cached on first use. They are not part of the precache.

## 6. Post-deploy checks

- Open `#/soil` and `#/disease`. They should show "awaiting cloud training"
  or, after an import, run a scan.
- Open `#/map`. Markers load with no permissions error, and a tile popup shows
  its rating.
- Open `#/market`. It shows the arrival date and source.
