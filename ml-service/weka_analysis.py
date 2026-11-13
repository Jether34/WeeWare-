"""Run isolated Weka regression evaluations for researcher datasets."""
from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

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


def _render_3d_scatter(predictions: list[dict]) -> str:
    palette = {"Low": "#268654", "Medium": "#df9b31", "High": "#ce5f52"}
    actual = np.asarray([item["actual"] for item in predictions], dtype=float)
    predicted = np.asarray([item["predicted"] for item in predictions], dtype=float)
    absolute_error = np.asarray([item["absolute_error"] for item in predictions], dtype=float)
    maximum_rate = max(1.0, float(np.max(np.concatenate([actual, predicted]))) * 1.12)
    maximum_error = max(0.01, float(np.max(absolute_error)) * 1.1)
    colors = [palette.get(item["actual_risk"], "#17643d") for item in predictions]

    figure = Figure(figsize=(10.8, 5.7), dpi=150, facecolor="white")
    FigureCanvasAgg(figure)
    axis = figure.add_subplot(111, projection="3d")
    axis.scatter(actual, predicted, absolute_error, c=colors, s=38, edgecolors="white", linewidths=0.5, alpha=0.92, depthshade=True)
    ideal = np.linspace(0, maximum_rate, 60)
    axis.plot(ideal, ideal, np.zeros_like(ideal), color="#bd8a45", linewidth=1.7, linestyle="--")
    axis.set_xlim(0, maximum_rate)
    axis.set_ylim(0, maximum_rate)
    axis.set_zlim(0, maximum_error)
    axis.set_xlabel("Observed infestation rate (%)", labelpad=10, fontsize=9)
    axis.set_ylabel("Predicted infestation rate (%)", labelpad=10, fontsize=9)
    axis.set_zlabel("Absolute error (percentage points)", labelpad=8, fontsize=9)
    axis.set_title("Observed vs. predicted infestation rate", pad=16, fontsize=12, fontweight="bold", color="#174c35")
    axis.tick_params(labelsize=7, pad=1)
    axis.view_init(elev=24, azim=-56)
    axis.grid(True, alpha=0.3)
    legend_handles = [
        Line2D([0], [0], marker="o", color="none", markerfacecolor=palette["Low"], markeredgecolor="white", markersize=7, label="Actual Low risk"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor=palette["Medium"], markeredgecolor="white", markersize=7, label="Actual Medium risk"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor=palette["High"], markeredgecolor="white", markersize=7, label="Actual High risk"),
        Line2D([0], [0], color="#bd8a45", linestyle="--", linewidth=1.7, label="Perfect rate match (error = 0)"),
    ]
    axis.legend(handles=legend_handles, loc="upper left", bbox_to_anchor=(0.0, 0.98), fontsize=7, frameon=True, framealpha=0.95)
    figure.tight_layout(pad=1.5)
    output = BytesIO()
    figure.savefig(output, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    figure.clear()
    return base64.b64encode(output.getvalue()).decode("ascii")


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
        values = model._read_training_values(dataset_bytes, filename)
    except ValueError as exc:
        raise ValueError("Upload a valid WeeWare .xlsx workbook or .csv file. " + str(exc)) from exc
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

    feature_columns = ["year", *model.FEATURE_COLUMNS]
    data_summary = {
        "year_start": int(values["year"].min()),
        "year_end": int(values["year"].max()),
        "location_count": int(values["location"].nunique()) if "location" in values else None,
        "has_location_column": "location" in values,
        "target_min": float(values[model.TARGET_COLUMN].min()),
        "target_max": float(values[model.TARGET_COLUMN].max()),
        "feature_ranges": {name: {"min": float(values[name].min()), "max": float(values[name].max())} for name in feature_columns},
        "worksheet": values.attrs.get("source_sheet"),
    }
    return {
        "engine": "Weka",
        "version": runtime["version"],
        "filename": Path(filename).name,
        "algorithm": algorithm,
        "algorithm_label": label,
        "folds": folds,
        "rows": int(len(values)),
        "features": feature_columns,
        "data_summary": data_summary,
        "metrics": {
            "correlation": _metric(output, "Correlation coefficient"),
            "mae": _metric(output, "Mean absolute error"),
            "rmse": _metric(output, "Root mean squared error"),
        },
        "risk_evaluation": risk_evaluation,
        "predictions": predictions,
        "scatter_3d_png_base64": _render_3d_scatter(predictions),
        "validation": "Random-fold cross-validation",
        "note": "Risk bands are derived from the held-out infestation-rate predictions and configured thresholds. This research comparison does not replace the active LASSO model or its year/location holdout validation.",
    }
