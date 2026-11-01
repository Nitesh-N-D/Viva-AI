# Known limitations

## Models
- **Neither image model is trained yet.** Both scans show "MODEL AWAITING CLOUD TRAINING" and offer manual selection instead.
- Once trained, the disease model covers **tomato leaves only**. It was trained on PlantVillage-style lab photos (one leaf on a plain background), so field photos will perform worse than the test metrics.
- The soil model will learn from a few hundred photos (about 50 alluvial). It predicts a visual category, not pH or nutrients, and is not a substitute for a soil test.
- The soil dataset is CC BY-NC-SA 4.0 (non-commercial). A commercial release would need a different dataset.
- Scores are uncalibrated softmax values, shown as "model score" rather than a probability.

## Data services
- Agmarknet data is published by markets with a delay and is sometimes missing for a district or commodity. The app shows the arrival date and says "No price records found" rather than guessing.
- Every `VITE_*` key (Firebase, OpenWeather, data.gov.in) is public in the bundle. Restrict the keys by HTTP referrer in each provider console.
- Without a key, weather and mandi screens show "unavailable" or cached data with its age. There is no mock data.

## Firestore and community features
- The Spark plan has no Cloud Functions, so aggregates (tile soil mix, average ratings) are computed by each client from up to 2000 scans and 5000 ratings. This will need a server-side job (Blaze) once traffic grows.
- Moderation is manual: reports go to `ratingReports`, and a moderator sets `status: "hidden"` in the console.
- There are no automated rule tests against the Firestore emulator yet. The rules were compile-checked with `firebase deploy --dry-run`.
- Anonymous auth means a user who clears site data gets a new uid and could rate a tile again.

## App
- PDF export uses the browser print dialog ("Save as PDF"), not a generated PDF file.
- Speech recognition depends on the browser. Chrome needs a network connection for it, and Firefox does not support it. Text-to-speech needs a Tamil voice installed on the device.
- No automated accessibility audit (axe/Lighthouse) has been run.
- `npm audit --omit=dev` reports advisories in transitive Firebase SDK dependencies (`@grpc/grpc-js`, `undici`, `protobufjs`). Those modules belong to the SDK's Node code paths. Fixing them requires a Firebase major upgrade, which has not been done.
- The TF.js chunk is about 1.9 MB (306 KB gzipped). It loads only when a validated model exists.
