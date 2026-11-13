# Held-out risk-class confusion matrix

Generated from the active experiment's leave-one-year-out predictions using the deployed risk thresholds: Low <33%, Medium 33–<66%, High >=66%. Rows are observed classes and columns are predicted classes.

Run `python scripts/compute_confusion_matrix.py` to reproduce `confusion-matrix.json` and `confusion-matrix.csv` from the recorded held-out values. This evaluates risk categorization, not continuous-rate accuracy; read it with MAE/RMSE in [model-validation.md](../../docs/model-validation.md).

