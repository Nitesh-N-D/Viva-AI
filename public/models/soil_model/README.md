# soil model folder

The app only runs a model from this folder when **all** of these exist and
validate (see `src/lib/inference/metadata.ts`):

- `metadata.json` with `"status": "validated"`, evaluation results and the training run
- `labels.json` (ordered class ids; must equal `metadata.labels`)
- `model.json` + weight shards (TF.js layers-model)

These files are produced by the Kaggle GPU notebooks in
`packages/ml-models/` (`npm run train:cloud -- soil`) and installed with
`npm run model:import`, which re-checks sizes, sha256 and output width.
Never train locally.

## Current contents

`soil-mnv2-20261102T062949Z`: MobileNetV2 transfer model trained on a Kaggle
Tesla T4 on 2026-11-02 from `ai4a-lab/comprehensive-soil-classification-datasets`
(CC BY-NC-SA 4.0). Held-out test accuracy 0.807, macro F1 0.725 (83 images).
See `evaluation.json` and `docs/MODEL_EVALUATION_REPORT.md`.

It predicts the **visual soil type only**
(alluvial / வண்டல் மண், black / கருமண், laterite / லேட்டரைட் மண்,
red / செம்மண்). It does not measure pH, nutrients or texture.
