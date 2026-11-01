# packages/ml-models

Cloud-only training pipelines for VIVA AI's two on-device image classifiers.

| Task | Notebook | Dataset (Kaggle) | Licence | Classes |
|---|---|---|---|---|
| soil | `soil_classifier/train_colab.ipynb` | `ai4a-lab/comprehensive-soil-classification-datasets` (`Orignal-Dataset/` only) | CC BY-NC-SA 4.0 (non-commercial) | alluvial, black, laterite, red |
| disease | `disease_classifier/train_colab.ipynb` | `kaustubhb999/tomatoleaf` | CC0 | 10 tomato-leaf conditions (see `src/domain/taxonomy.ts`) |

**Current status: no model has been trained.** Both folders in
`public/models/` hold legacy artifacts without provenance, and the app shows
**MODEL AWAITING CLOUD TRAINING** for both scans. No accuracy numbers exist yet.

## Training never runs on a laptop

Each notebook's second cell stops with `REFUSING TO RUN` unless it detects
a Kaggle or Google Colab runtime **and** a working NVIDIA GPU (`nvidia-smi`
and TensorFlow both have to see it). There is no CPU fallback. Locally you
only generate the notebooks, launch them on Kaggle, and import the result.

## Files

```
scripts/build-notebooks.mjs   # single source for both notebooks; edit this, then: node scripts/build-notebooks.mjs
scripts/cloud-train.mjs       # push notebook to Kaggle GPU, poll, download, import (needs a Kaggle API token)
scripts/import-model.ts       # validate + atomically install an artifact; rollback
<task>_classifier/
  train_colab.ipynb           # generated
  class_map.json              # app label id -> dataset folder(s); a test keeps it equal to the notebook and taxonomy
  kernel-metadata.template.json  # Kaggle kernel settings (private, GPU, internet, dataset source)
```

## What the notebook does

1. Detects the platform and GPU, and checks disk space.
2. Downloads the dataset with `kagglehub`, or uses the `/kaggle/input` mount.
   It fails clearly if the expected folders are missing.
3. Integrity scan: skips unreadable or truncated files and images whose short
   side is under 64 px, applies EXIF orientation, converts to RGB, and caches
   each image shrunk to a long side of at most 640 px, exactly as the app's
   capture canvas does.
4. Duplicate control: exact copies are found by sha256 and near-copies by
   64-bit dHash (Hamming distance ≤ 5), and both are merged into groups.
   Groups that appear under two labels are dropped. Groups never cross splits.
5. Splits the data with `StratifiedGroupKFold` into about 72% train, 14% val
   and 14% test. It saves the split manifest and a class-distribution chart.
6. Trains MobileNetV2 (ImageNet weights) with a GAP → Dropout → Dense softmax
   head. It first trains the head only, then fine-tunes the top 40 layers with
   BatchNorm frozen. Training uses balanced class weights, mild augmentation
   (very little colour jitter for soil), early stopping, LR-on-plateau, a best
   checkpoint and a CSV log.
7. Evaluates on the test split only: accuracy, macro F1, a 95% bootstrap CI,
   per-class precision/recall/F1, a confusion matrix, misclassified examples,
   and the fraction of predictions below the app's confidence threshold.
8. Exports to `.h5` and converts with `tensorflowjs_converter 4.22.0` in an
   **isolated virtualenv**, which fixes the v1 bug where the converter's
   dependencies corrupted the training environment.
9. Validates the artifact: format, the byte size of every shard against the
   manifest, sha256, and that the output width equals the label count. A
   **parity test** then runs 32 test images through Keras and through
   `@tensorflow/tfjs` 4.22 in Node (the browser's library). The maximum
   difference must be ≤ 1e-3 and the argmax must agree on every image.
10. Writes `labels.json`, `evaluation.json` and `metadata.json`.
    `"status": "validated"` is written only if every check passed **and**
    macro F1 ≥ the bar (soil 0.70, disease 0.90). Otherwise the status is
    `"unverified"`, with the reason recorded, and both the app and the
    importer reject the model.
11. Zips the model and run report. On Colab it copies the zip to Drive.

Preprocessing parity with the app: RGB, long side ≤ 640, bilinear stretch to
224×224 (`align_corners=False, half_pixel_centers=False`, the same as TF.js
`resizeBilinear`), then `x/127.5 − 1`.

## Running it

**Kaggle (automated):**

```bash
pip install kaggle                     # official CLI
# put your API token at ~/.kaggle/kaggle.json (Kaggle → Settings → API → Create New Token)
npm run train:cloud -- disease         # pushes a private GPU kernel, waits, downloads, imports
npm run train:cloud -- soil
npm test && npm run build
```

**Colab (manual):** open the notebook in Colab, choose Runtime → Change
runtime type → GPU, then Run all. Download the zip from Drive and run:

```bash
npm run model:import -- soil path/to/soil_model
```

**Rollback:** `npm run model:rollback -- soil` restores the previous folder
from `models-rollback/`. That folder is git-ignored.

## Known limitations

- Disease: PlantVillage-style single leaves on plain backgrounds. Field photos
  will score lower than the test metrics. Tomato only.
- Soil: a few hundred photos, about 50 of them alluvial. Expect wide confidence
  intervals. It predicts a visual category only; it is not a soil test.
- Softmax scores are not calibrated probabilities. The app reports them as
  "model score" and asks for a retake below `minConfidence`.
