"""LASSO inference and retraining helpers for WeeWare."""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import shutil
import threading
from typing import Any
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import Lasso, LassoCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from climate import FEATURES, TRAINING_CSV, TRAINING_COLUMNS

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "lasso_weevil_model.joblib"
FEATURE_COLUMNS = ["rainfall", "temperature", "humidity", "solar", "wind"]
TARGET_COLUMN = "infestation_rate"
# With the current 0–5 target scale, alpha values above this can shrink every
# climate coefficient to zero on the small annual dataset. Keep automatic LASSO
# selection input-sensitive instead of silently turning it into a mean model.
AUTO_NONZERO_ALPHA = 0.05
_COLUMN_PREFERENCE = {
    "year": ["year", "solarrad"],
    "rainfall": ["total(mm)", "rainfall"],
    "temperature": ["ann(*c)", "ann(c)", "temperature"],
    "humidity": ["ann(%)", "humidity"],
    "solar": ["ann(mj/m^2/d)", "ann(mj/m2/d)", "solar"],
    "wind": ["ann(m/s)", "windspeed", "wind"],
    TARGET_COLUMN: ["total(%)", "infestation_rate", "infestationrate", "infestation"],
}
EXPERIMENTS_DIR = ROOT / "model_experiments"
TRAINING_STATUS: dict[str, Any] = {"state": "idle", "stage": "idle", "progress": 0, "message": "Ready for a training run.", "run_id": None, "started_at": None, "updated_at": None}
_TRAINING_LOCK = threading.Lock()


def _set_training_status(state: str, stage: str, progress: int, message: str, run_id: str | None = None) -> None:
    now = pd.Timestamp.now(tz="UTC").isoformat()
    previous_state = TRAINING_STATUS.get("state")
    TRAINING_STATUS.update({"state": state, "stage": stage, "progress": progress, "message": message, "run_id": run_id or TRAINING_STATUS.get("run_id"), "updated_at": now})
    if state == "running" and previous_state != "running":
        TRAINING_STATUS["started_at"] = now


def training_status() -> dict[str, Any]:
    return dict(TRAINING_STATUS)


def _canonical_column(name: Any) -> str | None:
    value = str(name).strip().lower().replace("²", "2").replace("°", "")
    value = "".join(value.split())
    aliases = {
        "year": {"year", "solar rad"},
        "rainfall": {"rainfall", "total(mm)"},
        "temperature": {"temperature", "ann(*c)", "ann(c)"},
        "humidity": {"humidity", "ann(%)"},
        "solar": {"solar", "ann(mj/m^2/d)", "ann(mj/m2/d)"},
        "wind": {"wind", "ann(m/s)", "windspeed"},
        TARGET_COLUMN: {"infestation_rate", "infestationrate", "infestation", "total(%)"},
    }
    return next((canonical for canonical, names in aliases.items() if value in {"".join(alias.split()) for alias in names}), None)


