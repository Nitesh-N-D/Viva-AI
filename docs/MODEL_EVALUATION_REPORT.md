# Model evaluation report

Last updated 2026-11-02. Every number here is copied from
`public/models/<task>_model/evaluation.json` and `metadata.json`, which the
Kaggle notebook writes. Both files ship next to the weights, and the app and
importer read them.

| Model | Status | Test accuracy (95% CI) | Macro F1 (95% CI) | Test images | Bar |
|---|---|---|---|---|---|
| Tomato leaf condition, 10 classes (`disease-mnv2-20261102T073346Z`) | **validated** | 0.927 (0.915–0.941) | 0.928 (0.915–0.941) | 1474 | macro F1 ≥ 0.90 |
| Soil type, 4 classes (`soil-mnv2-20261102T062949Z`) | **validated** | 0.807 (0.711–0.880) | 0.725 (0.596–0.821) | 83 | macro F1 ≥ 0.70 |
| Crop suggestions | Not ML | — | — | — | Deterministic rule engine; scores are suitability shares (0–100), not probabilities. |

## How the models were trained

| | Disease | Soil |
|---|---|---|
| Platform | Kaggle notebook `niteshnd/viva-ai-disease-classifier`, version 4 (private) | Kaggle notebook `niteshnd/viva-ai-soil-classifier`, version 4 (private) |
| GPU | Tesla T4 | Tesla T4 |
| Run id | `20261102T073346Z` (1691 s, 49 epochs) | `20261102T062949Z` (216 s, 24 epochs) |
| Dataset | `kaggle:kaustubhb999/tomatoleaf` (PlantVillage tomato subset), CC0 | `kaggle:ai4a-lab/comprehensive-soil-classification-datasets`, CC BY-NC-SA 4.0 |
| Architecture | MobileNetV2 (ImageNet) + GAP + Dropout 0.3 + Dense softmax; head training, then fine-tuning of the last 40 layers | same |
| Input | 224×224 RGB, `x/127.5 − 1` | same |
| Split | StratifiedGroupKFold over near-duplicate groups (~72/14/14), so near-identical photos never cross train/test | same |
| TensorFlow | 2.20.0 | 2.20.0 |
| TF.js vs Keras parity (max abs diff) | 2.4e-6 | 5.4e-7 |

No training ran on the developer laptop. `npm run train:cloud -- <task>`
pushes the notebook to Kaggle, polls it, downloads only the exported
artifact (~9 MB) and runs `scripts/import-model.ts`, which checks the
shard SHA-256 hashes, the label order, the metrics bar and the parity value
before it swaps the model in. The previous model is kept in
`models-rollback/` (git-ignored).

## Per-class results (test split)

### Disease

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Bacterial spot | 0.944 | 0.922 | 0.933 | 129 |
| Early blight | 0.937 | 0.792 | 0.858 | 149 |
| Healthy | 0.952 | 1.000 | 0.975 | 157 |
| Late blight | 0.932 | 0.873 | 0.901 | 157 |
| Leaf mould | 0.923 | 0.966 | 0.944 | 148 |
| Septoria leaf spot | 0.891 | 0.914 | 0.903 | 152 |
| Spider mites | 0.944 | 0.938 | 0.941 | 145 |
| Target spot | 0.820 | 0.907 | 0.862 | 151 |
| Mosaic virus | 0.979 | 0.986 | 0.982 | 140 |
| Yellow leaf curl virus | 0.973 | 0.979 | 0.976 | 146 |

Validation accuracy 0.934 (1465 images). 5.2% of test images score below
the app's 0.60 confidence threshold, so the app shows them as "uncertain"
and recommends an expert check.

### Soil

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Alluvial | 0.273 | 0.600 | 0.375 | 5 |
| Black | 0.939 | 0.939 | 0.939 | 33 |
| Laterite | 0.846 | 0.710 | 0.772 | 31 |
| Red | 0.846 | 0.786 | 0.815 | 14 |

Validation accuracy 0.819 (83 images). 9.6% of test images score below 0.60.
**Alluvial is unreliable**: only 5 test images and an F1 of 0.38. The app
shows the model score and always offers manual soil selection.

Confusion matrices: `public/models/<task>_model/confusion_matrix.png`.

## How the app uses the results

- Inference runs in the browser with TF.js. The model loads only when a scan
  starts, never at app startup.
- `metadata.json` gates loading. A model whose status is not `validated`, or
  whose labels, shapes or integrity hashes do not match, is refused, and the
  scan screen shows "model unavailable".
- Scores are uncalibrated softmax values and are labelled "model score", not
  probability. Below 0.60 the result is shown as uncertain.
- `src/__tests__/models.test.ts` re-runs the importer's integrity check on
  the committed files and runs a real TF.js forward pass through each
  published model.

## What these numbers do not tell you

Both test sets come from the same distribution as the training data: one
detached leaf on a plain background for disease, dry close-up soil in daylight
for soil. **Accuracy on farmers' own field photos has not been measured.**
Expect it to be lower. The soil model sees colour and texture only. It does not
measure pH, nutrients or texture class.
