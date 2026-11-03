# Deployment guide

Firebase project: `viva-ai-2cc88` (see `.firebaserc`). Everything runs on the
free Spark plan.

## 1. Environment

Copy `.env.example` to `.env.local` for local work. Every key is optional
except Firebase, and each feature degrades with a clear message:

| Variable | Used for |
|---|---|
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID` | Anonymous auth, scans, ratings |
| `OPENWEATHER_API_KEY` (server-only, **no** `VITE_` prefix) | Weather: read by the Vite dev/preview proxy, and a Worker secret in production (`GET /weather?lat=&lon=`) |
| `AGMARKNET_API_KEY` (server-only, **no** `VITE_` prefix) | Mandi prices: read by the Vite dev/preview proxy only |
| `VITE_MANDI_PROXY_URL` | Production Worker base URL (the Cloudflare Worker below), used for mandi prices and AI. Not a secret |
| `GEMINI_API_KEY` (server-only, **no** `VITE_` prefix), `GEMINI_MODEL` (optional) | Gemini assistant: read by the Vite dev/preview proxy, and a Worker secret in production |
| `VITE_AI_PROXY_URL` (optional) | Only if the AI route runs on a different Worker; base URL, the app appends `/ai/generate` |

Restrict each browser key by HTTP referrer (`viva-ai-2cc88.web.app`,
`viva-ai-2cc88.firebaseapp.com`, `localhost`) in the provider console.

Anything prefixed `VITE_` is compiled into the public JavaScript bundle.
Storing it as a GitHub Secret does **not** hide it: the secret is only hidden
in CI logs, not in the built files. That is why the data.gov.in key is no
longer a `VITE_` variable. A legacy `VITE_AGMARKNET_API_KEY` in `.env` is
still read by the local dev proxy, but client code never reads it; rename it
to `AGMARKNET_API_KEY`. `npm run build` fails if the key value appears in any
emitted file.

## 1a. Mandi price proxy (production)

Firebase Hosting on the Spark plan cannot run server code, so the proxy is a
free-tier Cloudflare Worker that reuses `src/server/mandiProxy.ts` (same code
as the dev proxy):

```bash
npx wrangler@4 login
npx wrangler@4 secret put AGMARKNET_API_KEY --config server/mandi-worker/wrangler.toml
npx wrangler@4 deploy --config server/mandi-worker/wrangler.toml
```

Then add the printed `https://viva-ai-mandi-proxy.<account>.workers.dev`
URL as the GitHub Actions secret `VITE_MANDI_PROXY_URL` and redeploy.

What the proxy enforces:

- Only `GET /prices` with `state`, `commodity` (required), `district`,
  `market`, `limit` (1–1000), `offset` (0–20000). Unknown or repeated
  parameters → 400. Values are length- and character-checked.
- The upstream is pinned to `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`;
  callers cannot choose another resource or host.
- 15 s upstream timeout → 504 `upstream_timeout`; bad key → 502
  `upstream_auth`; missing key → 503 `not_configured`. Upstream bodies and
  the key are never echoed back.
- 5-minute in-memory TTL cache (`x-viva-cache: hit|miss`) and a per-client
  rate limit (429 `rate_limited`). Both are per Worker isolate (best effort).
- CORS only for the origins in `ALLOWED_ORIGINS` (wrangler.toml).

Until the Worker is deployed and `VITE_MANDI_PROXY_URL` is set, the
production mandi screen says the price service is not configured. It never
shows invented prices.

## 1b. Gemini AI proxy (production)

The same Worker serves `POST /ai/generate` (code in `src/server/aiProxy.ts`,
shared with the dev server's `/api-ai/generate`). Add the key as a secret and
redeploy:

```bash
npx wrangler@4 secret put GEMINI_API_KEY --config server/mandi-worker/wrangler.toml
npx wrangler@4 secret put OPENWEATHER_API_KEY --config server/mandi-worker/wrangler.toml
npx wrangler@4 deploy --config server/mandi-worker/wrangler.toml
```

No new GitHub secret is needed: the app calls
`${VITE_MANDI_PROXY_URL}/ai/generate`. What the AI route enforces:

- POST only, JSON body up to the size limit, origin must be in `ALLOWED_ORIGINS`
  (403 otherwise, because each call costs quota).
- Strict body schema (`task`, `lang`, `question`, `context`, `history`);
  unknown fields are rejected.
- The key is sent to Google only in the `x-goog-api-key` header and is never
  returned. Retries with exponential backoff on 5xx/timeouts, falls back to
  the next model on 400/404/429/503, never retries 401/403 or blocked answers.
- Any `<app_data>` block the model echoes or invents is removed from the answer.
- Per-client rate limit (per isolate).

Worker code changes (anything in `src/server/` or `server/mandi-worker/`) reach
production only after `npx wrangler@4 deploy --config server/mandi-worker/wrangler.toml`.
CI deploys the Firebase site, not the Worker. Check `npx wrangler@4 whoami` first;
the existing secrets stay in place across deploys, so do not re-enter them.

## 1c. Background notifications

The service worker is built from `src/sw.ts` (vite-plugin-pwa `injectManifest`).
When notification permission is granted, the app registers a Periodic Background
Sync (`viva-background-checks`, minimum interval 12 h). The browser runs it only for
an **installed** PWA in Chromium browsers, at times it chooses. The check marks due
planner tasks and re-checks stale price watches through the same mandi proxy, then
shows a notification. Nothing needs to be deployed for this beyond the site itself.
Notification text is cached in the current language (Cache Storage `viva-meta`)
whenever the app is open.

Never create a `VITE_GEMINI_API_KEY`: `VITE_` values are public. If one
exists in an old `.env`, the dev server still reads it, but rename it.

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
| `VITE_MANDI_PROXY_URL` | URL of the deployed mandi Worker (not a secret value, but kept with the others) |

Delete the old `VITE_AGMARKNET_API_KEY` repository secret; the workflows no longer use it.

## 5. Models

Models are trained on Kaggle GPU and never on a laptop:

```bash
pip install --user kaggle six            # once; put the token in ~/.kaggle/kaggle.json
npm run train:cloud -- disease           # push → wait → download → validate → install
npm run train:cloud -- soil
npm test && npm run build
git add public/models/<task>_model && git commit
```

To roll back, run `npm run model:rollback -- <task>`. Model files are served
network-first and cached on first use. They are not part of the precache.

## 6. Post-deploy checks

- Open `#/soil` and `#/disease`. They should show "model ready" with versions
  `soil-mnv2-20261102T062949Z` and `disease-mnv2-20261102T073346Z`.
- Open `#/assistant` and ask a question in Tamil. It answers, or says "AI not
  configured" if the Worker or its `GEMINI_API_KEY` secret is missing.
- Open `#/planner`, `#/finance`, `#/irrigation`, `#/watchlist`; each loads
  without an error.
- Open `#/map`. Markers load with no permissions error, and a tile popup shows
  its rating.
- Open `#/market`. Tamil Nadu → Villupuram → Tomato shows live records with
  arrival date, unit (₹/quintal) and source, or an explicit "no records" /
  "not configured" message.