def _prepare_training_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        raise ValueError("The uploaded workbook contains no training rows.")
    columns: dict[str, list[tuple[int, Any]]] = {}
    for column in frame.columns:
        canonical = _canonical_column(column)
        if canonical:
            normalized = "".join(str(column).strip().lower().split())
            preferred = _COLUMN_PREFERENCE[canonical]
            priority = preferred.index(normalized) if normalized in preferred else len(preferred)
            columns.setdefault(canonical, []).append((priority, column))
    required = ["year", *FEATURE_COLUMNS, TARGET_COLUMN]
    missing = [column for column in required if column not in columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}. Download the WeeWare Excel template for the required format.")
    # Source datasets can include a category heading (for example HUMIDITY) beside
    # its measurement column (ANN (%)). Prefer the explicit measurement column.
    selected = pd.DataFrame({name: frame[min(columns[name], key=lambda item: item[0])[1]] for name in required})
    location_column = next((column for column in frame.columns if str(column).strip().lower() in {"location", "municipality", "city"}), None)
    if location_column is not None:
        selected["location"] = frame[location_column].astype("string").str.strip()
    selected = selected.dropna(how="all")
    for column in required:
        selected[column] = pd.to_numeric(selected[column], errors="coerce")
    invalid = selected[required].isna().any(axis=1)
    if invalid.any():
        rows = (selected.index[invalid] + 2).tolist()[:8]
        raise ValueError(f"Rows {', '.join(map(str, rows))} contain missing or non-numeric values. Complete every data row or remove it.")
    if len(selected) < 6:
        raise ValueError("At least six complete annual rows are required for training and leave-one-year-out validation.")
    if len(selected) > 5000:
        raise ValueError("A training workbook may contain at most 5,000 annual rows.")
    selected["year"] = selected["year"].astype(int)
    if (selected["year"] < 1900).any() or (selected["year"] > 2100).any():
        raise ValueError("Year values must be between 1900 and 2100.")
    if "location" in selected:
        if selected["location"].isna().any() or selected["location"].eq("").any():
            raise ValueError("Every row in a location-based training dataset needs a location name.")
        duplicate_mask = selected.duplicated(["location", "year"], keep=False)
        if duplicate_mask.any():
            duplicates = selected.loc[duplicate_mask, ["location", "year"]].drop_duplicates().astype(str)
            examples = [f"{row.location} ({row.year})" for row in duplicates.itertuples(index=False)]
            raise ValueError(f"Each location/year pair must appear once. Duplicates: {', '.join(examples[:8])}.")
    elif selected["year"].duplicated().any():
        duplicate_years = selected.loc[selected["year"].duplicated(keep=False), "year"].astype(str).unique().tolist()
        raise ValueError(f"Repeated years require a location column. Duplicate years: {', '.join(duplicate_years[:8])}.")
    if selected[TARGET_COLUMN].lt(0).any() or selected[TARGET_COLUMN].gt(100).any():
        raise ValueError("Infestation rate must be between 0 and 100 percent.")
    if not np.isfinite(selected[[*FEATURE_COLUMNS, TARGET_COLUMN]].to_numpy(dtype=float)).all():
        raise ValueError("Training values must be finite numbers.")
    return selected.sort_values(["year", "location"] if "location" in selected else ["year"]).reset_index(drop=True)


def preview_dataset(dataset_bytes: bytes, filename: str = "training.xlsx") -> dict[str, Any]:
    if not dataset_bytes:
        raise ValueError("Choose an Excel workbook or CSV file to preview.")
    try:
        frame = pd.read_csv(BytesIO(dataset_bytes)) if Path(filename).suffix.lower() == ".csv" else pd.read_excel(BytesIO(dataset_bytes), sheet_name=0, engine="openpyxl")
    except Exception as exc:
        raise ValueError("The dataset could not be opened. Upload a valid .xlsx workbook or .csv file using the WeeWare template columns.") from exc
    values = _prepare_training_frame(frame)
    summary = {column: {"min": round(float(values[column].min()), 4), "max": round(float(values[column].max()), 4), "mean": round(float(values[column].mean()), 4)} for column in [*FEATURE_COLUMNS, TARGET_COLUMN]}
    columns = (["location"] if "location" in values else []) + ["year", *FEATURE_COLUMNS, TARGET_COLUMN]
    return {"filename": Path(filename).name[:160], "rows": len(values), "locations": int(values.location.nunique()) if "location" in values else None, "years": int(values.year.nunique()), "year_start": int(values.year.min()), "year_end": int(values.year.max()), "columns": columns, "summary": summary, "preview": values.head(8).to_dict(orient="records")}


