# Model evaluation report

**Status on 2026-11-01: no model has been trained or evaluated.** No
accuracy, F1 or other metric exists for either classifier, and none is
claimed anywhere in the app or the docs.

| Model | Status | Shown in app |
|---|---|---|
| Soil type (4 classes) | Awaiting cloud training | "MODEL AWAITING CLOUD TRAINING" plus manual soil selection |
| Tomato leaf condition (10 classes) | Awaiting cloud training | "MODEL AWAITING CLOUD TRAINING" plus manual condition browser |
| Crop suggestions | Not ML | A deterministic rule engine. Its scores are suitability shares (0–100), not probabilities. |

## Why there are no numbers

Training is allowed only on Kaggle or Google Colab GPUs. No Kaggle API token
or Colab session is available to this environment, and the developer laptop
must never be used for training. The notebooks are ready
(`packages/ml-models/`), and `npm run train:cloud -- <task>` runs the whole
loop once a token exists.

## Legacy artifacts

`public/models/{soil,disease}_model/` contain weights from an earlier attempt.
There is no record of their dataset, class order, preprocessing or test
results, and both tasks share byte-identical backbone shards. They are
therefore treated as untrustworthy and are not loaded.

## What a future report will contain

Each run writes `evaluation.json` next to the model:

- held-out, group-disjoint test accuracy and macro F1, with 95% bootstrap intervals
- validation accuracy
- per-class precision, recall, F1 and support
- confusion matrix (JSON and PNG)
- the fraction of test images below the app's confidence threshold
- up to 50 misclassified file paths
- TF.js vs Keras parity (max abs diff, argmax agreement) in `metadata.artifactChecks`

Acceptance bars are macro F1 ≥ 0.70 for soil and ≥ 0.90 for disease. A model
below its bar is exported as `unverified`, and both the importer and the app
reject it. Test metrics come from the same dataset distribution. Field accuracy
on farmers' own photos has not been measured and is expected to be lower.
