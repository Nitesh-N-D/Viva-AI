# disease model folder

The app only runs a model from this folder when **all** of these exist and
validate (see `src/lib/inference/metadata.ts`):

- `metadata.json` with `"status": "validated"`, evaluation results and the training run
- `labels.json` (ordered class ids; must equal `metadata.labels`)
- `model.json` + weight shards (TF.js layers-model)

These files are produced by the Kaggle/Colab GPU notebooks in
`packages/ml-models/`. Never train locally.

## Current contents

The `model.json` and shards currently in this folder are **legacy
artifacts of unknown provenance**: there is no record of the dataset,
class order, preprocessing or test metrics used to make them, and the soil
and disease exports share byte-identical backbone shards. They load in
TF.js 4.22, but their outputs cannot be interpreted reliably, so
no `metadata.json` is provided for them and the app shows
**MODEL AWAITING CLOUD TRAINING**. They are excluded from the PWA precache.