def _validated_config(config: dict[str, Any] | None) -> dict[str, Any]:
    config = config or {}
    alpha_mode = str(config.get("alpha_mode", "auto"))
    if alpha_mode not in {"auto", "fixed"}:
        raise ValueError("Alpha mode must be auto or fixed.")
    prediction_config = config.get("prediction") if isinstance(config.get("prediction"), dict) else {}
    try:
        alpha = float(config.get("alpha", 0.1))
        cv_folds = int(config.get("cv_folds", 5))
        max_iter = int(config.get("max_iter", 100_000))
        selected_features = config.get("features", FEATURE_COLUMNS)
        if not isinstance(selected_features, list) or not selected_features or any(feature not in FEATURE_COLUMNS for feature in selected_features) or len(set(selected_features)) != len(selected_features):
            raise ValueError("Choose one or more unique LASSO features from the five available climate variables.")
        output_min = float(prediction_config.get("min", config.get("output_min", 0)))
        output_max = float(prediction_config.get("max", config.get("output_max", 5)))
        low_threshold = float(prediction_config.get("low_threshold", config.get("low_threshold", 1.5)))
        high_threshold = float(prediction_config.get("high_threshold", config.get("high_threshold", 3)))
    except (TypeError, ValueError) as exc:
        raise ValueError("Model configuration values must be valid numbers.") from exc
    fit_intercept = config.get("fit_intercept", True)
    if not isinstance(fit_intercept, bool):
        raise ValueError("Fit intercept must be true or false.")
    if not np.isfinite(alpha) or alpha <= 0 or alpha > 100_000:
        raise ValueError("Alpha must be greater than 0 and no more than 100,000.")
    if not 2 <= cv_folds <= 10:
        raise ValueError("Cross-validation folds must be between 2 and 10.")
    if not 1000 <= max_iter <= 1_000_000:
        raise ValueError("Maximum iterations must be between 1,000 and 1,000,000.")
    if not (0 <= output_min < output_max <= 100 and output_min <= low_threshold < high_threshold <= output_max):
        raise ValueError("Prediction scale and risk thresholds must be ordered between 0 and 100.")
    return {"alpha_mode": alpha_mode, "alpha": alpha, "cv_folds": cv_folds, "max_iter": max_iter, "fit_intercept": fit_intercept, "features": selected_features, "prediction": {"min": output_min, "max": output_max, "low_threshold": low_threshold, "high_threshold": high_threshold}}


