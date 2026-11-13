"""Run isolated Weka regression evaluations for researcher datasets."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import pandas as pd

import model

ROOT = Path(__file__).resolve().parent
WEKA_LIB = Path(os.environ.get("WEKA_LIB_DIR", ROOT / ".cache" / "weka"))
WEKA_CLASSIFIERS = {
    "random_forest": ("weka.classifiers.trees.RandomForest", "Random Forest"),
    "m5p": ("weka.classifiers.trees.M5P", "M5P Model Tree"),
    "linear_regression": ("weka.classifiers.functions.LinearRegression", "Linear Regression"),
}


def runtime_status() -> dict:
    java = os.environ.get("WEKA_JAVA") or shutil.which("java")
    jars = list(WEKA_LIB.glob("*.jar")) if WEKA_LIB.is_dir() else []
    weka_jar = next((jar for jar in jars if jar.name.startswith("weka-stable-")), None)
    has_weka = weka_jar is not None
    return {
        "available": bool(java and has_weka),
        "version": re.search(r"weka-stable-(.+)\.jar$", weka_jar.name).group(1) if has_weka else None,
        "java": java,
        "setup_required": not bool(java and has_weka),
    }


def _arff_quote(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'"


def _write_arff(values: pd.DataFrame, destination: Path) -> None:
    # Keep the target and numeric predictors shared with WeeWare's validated
    # training template; year is retained as a predictor for model comparison.
    features = ["year", *model.FEATURE_COLUMNS]
    with destination.open("w", encoding="utf-8", newline="\n") as output:
        output.write("@relation weeware_research\n\n")
        for feature in features:
            output.write(f"@attribute {feature} numeric\n")
        output.write(f"@attribute {model.TARGET_COLUMN} numeric\n\n@data\n")
        for row in values[[*features, model.TARGET_COLUMN]].itertuples(index=False, name=None):
            output.write(",".join(str(float(item)) for item in row) + "\n")


def _metric(output: str, label: str) -> float:
    section = output.split("=== Cross-validation ===", 1)[-1]
    match = re.search(rf"^{re.escape(label)}\s+([-+\d.eE]+)", section, re.MULTILINE)
    if not match:
        raise RuntimeError(f"Weka did not return the {label.lower()} cross-validation metric.")
    return float(match.group(1))


def _predictions(output: str) -> list[dict]:
    section = output.split("=== Predictions under cross-validation ===", 1)
    if len(section) != 2:
        raise RuntimeError("Weka did not return cross-validation predictions.")
    predictions = []
    numeric = r"([-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?)"
    row_pattern = re.compile(rf"^\s*\d+\s*,\s*{numeric}\s*,\s*{numeric}\s*,\s*{numeric}\s*$")
    for line in section[1].splitlines():
        match = row_pattern.match(line)
        if not match:
            continue
        actual, predicted, _error = (float(value) for value in match.groups())
        predictions.append({"row": len(predictions) + 1, "actual": actual, "predicted": predicted, "absolute_error": abs(actual - predicted)})
    return predictions


def _risk_band(rate: float, low_threshold: float, high_threshold: float) -> str:
    bounded = min(100.0, max(0.0, rate))
    if bounded < low_threshold:
        return "Low"
    if bounded < high_threshold:
        return "Medium"
    return "High"


def _risk_evaluation(predictions: list[dict], low_threshold: float, high_threshold: float) -> dict:
    classes = ["Low", "Medium", "High"]
    matrix = [[0 for _ in classes] for _ in classes]
    for item in predictions:
        actual = _risk_band(item["actual"], low_threshold, high_threshold)
        predicted = _risk_band(item["predicted"], low_threshold, high_threshold)
        item["actual_risk"] = actual
        item["predicted_risk"] = predicted
        matrix[classes.index(actual)][classes.index(predicted)] += 1
    total = sum(map(sum, matrix))
    correct = sum(matrix[index][index] for index in range(len(classes)))
    per_class = []
    for index, name in enumerate(classes):
        support = sum(matrix[index])
        predicted_count = sum(row[index] for row in matrix)
        precision = matrix[index][index] / predicted_count if predicted_count else 0.0
        recall = matrix[index][index] / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class.append({"name": name, "support": support, "precision": precision, "recall": recall, "f1": f1})
    return {"labels": classes, "matrix": matrix, "accuracy": correct / total if total else 0.0, "per_class": per_class, "thresholds": {"low": low_threshold, "high": high_threshold}}


def analyze_dataset(dataset_bytes: bytes, filename: str, algorithm: str, folds: int, low_threshold: float = 33, high_threshold: float = 66) -> dict:
    runtime = runtime_status()
    if not runtime["available"]:
        raise RuntimeError("Weka is not installed for the model service. Run scripts/setup-weka.ps1, then restart the ML service.")
    if algorithm not in WEKA_CLASSIFIERS:
        raise ValueError("Choose Random Forest, M5P Model Tree, or Linear Regression.")
    try:
        folds = int(folds)
    except (TypeError, ValueError) as exc:
        raise ValueError("Cross-validation folds must be a whole number from 2 to 10.") from exc
    try:
        frame = pd.read_csv(BytesIO(dataset_bytes)) if Path(filename).suffix.lower() == ".csv" else pd.read_excel(BytesIO(dataset_bytes), sheet_name=0, engine="openpyxl")
    except Exception as exc:
        raise ValueError("Upload a valid WeeWare .xlsx workbook or .csv file.") from exc
    values = model._prepare_training_frame(frame)
    if not 2 <= folds <= min(10, len(values)):
        raise ValueError(f"Choose between 2 and {min(10, len(values))} cross-validation folds.")
    try:
        low_threshold = float(low_threshold)
        high_threshold = float(high_threshold)
    except (TypeError, ValueError) as exc:
        raise ValueError("Risk thresholds must be valid numbers.") from exc
    if not (0 <= low_threshold < high_threshold <= 100):
        raise ValueError("Risk thresholds must be ordered between 0 and 100.")

    classifier, label = WEKA_CLASSIFIERS[algorithm]
    java = runtime["java"]
    classpath = str(WEKA_LIB / "*")
    with tempfile.TemporaryDirectory(prefix="weeware-weka-") as temp_dir:
        arff_path = Path(temp_dir) / "research-data.arff"
        _write_arff(values, arff_path)
        base_command = [java, "-cp", classpath, classifier, "-t", str(arff_path), "-x", str(folds), "-s", "42"]
        try:
            metrics_process = subprocess.run([*base_command, "-o"], capture_output=True, text=True, timeout=180, check=False)
            prediction_process = subprocess.run([*base_command, "-classifications", "weka.classifiers.evaluation.output.prediction.CSV"], capture_output=True, text=True, timeout=180, check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Weka analysis timed out. Try a smaller dataset or fewer folds.") from exc
        output = metrics_process.stdout + "\n" + metrics_process.stderr
        if metrics_process.returncode != 0 or prediction_process.returncode != 0:
            detail = (output + "\n" + prediction_process.stderr).strip().splitlines()
            raise RuntimeError((detail[0] if detail else "Weka could not evaluate this dataset.")[:300])
        predictions = _predictions(prediction_process.stdout + "\n" + prediction_process.stderr)
        if len(predictions) != len(values):
            raise RuntimeError("Weka returned an unexpected number of cross-validation predictions.")
        risk_evaluation = _risk_evaluation(predictions, low_threshold, high_threshold)

    return {
        "engine": "Weka",
        "version": runtime["version"],
        "algorithm": algorithm,
        "algorithm_label": label,
        "folds": folds,
        "rows": int(len(values)),
        "features": ["year", *model.FEATURE_COLUMNS],
        "metrics": {
            "correlation": _metric(output, "Correlation coefficient"),
            "mae": _metric(output, "Mean absolute error"),
            "rmse": _metric(output, "Root mean squared error"),
        },
        "risk_evaluation": risk_evaluation,
        "predictions": predictions,
        "validation": "Random-fold cross-validation",
        "note": "Risk bands are derived from the held-out infestation-rate predictions and configured thresholds. This research comparison does not replace the active LASSO model or its year/location holdout validation.",
    }
