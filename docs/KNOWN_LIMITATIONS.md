# Known limitations

## Models
- Both models are trained (Kaggle GPU) and validated; metrics are in `MODEL_EVALUATION_REPORT.md`. **Field accuracy has not been measured**: all numbers come from held-out splits of the training datasets.
- The disease model covers **tomato leaves only**. It was trained on PlantVillage-style lab photos (one leaf on a plain background), so field photos will perform worse than the 92.7% test accuracy.
- The soil model learned from a few hundred photos; its test set is only 83 images (accuracy 95% CI 0.71–0.88). The **alluvial** class is weak (F1 0.375, 5 test images). It predicts a visual category, not pH or nutrients, and is not a substitute for a soil test.
- The soil dataset is CC BY-NC-SA 4.0 (non-commercial). A commercial release would need a different dataset.
- Scores are uncalibrated softmax values, shown as "model score" rather than a probability.

## Data services
- The Agmarknet resource `9ef84268-d588-465a-a308-a864a43d0070` holds only the **current day's** reported arrivals, and markets report through the day. A query can legitimately return 0 records in the morning and records later (Villupuram tomato: 0 at ~11:20 IST, 3 by ~11:30 IST on 02/11/2026). The app says "No price records found" rather than guessing, and shows the arrival date on every record.
- data.gov.in is intermittently slow: requests for 500–1000 records have hit the 15 s proxy timeout and then succeeded on retry. The client retries each page once on a 504; after that it shows "unavailable" or the labelled cached copy.
- The upstream returns at most 1000 records per call; the app pages in 500s and stops at 5000 records per query (it shows a truncation notice if a query ever exceeds that). Tamil Nadu has ~6,000 records/day across all commodities, so queries are always per commodity.
- Prices are reported per quintal (100 kg) by Agmarknet; the API itself does not return a unit field, so the unit label comes from Agmarknet's published convention.
- The data.gov.in key is server-side only (dev/preview proxy, or the Cloudflare Worker in production). The Worker's cache and rate limit are per isolate, not global.
- **Production mandi prices are currently unavailable (2026-11-02).** The Worker is deployed and configured, but every request it makes to `api.data.gov.in` fails with Cloudflare 521/523 (origin unreachable) or a timeout, while the same query from a machine in India succeeds. data.gov.in appears to refuse connections from Cloudflare's network. The app shows "The price service returned an error." and never shows invented or cached-as-live data. Options, all of which need the owner's action:
  1. Try Cloudflare Smart Placement (`[placement] mode = "smart"` in `server/mandi-worker/wrangler.toml`) and redeploy. This is unverified and may not help, because the block is on the data.gov.in side.
  2. Host the mandi proxy in an Indian region, for example a Firebase Cloud Function in `asia-south1` (needs the Blaze plan), or any small server in India, using the same `handleMandiProxy` code. Then point `VITE_MANDI_PROXY_URL` at it.
  The Gemini route on the same Worker is not affected.
- Firebase and OpenWeather `VITE_*` keys remain public in the bundle by design (Firebase web keys are identifiers, protected by Firestore rules). Restrict them by HTTP referrer in each provider console.
- Without a key/proxy, weather and mandi screens show "unavailable" or cached data with its age. There is no mock data.

## AI assistant (Gemini)
- The Gemini key is server-side only. Production AI works only after the owner deploys the Cloudflare Worker with `GEMINI_API_KEY` as a secret; until then the assistant and "explain" buttons show "AI not configured".
- Answers are generated text, not verified advice. The prompt tells the model to say when it is unsure and to recommend the local agriculture officer; the UI labels answers as AI-generated.
- The Worker's AI rate limit is per isolate (best effort), and Gemini free-tier quotas apply. Quota errors (429) and model-specific rejections (400) fall back to the next model, then show a "try later" message.
- The model sometimes echoed `<app_data>` tags, and once made up a "model prediction / confidence" block. The proxy strips any `<app_data>` block from answers and the prompt forbids it. This is in the code but **not yet on the production Worker** until it is redeployed (`npx wrangler@4 deploy` from `server/mandi-worker/`).

## New farm tools
- Planner, finance, watchlist and chat history are stored in this browser's IndexedDB only. They are not synced to the cloud, so clearing site data deletes them. Use the finance CSV export as a backup.
- Planner reminders and watchlist alerts are checked in the open app (every 15 minutes and whenever the app comes back to the foreground) and shown as an in-app toast plus a system notification when permission is granted.
- **Background checks** (app closed) use Periodic Background Sync in the service worker (`src/sw.ts`). They work only in Chromium browsers (Chrome, Edge, Samsung Internet) with the app **installed** as a PWA and notification permission granted. The browser decides when to run them (at most about every 12 hours, less often for rarely used apps, never on battery saver). Firefox and Safari/iOS do not support it, and the planner says so. There is no server push, so the timing is never guaranteed.
- Background price checks call the same mandi proxy, so while production mandi prices are unavailable (see above) background price alerts cannot fire either.
- Watchlist alerts compare prices the app has fetched on this device; Agmarknet's resource holds only the current day, so there is no historical price series.
- Irrigation figures are FAO-56 Hargreaves estimates from weather data and crop coefficients. They are not sensor readings, and they assume default soil and efficiency values unless the user changes them. If the location is unknown, a default latitude is used and the screen says so.

## Firestore and community features
- The Spark plan has no Cloud Functions, so aggregates (tile soil mix, average ratings) are computed by each client from up to 2000 scans and 5000 ratings. This will need a server-side job (Blaze) once traffic grows.
- Moderation is manual: reports go to `ratingReports`, and a moderator sets `status: "hidden"` in the console.
- There are no automated rule tests against the Firestore emulator yet. The rules were compile-checked with `firebase deploy --dry-run`.
- Anonymous auth means a user who clears site data gets a new uid and could rate a tile again.

## App
- PDF export uses the browser print dialog ("Save as PDF"), not a generated PDF file.
- Speech recognition depends on the browser. Chrome needs a network connection for it, and Firefox does not support it.
- Read-aloud (pause, resume, next part, restart, stop) uses the device's own text-to-speech. Tamil needs a Tamil voice on the device: Android has one through Google Text-to-Speech (download the Tamil language pack); Windows needs the Tamil speech pack under Settings → Time & language → Speech; many desktop browsers have none. Without one, the app says so and offers to read in English; it never reads Tamil text with an English voice. Some engines (notably Chrome on Android) ignore pause and resume for long texts, so the app reads in short parts.
- The local `.env` used during development stores the data.gov.in and Gemini keys under `VITE_`-prefixed names. The client code never reads them and the build fails if either value reaches `dist/`, but renaming them to `AGMARKNET_API_KEY` / `GEMINI_API_KEY` (which the dev proxy already prefers) removes the risk entirely.
- No automated accessibility audit (axe/Lighthouse) has been run. The e2e suite checks only that pages render, navigation works and there is no horizontal scroll at 360 px.
- `npm audit --omit=dev` reports advisories in transitive Firebase SDK dependencies (`@grpc/grpc-js`, `undici`, `protobufjs`). Those modules belong to the SDK's Node code paths. Fixing them requires a Firebase major upgrade, which has not been done.
- The TF.js chunk is about 1.9 MB (306 KB gzipped). It loads only when a validated model exists.