def _fit_experiment(values: pd.DataFrame, config: dict[str, Any], run_id: str) -> tuple[Pipeline, dict[str, Any]]:
    year_groups = values["year"].to_numpy()
    unique_years = np.unique(year_groups)
    inner_folds = min(config["cv_folds"], len(unique_years) - 1)
    features = config["features"]
    def make_pipeline():
        estimator = LassoCV(cv=inner_folds, max_iter=config["max_iter"], fit_intercept=config["fit_intercept"], random_state=42) if config["alpha_mode"] == "auto" else Lasso(alpha=config["alpha"], max_iter=config["max_iter"], fit_intercept=config["fit_intercept"])
        return Pipeline([("scaler", StandardScaler()), ("lasso", estimator)])

    selection_notes: set[str] = set()

    def fit_pipeline(x: pd.DataFrame, target: pd.Series | np.ndarray) -> Pipeline:
        fitted = make_pipeline()
        fitted.fit(x, target)
        coefficients = np.asarray(fitted.named_steps["lasso"].coef_, dtype=float)
        if config["alpha_mode"] == "auto" and not np.any(np.abs(coefficients) > 1e-10):
            # LassoCV can prefer the intercept-only solution on twelve annual
            # observations. Retry at a lower, bounded penalty so forecasts use
            # climate inputs; if that still produces zero weights, fail loudly.
            fitted = Pipeline([
                ("scaler", StandardScaler()),
                ("lasso", Lasso(alpha=AUTO_NONZERO_ALPHA, max_iter=config["max_iter"], fit_intercept=config["fit_intercept"])),
            ])
            fitted.fit(x, target)
            coefficients = np.asarray(fitted.named_steps["lasso"].coef_, dtype=float)
            if not np.any(np.abs(coefficients) > 1e-10):
                raise ValueError("LASSO could not learn any climate-variable effects from this dataset. Add more informative annual training rows before deploying it.")
            selection_notes.add(f"Automatic LASSO used alpha {AUTO_NONZERO_ALPHA:g} after cross-validation selected an intercept-only model.")
        elif not np.any(np.abs(coefficients) > 1e-10):
            raise ValueError("The selected fixed alpha makes every climate coefficient zero. Lower alpha or add more informative training data; an intercept-only model cannot be deployed.")
        return fitted
    _set_training_status("running", "fitting", 25, "Fitting the scaled LASSO model.", run_id)
    x = values[features]
    y = values[TARGET_COLUMN].to_numpy(dtype=float)
    pipeline = fit_pipeline(x, y)
    training_predictions = pipeline.predict(x)
    training_errors = training_predictions - y
    _set_training_status("running", "validating", 50, "Running leave-one-year-out validation.", run_id)
    validation_predictions = []
    baseline_predictions = []
    for index, holdout_year in enumerate(unique_years):
        train_mask = year_groups != holdout_year
        holdout_mask = ~train_mask
        cv_pipeline = fit_pipeline(values.loc[train_mask, features], values.loc[train_mask, TARGET_COLUMN])
        validation_predictions.extend(cv_pipeline.predict(values.loc[holdout_mask, features]).astype(float).tolist())
        baseline_predictions.extend([float(np.mean(y[train_mask]))] * int(holdout_mask.sum()))
        _set_training_status("running", "validating", 50 + int(40 * (index + 1) / len(unique_years)), f"Validating held-out year {index + 1} of {len(unique_years)}.", run_id)
    errors = np.asarray(validation_predictions) - y
    metrics = {
        "training_mae": float(np.mean(np.abs(training_errors))),
        "training_rmse": float(np.sqrt(np.mean(training_errors ** 2))),
        "validation": {"method": "leave-one-year-out", "mae": float(np.mean(np.abs(errors))), "rmse": float(np.sqrt(np.mean(errors ** 2))), "baseline_mae": float(np.mean(np.abs(np.asarray(baseline_predictions) - y))), "baseline_rmse": float(np.sqrt(np.mean((np.asarray(baseline_predictions) - y) ** 2))), "predictions": [round(value, 6) for value in validation_predictions], "observed": [float(value) for value in y], "years": values.year.astype(int).tolist(), "note": "All locations for each year are held out together; validation rows are compared with a training-mean baseline."},
    }
    if "location" in values and values.location.nunique() >= 3:
        location_predictions, location_baseline, location_observed = [], [], []
        locations = values.location.unique()
        for index, holdout_location in enumerate(locations):
            train_mask = values.location.to_numpy() != holdout_location
            holdout_mask = ~train_mask
            cv_pipeline = fit_pipeline(values.loc[train_mask, features], values.loc[train_mask, TARGET_COLUMN])
            location_predictions.extend(cv_pipeline.predict(values.loc[holdout_mask, features]).astype(float).tolist())
            location_baseline.extend([float(np.mean(y[train_mask]))] * int(holdout_mask.sum()))
            location_observed.extend(y[holdout_mask].astype(float).tolist())
            _set_training_status("running", "validating", 90 + int(4 * (index + 1) / len(locations)), f"Validating held-out location {index + 1} of {len(locations)}.", run_id)
        spatial_errors = np.asarray(location_predictions) - np.asarray(location_observed)
        spatial_baseline_errors = np.asarray(location_baseline) - np.asarray(location_observed)
        metrics["spatial_validation"] = {"method": "leave-one-location-out", "locations": int(len(locations)), "mae": float(np.mean(np.abs(spatial_errors))), "rmse": float(np.sqrt(np.mean(spatial_errors ** 2))), "baseline_mae": float(np.mean(np.abs(spatial_baseline_errors))), "baseline_rmse": float(np.sqrt(np.mean(spatial_baseline_errors ** 2))), "note": "Each municipality is held out completely; this estimates transfer to locations absent from training."}
    metrics["selection_note"] = "; ".join(sorted(selection_notes)) if selection_notes else "Cross-validation selected a model with non-zero climate coefficients."
    return pipeline, metrics


