"""Internal FastAPI service for climate extraction and LASSO predictions."""
from __future__ import annotations

import calendar
import json
import logging
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

import climate
import model
import weka_analysis

ROOT = Path(__file__).resolve().parent

app = FastAPI(title="WeeWare Climate and LASSO Service", version="2.0.0")
logger = logging.getLogger(__name__)


class PredictRequest(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    year: int | None = Field(default=None, ge=2014, le=2100)
    lat: float = Field(default=climate.LOCATION["lat"], ge=-90, le=90)
    lng: float = Field(default=climate.LOCATION["lng"], ge=-180, le=180)

    def prediction_window(self) -> tuple[date, date]:
        if self.start_date is not None or self.end_date is not None:
            if self.start_date is None or self.end_date is None:
                raise ValueError("Provide both start_date and end_date for the prediction window.")
            start, end = self.start_date, self.end_date
        elif self.year is not None:
            start, end = date(self.year, 1, 1), date(self.year, 12, 31) if not calendar.isleap(self.year) else date(self.year, 12, 30)
        else:
            raise ValueError("Provide a start_date and end_date for the 365-day prediction window.")
        if (end - start).days != 364:
            raise ValueError("The prediction window must contain exactly 365 days; choose an end date 364 days after the start date.")
        earliest = date(datetime.now().year, 1, 1)
        if start < earliest:
            raise ValueError("Choose a start date from January 1 of the current year onward.")
        return start, end


@app.get("/health")
def health():
    try:
        model.load_model()
        model_status = "loaded"
    except (FileNotFoundError, Exception) as exc:
        model_status = f"unavailable: {exc}"
    return {"status": "ok", "service": "weeware-ml", "model": model_status, "cmip6_files": len(list(climate.CLIMATE_DIR.glob("*.nc")))}


@app.get("/model/info")
def model_info():
    try:
        return model.info()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/train/status")
def training_status():
    return model.training_status()


@app.get("/weka/status")
def weka_status():
    return weka_analysis.runtime_status()


@app.get("/train/experiments")
def training_experiments():
    return {"experiments": model.list_experiments()}


@app.get("/train/template")
def training_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Training Data"
    headers = ["location", "year", "rainfall", "temperature", "humidity", "solar", "wind", "infestation_rate"]
    sheet.append(headers)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = "A1:H1"
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="17643D")
        cell.alignment = Alignment(horizontal="center")
    for column, width in zip("ABCDEFG", [14, 16, 18, 14, 14, 14, 20]):
        sheet.column_dimensions[column].width = width
    instructions = workbook.create_sheet("Instructions")
    instructions.append(["WeeWare LASSO training workbook"])
    instructions.append(["Use one annual observation per row on the Training Data sheet."])
    instructions.append(["Required columns: year, rainfall (mm/year), temperature (°C), humidity (%), solar (MJ/m²/day), wind (m/s), infestation_rate (0–100%). Add location when years repeat; each location/year pair must be unique."])
    instructions.append(["Infestation rate must be between 0 and 100 percent. Keep the target definition and units consistent across rows."])
    instructions.append(["Do not rename the required columns. Remove empty rows. At least six complete years are required."])
    instructions.column_dimensions["A"].width = 115
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=weeware-lasso-training-template.xlsx"})


async def _dataset_bytes(request: Request) -> tuple[bytes, str, dict]:
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Upload an Excel workbook or CSV file.")
    if len(body) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Training datasets must be 12 MB or smaller.")
    filename = Path(unquote(request.headers.get("x-dataset-name", "training.xlsx"))).name
    if Path(filename).suffix.lower() not in {".xlsx", ".csv"}:
        raise HTTPException(status_code=400, detail="Upload the WeeWare .xlsx template or a .csv file with the same column format.")
    try:
        config = json.loads(request.headers.get("x-model-config", "{}"))
        if not isinstance(config, dict):
            raise ValueError("Model settings must be an object.")
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Model settings are not valid JSON.") from exc
    return body, filename, config


