# VIVA AI documentation

| Document | Contents |
|---|---|
| [AUDIT_REPORT.md](AUDIT_REPORT.md) | Findings from the repository audit and how each was resolved |
| [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) | Status of every requirement (verified, blocked or not done), including the five new farm tools |
| [TESTING_REPORT.md](TESTING_REPORT.md) | Commands run and their actual outputs: typecheck, tests, build, live API checks, browser smoke test |
| [MODEL_EVALUATION_REPORT.md](MODEL_EVALUATION_REPORT.md) | Kaggle training runs and test-set metrics for the soil and disease models |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Environment, Firebase setup, rules, hosting, Cloudflare Worker (mandi + Gemini), CI secrets, model import |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Known limitations of models, data services, AI and the app |

Other docs that live next to their code:

- [`../packages/ml-models/README.md`](../packages/ml-models/README.md) covers the cloud training pipeline.
- `../public/models/*/metadata.json` and `evaluation.json` describe each shipped model.