def train_dataset(dataset_bytes: bytes, filename: str, config: dict[str, Any] | None = None, uploaded_by: str | None = None) -> dict[str, Any]:
    if not _TRAINING_LOCK.acquire(blocking=False):
        raise ValueError("A model training run is already in progress.")
    run_id = uuid4().hex
    try:
        _set_training_status("running", "validating", 5, "Validating the uploaded training workbook.", run_id)
        parsed = preview_dataset(dataset_bytes, filename)
        frame = pd.read_csv(BytesIO(dataset_bytes)) if Path(filename).suffix.lower() == ".csv" else pd.read_excel(BytesIO(dataset_bytes), sheet_name=0, engine="openpyxl")
        values = _prepare_training_frame(frame)
        settings = _validated_config(config)
        if float(values[TARGET_COLUMN].max()) > settings["prediction"]["max"]:
            settings["prediction"]["max"] = 100.0
            settings["prediction"]["low_threshold"] = 33.0
            settings["prediction"]["high_threshold"] = 66.0
        pipeline, metrics = _fit_experiment(values, settings, run_id)
        experiment_dir = EXPERIMENTS_DIR / run_id
        experiment_dir.mkdir(parents=True, exist_ok=False)
        dataset_name = Path(filename).name[:160]
        dataset_suffix = ".csv" if Path(filename).suffix.lower() == ".csv" else ".xlsx"
        (experiment_dir / f"dataset{dataset_suffix}").write_bytes(dataset_bytes)
        fitted_lasso = pipeline.named_steps["lasso"]
        alpha = float(getattr(fitted_lasso, "alpha_", fitted_lasso.alpha))
        artifact_path = experiment_dir / "model.joblib"
        validation = metrics["validation"]
        confidence_note = f"{metrics['selection_note']} Leave-one-year-out MAE: {validation['mae']:.3f}; historical-mean baseline MAE: {validation['baseline_mae']:.3f}. No calibrated confidence interval is available."
        if metrics.get("spatial_validation"):
            spatial = metrics["spatial_validation"]
            confidence_note += f" Leave-one-location-out MAE: {spatial['mae']:.3f} versus baseline {spatial['baseline_mae']:.3f}; spatial transfer remains exploratory."
        location_count = int(values.location.nunique()) if "location" in values else 1
        payload = {"pipeline": pipeline, "features": settings["features"], "model_type": "LASSO Regression", "training_period": f"{parsed['year_start']}-{parsed['year_end']} ({values.year.nunique()} years, {location_count} locations)", "alpha": alpha, "coefficients": pipeline.named_steps["lasso"].coef_.tolist(), "intercept": float(pipeline.named_steps["lasso"].intercept_), "scaler_mean": pipeline.named_steps["scaler"].mean_.tolist(), "scaler_std": pipeline.named_steps["scaler"].scale_.tolist(), "samples": len(values), "config": settings, "experiment_id": run_id, "validation": validation, "spatial_validation": metrics.get("spatial_validation"), "selection_note": metrics["selection_note"], "confidence_note": confidence_note, "training_mae": metrics["training_mae"], "training_rmse": metrics["training_rmse"], "retrained_at": pd.Timestamp.now(tz="UTC").isoformat()}
        _set_training_status("running", "saving", 94, "Saving and activating the new production model.", run_id)
        joblib.dump(payload, artifact_path)
        metadata = {"id": run_id, "state": "completed", "filename": dataset_name, "rows": len(values), "year_start": parsed["year_start"], "year_end": parsed["year_end"], "uploaded_by": uploaded_by, "created_at": payload["retrained_at"], "config": settings, "alpha": alpha, "training_mae": metrics["training_mae"], "training_rmse": metrics["training_rmse"], "validation": metrics["validation"], "spatial_validation": metrics.get("spatial_validation"), "selection_note": metrics["selection_note"], "active": False}
        (experiment_dir / "experiment.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        _activate_artifact(artifact_path)
        load_model.cache_clear()
        _set_training_status("completed", "completed", 100, "Retraining completed. The new LASSO model is now serving predictions.", run_id)
        return {**metadata, "active": True}
    except Exception as exc:
        _set_training_status("failed", "failed", 100, str(exc)[:300], run_id)
        raise
    finally:
        _TRAINING_LOCK.release()


def list_experiments() -> list[dict[str, Any]]:
    experiments = []
    active_id = None
    if MODEL_PATH.exists():
        try:
            active_id = load_model().get("experiment_id")
        except Exception:
            pass
    if EXPERIMENTS_DIR.exists():
        for meta_path in EXPERIMENTS_DIR.glob("*/experiment.json"):
            try:
                item = json.loads(meta_path.read_text(encoding="utf-8"))
                item["active"] = item.get("id") == active_id
                experiments.append(item)
            except (OSError, json.JSONDecodeError):
                continue
    return sorted(experiments, key=lambda item: item.get("created_at", ""), reverse=True)


def activate_experiment(experiment_id: str) -> dict[str, Any]:
    if not _TRAINING_LOCK.acquire(blocking=False):
        raise ValueError("An experiment cannot be activated while training is in progress.")
    try:
        artifact_path = EXPERIMENTS_DIR / experiment_id / "model.joblib"
        meta_path = EXPERIMENTS_DIR / experiment_id / "experiment.json"
        if not artifact_path.is_file() or not meta_path.is_file():
            raise FileNotFoundError("The selected experiment was not found.")
        _activate_artifact(artifact_path)
        load_model.cache_clear()
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        return {**metadata, "active": True}
    finally:
        _TRAINING_LOCK.release()


def _activate_artifact(artifact_path: Path) -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = MODEL_PATH.with_suffix(".joblib.tmp")
    shutil.copy2(artifact_path, temporary)
    temporary.replace(MODEL_PATH)


def delete_experiment(experiment_id: str) -> None:
    metadata_path = EXPERIMENTS_DIR / experiment_id / "experiment.json"
    artifact_path = EXPERIMENTS_DIR / experiment_id / "model.joblib"
    if not metadata_path.is_file():
        raise FileNotFoundError("The selected experiment was not found.")
    try:
        if MODEL_PATH.exists() and load_model().get("experiment_id") == experiment_id:
            raise ValueError("The active experiment cannot be deleted. Activate another experiment first.")
    except FileNotFoundError:
        pass
    shutil.rmtree(metadata_path.parent)


def experiment_dataset(experiment_id: str) -> Path:
    experiment_dir = EXPERIMENTS_DIR / experiment_id
    dataset_path = next((candidate for candidate in (experiment_dir / "dataset.xlsx", experiment_dir / "dataset.csv") if candidate.is_file()), experiment_dir / "dataset.xlsx")
    if not dataset_path.is_file():
        raise FileNotFoundError("The saved experiment dataset was not found.")
    return dataset_path


@lru_cache(maxsize=1)
def load_model() -> Any:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Trained model is missing: {MODEL_PATH}")
    return joblib.load(MODEL_PATH)


def infer(weather: dict[str, float]) -> dict[str, Any]:
    payload = load_model()
    estimator = payload.get("pipeline") if isinstance(payload, dict) else payload
    features = payload.get("features", FEATURE_COLUMNS) if isinstance(payload, dict) else FEATURE_COLUMNS
    if estimator is None or not hasattr(estimator, "predict"):
        raise ValueError("The saved model artifact does not contain a fitted prediction pipeline.")
    coefficients = np.asarray(getattr(estimator.steps[-1][1] if isinstance(estimator, Pipeline) else estimator, "coef_", []), dtype=float)
    if coefficients.size == 0 or not np.any(np.abs(coefficients) > 1e-10):
        raise ValueError("The active LASSO model has no learned climate effects and would return a constant training mean for every request. Retrain with informative data before generating predictions.")
    vector = np.asarray([[float(weather[name]) for name in features]], dtype=float)
    raw = float(np.asarray(estimator.predict(vector)).reshape(-1)[0])
    config = payload.get("config", {}) if isinstance(payload, dict) else {}
    prediction_config = config.get("prediction", {})
    output_min = float(prediction_config.get("min", 0))
    output_max = float(prediction_config.get("max", 5))
    low_threshold = float(prediction_config.get("low_threshold", 1.5))
    high_threshold = float(prediction_config.get("high_threshold", 3.0))
    rate = min(output_max, max(output_min, raw))
    risk = "Low" if rate < low_threshold else "Medium" if rate < high_threshold else "High"
    action = {
        "Low": "Continue checking mango trees and fruit throughout the fruiting period. Record unusual fruit drop or visible damage, collect fallen fruit promptly, and recheck suspect fruit so changes can be compared over time.",
        "Medium": "Increase orchard checks during fruiting and record unusual fruit drop. Cut open suspect fruit to look for internal tunnels or larvae, remove fallen or suspect fruit, and message the WeeWare DA account through Messages for locally appropriate next steps.",
        "High": "Arrange a prompt field inspection. Mango pulp weevil damage can be hidden inside fruit, so cut open suspect fruit, collect and safely dispose of fallen or infested fruit, and message the WeeWare DA account through Messages for identification and a locally approved response.",
    }[risk]
    measurements = {
        "Low": [
            "Inspect fruit and fallen fruit regularly for damage.",
            "Collect fallen fruit and remove suspected infested fruit from the orchard.",
            "Record fruit drop and observed damage for follow-up.",
        ],
        "Medium": [
            "Increase orchard checks during fruiting and note unusual fruit drop.",
            "Cut open suspect fruit to check for internal tunnels or larvae.",
            "Remove and safely dispose of fallen or suspected infested fruit.",
        ],
        "High": [
            "Inspect suspect fruit internally because the outside may look normal.",
            "Promptly collect and securely dispose of fallen and suspected infested fruit.",
            "Message the WeeWare DA account through Messages for identification and locally approved control.",
        ],
    }[risk]
    return {
        "rate": round(rate, 2),
        "raw_rate": raw,
        "risk": risk,
        "confidence": None,
        "action": action,
        "action_key": action,
        "measurement_keys": measurements,
        "severity_score": max(1, min(100, int(round(100 * (rate - output_min) / (output_max - output_min))))),
        "output_min": output_min,
        "output_max": output_max,
        "model_type": "LASSO Regression",
        "training_period": payload.get("training_period", "2014–2025 (12 annual observations)") if isinstance(payload, dict) else "2014–2025",
        "weather": {name: float(weather[name]) for name in features},
        "confidence_note": payload.get("confidence_note") or payload.get("selection_note") or "The prediction uses learned climate coefficients. No calibrated probability/confidence interval is available; review the annual backtest before relying on this estimate.",
    }


def info() -> dict[str, Any]:
    payload = load_model()
    model = payload.get("pipeline") if isinstance(payload, dict) else payload
    features = payload.get("features", FEATURE_COLUMNS) if isinstance(payload, dict) else FEATURE_COLUMNS
    estimator = model.steps[-1][1] if isinstance(model, Pipeline) else model
    scaler = next((step for _, step in model.steps if isinstance(step, StandardScaler)), None) if isinstance(model, Pipeline) else None
    stored_coefficients = payload.get("coefficients") if isinstance(payload, dict) else None
    stored_intercept = payload.get("intercept") if isinstance(payload, dict) else None
    stored_mean = payload.get("scaler_mean") if isinstance(payload, dict) else None
    stored_scale = payload.get("scaler_std") if isinstance(payload, dict) else None
    coefficients = np.asarray(getattr(estimator, "coef_", []), dtype=float).reshape(-1)
    return {
        "model_type": "LASSO Regression",
        "features": features,
        "training_period": payload.get("training_period", "2014–2025") if isinstance(payload, dict) else "2014–2025",
        "alpha": float(payload.get("alpha", getattr(estimator, "alpha_", getattr(estimator, "alpha", 0.1)))) if isinstance(payload, dict) else float(getattr(estimator, "alpha_", getattr(estimator, "alpha", 0.1))),
        "intercept": float(stored_intercept if stored_intercept is not None else np.asarray(getattr(estimator, "intercept_", 0.0)).reshape(-1)[0]),
        "coefficients": {name: float(value) for name, value in zip(features, stored_coefficients)} if stored_coefficients else {name: float(coefficients[index]) for index, name in enumerate(features) if index < len(coefficients)},
        "scaler_mean": [float(x) for x in (stored_mean or (scaler.mean_ if scaler is not None and hasattr(scaler, "mean_") else []))] or None,
        "scaler_scale": [float(x) for x in (stored_scale or (scaler.scale_ if scaler is not None and hasattr(scaler, "scale_") else []))] or None,
        "model_file": MODEL_PATH.name,
        "samples": payload.get("samples") if isinstance(payload, dict) else None,
        "experiment_id": payload.get("experiment_id") if isinstance(payload, dict) else None,
        "selection_note": payload.get("selection_note") if isinstance(payload, dict) else None,
        "config": payload.get("config", {}) if isinstance(payload, dict) else {},
        "retrained_at": payload.get("retrained_at") if isinstance(payload, dict) else None,
        "training_mae": payload.get("training_mae") if isinstance(payload, dict) else None,
        "training_rmse": payload.get("training_rmse") if isinstance(payload, dict) else None,
        "validation": payload.get("validation", {"method": "leave-one-year-out and forward holdout", "note": "Backtest did not outperform the historical-mean baseline; see docs/model-validation.md."}) if isinstance(payload, dict) else {"method": "leave-one-year-out and forward holdout", "note": "Backtest did not outperform the historical-mean baseline; see docs/model-validation.md."},
        "spatial_validation": payload.get("spatial_validation") if isinstance(payload, dict) else None,
    }


def train() -> dict[str, Any]:
    if not TRAINING_CSV.exists():
        raise FileNotFoundError(f"Training data is missing: {TRAINING_CSV}")
    frame = pd.read_csv(TRAINING_CSV)
    if not set(TRAINING_COLUMNS.values()).issubset(frame.columns):
        raise ValueError("Training CSV is missing the expected named annual research columns.")
    values = pd.DataFrame({
        "year": frame[TRAINING_COLUMNS["year"]],
        "solar": frame[TRAINING_COLUMNS["solar"]],
        "humidity": frame[TRAINING_COLUMNS["humidity"]],
        "wind": frame[TRAINING_COLUMNS["wind"]],
        "temperature": frame[TRAINING_COLUMNS["temperature"]],
        "rainfall": frame[TRAINING_COLUMNS["rainfall"]],
        "infestation_rate": frame[TRAINING_COLUMNS["infestation"]],
    }).apply(pd.to_numeric, errors="coerce").dropna()
    if len(values) < 5:
        raise ValueError("At least five complete annual rows are required to retrain the model.")
    values = values.sort_values("year").drop_duplicates("year", keep="first").reset_index(drop=True)
    if MODEL_PATH.exists():
        backup_path = MODEL_PATH.with_name("lasso_weevil_model.pre-retrain.joblib")
        if not backup_path.exists():
            shutil.copy2(MODEL_PATH, backup_path)
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("lasso", LassoCV(cv=5, max_iter=100_000, random_state=42)),
    ])
    pipeline.fit(values[FEATURE_COLUMNS], values["infestation_rate"])
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    training_predictions = pipeline.predict(values[FEATURE_COLUMNS])
    training_residuals = training_predictions - values["infestation_rate"].to_numpy()
    cv_predictions = []
    for holdout in range(len(values)):
        train_mask = np.arange(len(values)) != holdout
        cv_pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("lasso", LassoCV(cv=LeaveOneOut(), max_iter=100_000, random_state=42)),
        ])
        cv_pipeline.fit(values.loc[train_mask, FEATURE_COLUMNS], values.loc[train_mask, "infestation_rate"])
        cv_predictions.append(float(cv_pipeline.predict(values.loc[[holdout], FEATURE_COLUMNS])[0]))
    cv_errors = np.asarray(cv_predictions) - values["infestation_rate"].to_numpy()
    joblib.dump({"pipeline": pipeline, "features": FEATURE_COLUMNS, "model_type": "LASSO Regression", "training_period": f"{int(values.year.min())}-{int(values.year.max())} ({len(values)} years)", "alpha": float(pipeline.named_steps["lasso"].alpha_), "coefficients": pipeline.named_steps["lasso"].coef_.tolist(), "intercept": float(pipeline.named_steps["lasso"].intercept_), "scaler_mean": pipeline.named_steps["scaler"].mean_.tolist(), "scaler_std": pipeline.named_steps["scaler"].scale_.tolist(), "samples": int(len(values)), "training_mae": float(np.mean(np.abs(training_residuals))), "training_rmse": float(np.sqrt(np.mean(training_residuals ** 2))), "validation": {"method": "leave-one-year-out", "mae": float(np.mean(np.abs(cv_errors))), "rmse": float(np.sqrt(np.mean(cv_errors ** 2))), "note": "Validation is out of sample; see docs/model-validation.md."}, "retrained_at": pd.Timestamp.now(tz="UTC").isoformat()}, MODEL_PATH)
    load_model.cache_clear()
    return {"samples": int(len(values)), "alpha": float(pipeline.named_steps["lasso"].alpha_), "model_file": MODEL_PATH.name, "backup_file": backup_path.name if backup_path.exists() else None, "training_mae": float(np.mean(np.abs(training_residuals))), "training_rmse": float(np.sqrt(np.mean(training_residuals ** 2)))}