@app.post("/train/preview")
async def preview_training_dataset(request: Request):
    dataset, filename, _ = await _dataset_bytes(request)
    try:
        return await run_in_threadpool(model.preview_dataset, dataset, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/weka/analyze")
async def analyze_with_weka(request: Request):
    dataset, filename, _ = await _dataset_bytes(request)
    algorithm = request.headers.get("x-weka-algorithm", "random_forest")
    folds = request.headers.get("x-weka-folds", "5")
    low_threshold = request.headers.get("x-weka-low-threshold", "33")
    high_threshold = request.headers.get("x-weka-high-threshold", "66")
    try:
        return await run_in_threadpool(weka_analysis.analyze_dataset, dataset, filename, algorithm, folds, low_threshold, high_threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        status = 503 if "not installed" in str(exc).lower() else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/weka/analyze/palawan")
async def analyze_prepared_palawan_with_weka(request: Request):
    dataset_path = ROOT.parent / "datasets" / "processed" / "climate_training" / "palawan_retraining_dataset.csv"
    if not dataset_path.is_file():
        raise HTTPException(status_code=404, detail="The prepared Palawan annual dataset is not installed.")
    algorithm = request.headers.get("x-weka-algorithm", "random_forest")
    folds = request.headers.get("x-weka-folds", "5")
    low_threshold = request.headers.get("x-weka-low-threshold", "33")
    high_threshold = request.headers.get("x-weka-high-threshold", "66")
    try:
        return await run_in_threadpool(weka_analysis.analyze_dataset, dataset_path.read_bytes(), dataset_path.name, algorithm, folds, low_threshold, high_threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        status = 503 if "not installed" in str(exc).lower() else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/weka/analyze/final-dataset")
async def analyze_weeware_final_dataset_with_weka(request: Request):
    dataset_path = ROOT.parent / "datasets" / "training" / "WEEWARE PAYNAL DEYTA SITS.xlsx"
    if not dataset_path.is_file():
        raise HTTPException(status_code=404, detail="WEEWARE PAYNAL DEYTA SITS.xlsx is not installed.")
    algorithm = request.headers.get("x-weka-algorithm", "random_forest")
    folds = request.headers.get("x-weka-folds", "5")
    low_threshold = request.headers.get("x-weka-low-threshold", "33")
    high_threshold = request.headers.get("x-weka-high-threshold", "66")
    try:
        return await run_in_threadpool(weka_analysis.analyze_dataset, dataset_path.read_bytes(), dataset_path.name, algorithm, folds, low_threshold, high_threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        status = 503 if "not installed" in str(exc).lower() else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/weka/export/xlsx")
async def export_weka_analysis_xlsx(request: Request):
    try:
        result = await request.json()
        if not isinstance(result, dict) or not isinstance(result.get("predictions"), list) or not isinstance(result.get("risk_evaluation"), dict):
            raise ValueError("A completed Weka evaluation is required.")
        metrics = result.get("metrics") or {}
        risk = result["risk_evaluation"]
        workbook = Workbook()
        summary = workbook.active
        summary.title = "Summary"
        summary.append(["Weka evaluation report", ""])
        summary.append(["Dataset", result.get("filename", "")])
        summary.append(["Algorithm", result.get("algorithm_label", result.get("algorithm", ""))])
        summary.append(["Engine version", f"{result.get('engine', 'Weka')} {result.get('version', '')}".strip()])
        summary.append(["Cross-validation", result.get("validation", "Random-fold cross-validation")])
        summary.append(["Folds", result.get("folds", "")])
        summary.append(["Rows", result.get("rows", len(result["predictions"]))])
        summary.append(["Features", ", ".join(result.get("features") or [])])
        summary.append(["MAE", metrics.get("mae", "")])
        summary.append(["RMSE", metrics.get("rmse", "")])
        summary.append(["Correlation", metrics.get("correlation", "")])
        summary.append(["Risk-band accuracy", risk.get("accuracy", "")])
        summary.append(["Low cutoff (%)", (risk.get("thresholds") or {}).get("low", "")])
        summary.append(["High cutoff (%)", (risk.get("thresholds") or {}).get("high", "")])
        matrix_sheet = workbook.create_sheet("Confusion Matrix")
        labels = risk.get("labels") or []
        matrix_sheet.append(["Actual / Predicted", *labels])
        for label, row in zip(labels, risk.get("matrix") or []):
            matrix_sheet.append([label, *row])
        matrix_sheet.append([])
        matrix_sheet.append(["Risk band", "Support", "Precision", "Recall", "F1"])
        for item in risk.get("per_class") or []:
            matrix_sheet.append([item.get("name"), item.get("support"), item.get("precision"), item.get("recall"), item.get("f1")])
        predictions = workbook.create_sheet("Predictions")
        predictions.append(["CV row", "Observed rate (%)", "Predicted rate (%)", "Absolute error", "Actual risk", "Predicted risk"])
        for item in result["predictions"]:
            predictions.append([item.get("row"), item.get("actual"), item.get("predicted"), item.get("absolute_error"), item.get("actual_risk"), item.get("predicted_risk")])
        for sheet in workbook.worksheets:
            sheet.freeze_panes = "A2"
            sheet.auto_filter.ref = sheet.dimensions
            for cell in sheet[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="17643D")
            for column in sheet.columns:
                letter = column[0].column_letter
                sheet.column_dimensions[letter].width = min(42, max(14, max(len(str(cell.value or "")) for cell in column) + 2))
        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=weka-analysis-report.xlsx"})
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Weka report data is invalid.") from exc


@app.post("/train")
async def train_model(request: Request):
    dataset, filename, config = await _dataset_bytes(request)
    config["alpha_mode"] = "fixed"
    config["alpha"] = model.AUTO_NONZERO_ALPHA
    uploaded_by = request.headers.get("x-researcher-id")
    try:
        return await run_in_threadpool(model.train_dataset, dataset, filename, config, uploaded_by)
    except ValueError as exc:
        raise HTTPException(status_code=409 if "already in progress" in str(exc) else 400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("LASSO training failed")
        raise HTTPException(status_code=500, detail="Retraining failed. The live model was not changed.") from exc


@app.post("/train/palawan")
async def train_prepared_palawan(request: Request):
    dataset_path = ROOT.parent / "datasets" / "processed" / "climate_training" / "palawan_retraining_dataset.csv"
    if not dataset_path.is_file():
        raise HTTPException(status_code=404, detail="The prepared Palawan annual training dataset is not installed.")
    config = {"alpha_mode": "fixed", "alpha": model.AUTO_NONZERO_ALPHA, "prediction": {"min": 0, "max": 100, "low_threshold": 33, "high_threshold": 66}}
    try:
        return await run_in_threadpool(model.train_dataset, dataset_path.read_bytes(), dataset_path.name, config, request.headers.get("x-researcher-id"))
    except ValueError as exc:
        raise HTTPException(status_code=409 if "already in progress" in str(exc) else 400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Prepared Palawan retraining failed")
        raise HTTPException(status_code=500, detail="Retraining failed. The live model was not changed.") from exc


@app.post("/train/experiments/{experiment_id}/activate")
def activate_training_experiment(experiment_id: str):
    try:
        return model.activate_experiment(experiment_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/train/experiments/{experiment_id}/dataset")
def download_experiment_dataset(experiment_id: str):
    try:
        dataset_path = model.experiment_dataset(experiment_id)
        suffix = dataset_path.suffix.lower()
        media_type = "text/csv" if suffix == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return FileResponse(dataset_path, filename=f"weeware-training-dataset{suffix}", media_type=media_type)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/train/experiments/{experiment_id}")
def remove_training_experiment(experiment_id: str):
    try:
        model.delete_experiment(experiment_id)
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/climate/years")
def climate_years():
    return {"years": list(range(2014, 2101)), "forecast_years": list(range(max(2026, date.today().year + 1), 2101)), "location": climate.LOCATION, "features": list(climate.FEATURES)}


@app.get("/climate/year/{year}")
def climate_year(year: int):
    if not 2014 <= year <= 2100:
        raise HTTPException(status_code=400, detail="Year must be between 2014 and 2100.")
    return climate.monthly_climate(year)


@app.get("/climate/window")
def climate_window(
    start_date: str = Query(...),
    end_date: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
):
    if end_date is None:
        raise HTTPException(status_code=400, detail="Provide both start_date and end_date for the 365-day window.")
    try:
        return climate.climate_window(start_date, end_date, lat, lng)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Climate window extraction failed")
        raise HTTPException(status_code=503, detail="Climate data extraction is temporarily unavailable.") from exc


@app.post("/predict")
def predict(request: PredictRequest):
    try:
        start, end = request.prediction_window()
        climate_result = climate.climate_window(start.isoformat(), end.isoformat(), request.lat, request.lng)
        result = model.infer(climate_result["weather"])
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Prediction service unavailable: {exc}") from exc
    return {**result, "start_date": start.isoformat(), "end_date": end.isoformat(), "location": climate_result["location"], "weather_sources": climate_result["sources"], "source_days": climate_result["source_days"], "monthly": climate_result.get("monthly", [])}




