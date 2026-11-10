from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
ML = ROOT / "ml-service"
ARTIFACTS = ROOT / "reports" / "palawan_lasso_retraining"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
PLOT_DIR = ARTIFACTS / "images"
PLOT_DIR.mkdir(parents=True, exist_ok=True)

DATA_PATH = ROOT / "datasets" / "processed" / "climate_training" / "palawan_retraining_dataset.csv"
DETAIL_PATH = ROOT / "datasets" / "processed" / "climate_training" / "palawan_lasso_training_annual.csv"
NOTES_PATH = ROOT / "datasets" / "processed" / "climate_training" / "source_notes.json"
OLD_PATH = ML / "models" / "lasso_weevil_model.pre-retrain.joblib"
NEW_PATH = ML / "model_experiments" / "35a8782a52494c5ea97dc3f086018427" / "model.joblib"
META_PATH = ML / "model_experiments" / "35a8782a52494c5ea97dc3f086018427" / "experiment.json"
LEGACY_DATA_PATH = ROOT / "datasets" / "training" / "WEEWARE FINAL DATASET 2014-2025.csv"

PALETTE = {"green": "#16623E", "lime": "#8DBB72", "navy": "#17324D", "blue": "#4C78A8", "orange": "#E28B40", "red": "#BF4C45", "gray": "#697783", "light": "#EEF3F0"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.titleweight": "bold", "axes.labelcolor": PALETTE["navy"], "text.color": PALETTE["navy"], "axes.edgecolor": "#A9B6B0", "grid.color": "#DCE4E0", "figure.facecolor": "white", "axes.facecolor": "#FAFCFB"})


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def old_prediction(weather: dict[str, float], old: dict) -> dict:
    features = old.get("features", ["rainfall", "temperature", "humidity", "solar", "wind"])
    raw = float(np.asarray(old["pipeline"].predict(np.asarray([[weather[name] for name in features]], dtype=float))).reshape(-1)[0])
    config = old.get("config", {}).get("prediction", {})
    lo, hi = float(config.get("min", 0)), float(config.get("max", 5))
    threshold_lo, threshold_hi = float(config.get("low_threshold", 1.5)), float(config.get("high_threshold", 3))
    rate = min(hi, max(lo, raw))
    risk = "Low" if rate < threshold_lo else "Medium" if rate < threshold_hi else "High"
    return {"raw_rate": raw, "rate": rate, "risk": risk, "output_max": hi, "low_threshold": threshold_lo, "high_threshold": threshold_hi}


def create_plots(legacy: pd.DataFrame, data: pd.DataFrame, detail: pd.DataFrame, old: dict, new: dict, live: dict, old_result: dict) -> list[Path]:
    paths: list[Path] = []
    old_features = old.get("features", ["rainfall", "temperature", "humidity", "solar", "wind"])
    old_x = pd.DataFrame({
        "rainfall": legacy["rainfall"], "temperature": legacy["temperature"],
        "humidity": legacy["humidity"], "solar": legacy["solar"], "wind": legacy["wind"],
    })[old_features]
    old_hat = np.asarray(old["pipeline"].predict(old_x.to_numpy(dtype=float)), dtype=float)

    # BEFORE: the real 12-row legacy annual dataset and fitted old-model values.
    fig = plt.figure(figsize=(10.2, 6.2))
    ax = fig.add_subplot(111, projection="3d")
    years = legacy["year"].astype(int).to_numpy()
    rain = legacy["rainfall"].to_numpy()
    observed = legacy["infestation_rate"].to_numpy()
    ax.scatter(years, rain, observed, s=58, c=PALETTE["blue"], edgecolor="white", linewidth=.6, label="Recorded infestation rate", depthshade=True)
    ax.scatter(years, rain, old_hat, s=52, c=PALETTE["orange"], marker="^", edgecolor="white", linewidth=.5, label="Old model estimate", depthshade=True)
    for x, y, z1, z2 in zip(years, rain, observed, old_hat):
        ax.plot([x, x], [y, y], [z1, z2], color="#9CA9A3", alpha=.55, linewidth=.8)
    ax.set_xlabel("Year", labelpad=8); ax.set_ylabel("Annual rainfall (mm)", labelpad=9); ax.set_zlabel("Infestation rate (%)", labelpad=8)
    ax.set_title("BEFORE TRAINING | old annual records", pad=18, fontsize=14)
    ax.legend(loc="upper left", bbox_to_anchor=(0.02, .94), frameon=True)
    ax.view_init(elev=24, azim=-57); ax.grid(True, alpha=.45)
    fig.text(.5, .035, "Each blue circle or orange triangle is one year. The connecting line shows how far the estimate was from the recorded rate.", ha="center", color=PALETTE["gray"])
    fig.tight_layout(rect=[0, .07, 1, 1]); p = PLOT_DIR / "01_before_legacy_model_3d.png"; fig.savefig(p, dpi=190, bbox_inches="tight"); plt.close(fig); paths.append(p)

    # DURING: actual location-year target points, with held-out-year CV predictions.
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    val = meta["validation"]
    cv_pred = np.asarray(val["predictions"], dtype=float)
    cv_obs = np.asarray(val["observed"], dtype=float)
    fit_inputs = data[["rainfall", "temperature"]].to_numpy(dtype=float)
    fig = plt.figure(figsize=(10.2, 6.2))
    ax = fig.add_subplot(111, projection="3d")
    year_vals = data["year"].to_numpy(dtype=float)
    scatter = ax.scatter(fit_inputs[:, 0], fit_inputs[:, 1], cv_obs, c=year_vals, cmap="viridis", s=43, alpha=.82, edgecolor="white", linewidth=.35, label="Recorded infestation rate")
    ax.scatter(fit_inputs[:, 0], fit_inputs[:, 1], cv_pred, c=PALETTE["red"], marker="x", s=30, alpha=.7, label="Estimate for a year left out")
    for x, y, z1, z2 in zip(fit_inputs[:, 0], fit_inputs[:, 1], cv_obs, cv_pred):
        ax.plot([x, x], [y, y], [z1, z2], color="#AAB5B0", alpha=.18, linewidth=.55)
    ax.set_xlabel("Annual rainfall (mm)", labelpad=8); ax.set_ylabel("Annual mean temperature (°C)", labelpad=8); ax.set_zlabel("Infestation rate (%)", labelpad=8)
    ax.set_title("DURING TRAINING | 100 place-and-year entries", pad=18, fontsize=14)
    cb = fig.colorbar(scatter, ax=ax, pad=.11, shrink=.68); cb.set_label("Year recorded")
    ax.legend(loc="upper left", bbox_to_anchor=(.02, .9), frameon=True)
    ax.view_init(elev=26, azim=-59); ax.grid(True, alpha=.45)
    fig.text(.5, .035, "For each red x estimate, the model learned without seeing any entries from that year.", ha="center", color=PALETTE["gray"])
    fig.tight_layout(rect=[0, .07, 1, 1]); p = PLOT_DIR / "02_during_palawan_training_3d.png"; fig.savefig(p, dpi=190, bbox_inches="tight"); plt.close(fig); paths.append(p)

    # AFTER: two model outputs on the identical forecast weather vector.
    fig = plt.figure(figsize=(10.2, 6.2))
    ax = fig.add_subplot(111, projection="3d")
    labels = ["Previous model", "Retrained model"]
    rates = [old_result["rate"], float(live["rate"])]
    maxima = [old_result["output_max"], float(live["output_max"])]
    for x, (label, rate, maximum, color) in enumerate(zip(labels, rates, maxima, [PALETTE["blue"], PALETTE["green"]])):
        ax.bar3d(x, 0, 0, .58, .58, rate, color=color, alpha=.88, shade=True)
    ax.set_xticks([.29, 1.29], labels); ax.set_yticks([]); ax.set_zlabel("Predicted infestation rate (%)", labelpad=8)
    ax.set_zlim(0, max(rates) * 1.2); ax.set_title("AFTER TRAINING | same 2026 weather information", pad=18, fontsize=14)
    ax.text2D(.025, .91, f"Previous: {rates[0]:.2f}%  |  limit {maxima[0]:.0f}%", transform=ax.transAxes, color=PALETTE["navy"], weight="bold", bbox={"facecolor":"white", "alpha":.88, "edgecolor":"#D8E1DC", "boxstyle":"round,pad=.35"})
    ax.text2D(.60, .91, f"Retrained: {rates[1]:.2f}%  |  limit {maxima[1]:.0f}%", transform=ax.transAxes, color=PALETTE["green"], weight="bold", bbox={"facecolor":"white", "alpha":.92, "edgecolor":"#D8E1DC", "boxstyle":"round,pad=.35"})
    ax.view_init(elev=23, azim=-59); ax.grid(True, alpha=.4)
    fig.text(.5, .055, f"{live['start_date']} to {live['end_date']} | Puerto Princesa | new minus old = {float(live['rate']) - old_result['rate']:+.2f} percentage points", ha="center", color=PALETTE["gray"])
    fig.text(.5, .025, "The old model limit was 5%; the new model limit is 100%. The source infestation numbers are not fully comparable.", ha="center", color=PALETTE["red"], fontsize=8.5)
    fig.tight_layout(rect=[0, .1, 1, 1]); p = PLOT_DIR / "03_after_prediction_comparison_3d.png"; fig.savefig(p, dpi=190, bbox_inches="tight"); plt.close(fig); paths.append(p)

    # Validation chart uses recorded metrics, not a synthetic loss curve.
    fig, ax = plt.subplots(figsize=(9.4, 4.4))
    labels = ["Year hidden\naverage miss", "Year hidden\nlarge-miss score", "Place hidden\naverage miss", "Place hidden\nlarge-miss score"]
    model_values = [meta["validation"]["mae"], meta["validation"]["rmse"], meta["spatial_validation"]["mae"], meta["spatial_validation"]["rmse"]]
    baseline_values = [meta["validation"]["baseline_mae"], meta["validation"]["baseline_rmse"], meta["spatial_validation"]["baseline_mae"], meta["spatial_validation"]["baseline_rmse"]]
    xx = np.arange(len(labels)); w = .34
    ax.bar(xx - w / 2, model_values, w, label="Weather model", color=PALETTE["green"])
    ax.bar(xx + w / 2, baseline_values, w, label="Simple-average guess", color="#B9C7C0")
    ax.set_xticks(xx, labels); ax.set_ylabel("Typical prediction miss (points; lower is better)"); ax.set_title("How close were the estimates?", pad=14)
    ax.legend(frameon=False, ncols=2, loc="upper left"); ax.grid(axis="y", alpha=.4); ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)
    for container in ax.containers: ax.bar_label(container, fmt="%.2f", padding=2, fontsize=8)
    fig.tight_layout(); p = PLOT_DIR / "04_validation_vs_baseline.png"; fig.savefig(p, dpi=190, bbox_inches="tight"); plt.close(fig); paths.append(p)

    # Rate and source composition visual exposes the target-scale mixture.
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.4, 4.2), gridspec_kw={"width_ratios": [1.25, 1]})
    bins = np.arange(0, 61, 5)
    ax1.hist(data["infestation_rate"], bins=bins, color=PALETTE["blue"], edgecolor="white")
    ax1.axvline(5, color=PALETTE["red"], linestyle="--", linewidth=1.6, label="Old model limit: 5%")
    ax1.set_xlabel("Infestation rate in training file (%)"); ax1.set_ylabel("Number of entries"); ax1.set_title("Infestation values in new file"); ax1.legend(frameon=False, fontsize=8)
    agg_counts = detail["target_aggregation"].value_counts()
    short = {"unweighted mean of available sampled months; no harvest denominator in source": "Average of sampled monthly rates", "sum_damaged_volume / sum_estimated_harvest": "Damaged amount / estimated harvest", "source annual target; kept on source numeric percent scale": "Older annual data"}
    vals = [int(agg_counts.get(k, 0)) for k in short]
    bars = ax2.barh([short[k] for k in short], vals, color=[PALETTE["orange"], PALETTE["green"], PALETTE["blue"]])
    ax2.set_xlabel("Number of entries"); ax2.set_title("How source rates were calculated"); ax2.invert_yaxis()
    ax2.bar_label(bars, padding=3); ax2.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); p = PLOT_DIR / "05_target_scale_and_sources.png"; fig.savefig(p, dpi=190, bbox_inches="tight"); plt.close(fig); paths.append(p)
    return paths


def build_report() -> Path:
    data = pd.read_csv(DATA_PATH)
    detail = pd.read_csv(DETAIL_PATH)
    legacy_raw = pd.read_csv(LEGACY_DATA_PATH)
    legacy = legacy_raw.rename(columns={
        "SOLAR RAD": "year", "TOTAL (mm)": "rainfall", "ANN (*C)": "temperature",
        "ANN (%)": "humidity", "ANN (Mj/m^2/d)": "solar", "ANN (m/s)": "wind", "TOTAL (%)": "infestation_rate",
    })
    old = joblib.load(OLD_PATH)
    new = joblib.load(NEW_PATH)
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    notes = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
    cmip_pairs = pd.read_csv(ROOT / "datasets" / "processed" / "climate_training" / "cmip6_nasa_comparison_summary.csv")
    legacy_weather_check = pd.read_csv(ROOT / "datasets" / "processed" / "climate_training" / "legacy_training_vs_nasa_power.csv")

    weather = {"rainfall": 2574.574129, "temperature": 29.636457, "humidity": 88.339952, "solar": 18.141667, "wind": 4.642731}
    live = {
        "start_date": "2026-01-01", "end_date": "2026-12-31", "rate": 36.91, "raw_rate": 36.90938994751298,
        "risk": "Medium", "training_period": new["training_period"], "output_max": new["config"]["prediction"]["max"],
        "weather": weather, "weather_sources": {
            "rainfall": "CMIP6 pr_Amon_CanESM5-1_ssp245_r1i1p1f1_gn_202101010130-203012312230.nc",
            "temperature": "CMIP6 tas_Amon_CanESM5_dcppB-forecast_s2022-r18i1p2f1_gn_202301-203212.nc",
            "humidity": "CMIP6 hurs_Amon_CanESM5_dcppB-forecast_s2022-r19i1p2f1_gn_202301-203212.nc",
            "solar": "Training climatology fallback",
            "wind": "CMIP6 sfcWind_Amon_CanESM5_dcppB-forecast_s2024-r7i1p2f1_gn_202501-203412.nc",
        },
    }
    previous = old_prediction(weather, old)
    # Use the exact live endpoint output retained in this run, and verify it against the saved active pipeline.
    live_vector = pd.DataFrame([[weather[name] for name in new["features"]]], columns=new["features"])
    new_raw = float(np.asarray(new["pipeline"].predict(live_vector)).reshape(-1)[0])
    if abs(new_raw - live["raw_rate"]) > 1e-5:
        raise RuntimeError(f"Live prediction evidence does not match active artifact: {new_raw} vs {live['raw_rate']}")
    if round(previous["rate"], 2) != 1.81:
        raise RuntimeError("Previous prediction evidence no longer matches the archived pre-retraining model.")

    plots = create_plots(legacy, data, detail, old, new, live, previous)
    created = datetime.now(timezone.utc).strftime("%d %B %Y")
    pdf_path = ARTIFACTS / "WeeWare_Palawan_LASSO_Retraining_Report.pdf"

    styles = getSampleStyleSheet()
    font_dir = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
    pdfmetrics.registerFont(TTFont("DejaVu", str(font_dir / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(font_dir / "DejaVuSans-Bold.ttf")))
    styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="DejaVu-Bold", fontSize=27, leading=33, textColor=colors.HexColor(PALETTE["green"]), alignment=TA_LEFT, spaceAfter=10))
    styles.add(ParagraphStyle(name="SubtitleCustom", parent=styles["Normal"], fontName="DejaVu", fontSize=14, leading=19, textColor=colors.HexColor(PALETTE["gray"]), spaceAfter=18))
    styles.add(ParagraphStyle(name="Section", parent=styles["Heading1"], fontName="DejaVu-Bold", fontSize=17, leading=22, textColor=colors.HexColor(PALETTE["green"]), spaceBefore=12, spaceAfter=8, keepWithNext=True))
    styles.add(ParagraphStyle(name="Subsection", parent=styles["Heading2"], fontName="DejaVu-Bold", fontSize=11.5, leading=15, textColor=colors.HexColor(PALETTE["navy"]), spaceBefore=8, spaceAfter=5, keepWithNext=True))
    styles.add(ParagraphStyle(name="BodyCustom", parent=styles["BodyText"], fontName="DejaVu", fontSize=9.1, leading=13.1, textColor=colors.HexColor("#263746"), spaceAfter=6))
    styles.add(ParagraphStyle(name="SmallCustom", parent=styles["BodyText"], fontName="DejaVu", fontSize=7.6, leading=10, textColor=colors.HexColor(PALETTE["gray"]), spaceAfter=4))
    styles.add(ParagraphStyle(name="Callout", parent=styles["BodyText"], fontName="DejaVu", fontSize=9.3, leading=13.5, textColor=colors.HexColor(PALETTE["navy"]), backColor=colors.HexColor(PALETTE["light"]), borderColor=colors.HexColor(PALETTE["lime"]), borderWidth=1, borderPadding=8, spaceBefore=5, spaceAfter=9))
    styles.add(ParagraphStyle(name="TableHeadCustom", parent=styles["BodyText"], fontName="DejaVu-Bold", fontSize=8, leading=10, textColor=colors.white))
    styles.add(ParagraphStyle(name="TableCellCustom", parent=styles["BodyText"], fontName="DejaVu", fontSize=7.8, leading=10, textColor=colors.HexColor("#263746")))
    styles.add(ParagraphStyle(name="CoverTag", parent=styles["Normal"], fontName="DejaVu", fontSize=9, leading=13, textColor=colors.HexColor(PALETTE["gray"]), spaceAfter=5))

    def P(text: str, style: str = "BodyCustom") -> Paragraph:
        return Paragraph(text, styles[style])

    def table(rows, widths, header=True):
        converted = []
        for i, row in enumerate(rows):
            converted.append([P(str(cell), "TableHeadCustom" if (header and i == 0) else "TableCellCustom") for cell in row])
        t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(PALETTE["green"]) if header else colors.white),
            ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor("#F3F7F5")]),
            ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#D8E1DC")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return t

    def img(path: Path, width=7.1 * inch, height=4.45 * inch):
        obj = Image(str(path), width=width, height=height)
        obj.hAlign = "CENTER"
        return obj

    doc = SimpleDocTemplate(str(pdf_path), pagesize=letter, rightMargin=.72*inch, leftMargin=.72*inch, topMargin=.65*inch, bottomMargin=.62*inch, title="WeeWare Palawan LASSO Retraining Report", author="WeeWare Research")
    story = []
    story += [Spacer(1, .52*inch), P("WEEWARE · PALAWAN CLIMATE &amp; INFESTATION", "CoverTag"), P("LASSO Retraining<br/>and Model Comparison", "CoverTitle"), P("Training evidence · validation · same-weather prediction comparison", "SubtitleCustom")]
    story += [P(f"Prepared {created} · Dataset years 2014–2025 · Prediction window 2026", "CoverTag"), Spacer(1, .16*inch)]
    cover_stats = [["100", "23", "12", "5"], ["location-year rows", "labeled locations", "distinct years", "weather inputs"]]
    stat = Table([[P(x, "CoverTitle") for x in cover_stats[0]], [P(x, "SmallCustom") for x in cover_stats[1]]], colWidths=[1.7*inch]*4)
    stat.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(PALETTE["light"])), ("BOX", (0, 0), (-1, -1), .7, colors.HexColor("#CFDDD5")), ("INNERGRID", (0, 0), (-1, -1), .4, colors.HexColor("#CFDDD5")), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 11)]))
    story += [stat, Spacer(1, .28*inch), img(plots[2], 6.85*inch, 4.17*inch), P("The active model completed retraining and was used by the running WeeWare prediction service. The validation and target-definition caveats in this report are material to interpreting its outputs.", "Callout"), PageBreak()]

    story += [P("Executive summary", "Section"), P("The previous production model used 12 annual Puerto Princesa observations and a 0–5% prediction ceiling. The new model uses 100 location-year rows covering 23 labeled Palawan locations and the same five climate inputs. It is a standardized LASSO regression with fixed alpha 0.05; it has no training epochs.")]
    story += [P(f"On a live-equivalent 2026 weather vector at the Puerto Princesa reference coordinate, the previous model returned <b>{previous['rate']:.2f}%</b> and the retrained model returned <b>{live['rate']:.2f}%</b> ({live['rate']-previous['rate']:+.2f} percentage points). Both labeled the result Medium, but the old and new risk thresholds differ. This is a model-output comparison, not an accuracy test.", "Callout")]
    story += [P("Main interpretation", "Subsection"), P("Year-holdout error is lower than the training-mean baseline on both MAE and RMSE. Location-holdout MAE is slightly lower than baseline, while location-holdout RMSE is worse. In addition, many infestation labels repeat across years and the dataset combines different target constructions. Therefore, the validation scores and the large old/new output difference should be treated as provisional, not as proof that the retrained model is more accurate.")]

    story += [P("1 · What happened", "Section")]
    timeline = [
        ["Stage", "Recorded work", "Evidence"],
        ["Before", "Archived prior model: 12 Puerto Princesa annual rows; 5% output ceiling.", "Pre-retraining artifact and legacy CSV"],
        ["Prepare", "NASA POWER monthly weather was assembled at municipal/town-center coordinates; CMIP6 overlaps were compared with NASA values.", "Processed climate-training tables and source notes"],
        ["Train", "Standardized five-feature LASSO, alpha 0.05, 100,000 maximum iterations; year groups and location groups evaluated separately.", "Experiment 35a8782a… / experiment.json"],
        ["After", "Final artifact activated; same-weather 2026 comparison run through the live prediction endpoint.", "Active model artifact and prediction output"],
        ["Website", "Frontend, backend, and ML service returned HTTP 200; live model endpoint reported 100 samples and 23 locations.", "Local integration check at localhost:5180 / :5023 / :8023"],
    ]
    story += [table(timeline, [0.72*inch, 3.28*inch, 2.92*inch]), Spacer(1, 8), P("The first prepared-dataset run (experiment cd522e20…) was followed by the final run (35a8782a…) that added leave-one-location-out validation. The latter is the artifact used for this report.", "SmallCustom")]

    story += [P("2 · Training data and preparation", "Section")]
    target_counts = detail["target_aggregation"].value_counts().to_dict()
    dist = data["infestation_rate"].describe()
    repeated_extra = int(data.duplicated(["location", "infestation_rate"]).sum())
    unique_labels = data.groupby("location")["infestation_rate"].nunique()
    stat_rows = [
        ["Measure", "Observed in the prepared training file"],
        ["Rows / locations / years", f"{len(data)} rows · {data.location.nunique()} locations · {data.year.nunique()} distinct years ({data.year.min()}–{data.year.max()})"],
        ["Weather completeness", f"No missing entries in the five weather predictors; variables: rainfall, temperature, humidity, solar, wind."],
        ["Infestation target", f"Minimum {dist['min']:.2f}% · median {dist['50%']:.2f}% · mean {dist['mean']:.2f}% · maximum {dist['max']:.2f}%; {int((data.infestation_rate == 0).sum())} zero-valued rows."],
        ["Sampled-month mean", f"{target_counts.get('unweighted mean of available sampled months; no harvest denominator in source', 0)} rows; source lacked a harvest denominator."],
        ["Harvest-weighted workbook", f"{target_counts.get('sum_damaged_volume / sum_estimated_harvest', 0)} rows; computed as sum damaged volume / sum estimated harvest."],
        ["Legacy annual labels", f"{target_counts.get('source annual target; kept on source numeric percent scale', 0)} rows retained on their original numeric scale."],
        ["Repeated location-level targets", f"{repeated_extra} rows repeat a location/rate pair in another year; median distinct target values per location is {unique_labels.median():.0f}."],
    ]
    story += [table(stat_rows, [1.72*inch, 5.2*inch]), Spacer(1, 8), img(plots[4], 6.95*inch, 3.1*inch)]
    story += [P("Weather source and annualization", "Subsection"), P("The prepared annual weather file uses NASA POWER monthly point data for municipality/town-center coordinates, not farm GPS. Rainfall is accumulated to annual millimeters; temperature, relative humidity, solar radiation, and wind are annualized from monthly values. PSA lists 23 Palawan municipalities; Puerto Princesa City is also represented. Narra has weather rows but no infestation label, so it is excluded from supervised training.")]
    story += [P("The label construction is heterogeneous. The source CSV rates without harvest denominators were averaged over available sampled months. Workbook rates were aggregated from damaged volume divided by estimated harvest. Twelve legacy annual values were kept on their source scale. Those are not guaranteed to be interchangeable outcome measures.", "Callout")]
    cmip_intro = P("The local CMIP6 files were compared to paired NASA POWER monthly point values. These statistics describe agreement over overlapping months; they are not an exact-weather forecast verification. The grid is coarse and only a handful of distinct model cells cover the comparison points.")
    cmip_rows = [["Variable / overlap", "CMIP6 minus NASA mean", "MAE", "Correlation"]]
    select_specs = [
        ("rainfall", 2015, 2020, "mm/month"), ("rainfall", 2021, 2025, "mm/month"),
        ("temperature", 2023, 2025, "°C"), ("humidity", 2023, 2025, "percentage points"),
        ("wind", 2025, 2025, "m/s"), ("solar", 2014, 2014, "MJ/m²/day"),
    ]
    for feature, start_year, end_year, unit in select_specs:
        match = cmip_pairs[(cmip_pairs.feature == feature) & (cmip_pairs.year_start == start_year) & (cmip_pairs.year_end == end_year)].iloc[0]
        cmip_rows.append([f"{feature.title()} · {start_year}–{end_year}", f"{match.mean_bias_cmip6_minus_nasa:+.2f} {unit}", f"{match.mae:.2f} {unit}", f"{match.correlation:.2f}"])
    cmip_table = table(cmip_rows, [1.55*inch, 2.0*inch, 2.0*inch, 1.1*inch])
    legacy_mae = legacy_weather_check.groupby("feature").legacy_minus_nasa.apply(lambda x: x.abs().mean()).to_dict()
    legacy_climate_note = P("The legacy Puerto Princesa annual weather table also differs from NASA POWER in places: mean absolute differences across its 12 years were rainfall {0:.1f} mm/year, temperature {1:.3f} °C, humidity {2:.4f} percentage points, solar {3:.3f} MJ/m²/day, and wind {4:.4f} m/s. This supported using one consistent NASA POWER source for historical climate features during dataset preparation; the running prediction service still uses available CMIP6 fields and marks fallbacks.".format(legacy_mae["rainfall"], legacy_mae["temperature"], legacy_mae["humidity"], legacy_mae["solar"], legacy_mae["wind"]), "SmallCustom")
    story += [KeepTogether([P("CMIP6 comparison with NASA POWER", "Subsection"), cmip_intro, cmip_table, Spacer(1, 5), legacy_climate_note])]
    story += [PageBreak()]

    story += [P("3 · Before, during, and after training", "Section"), P("These are evidence visualizations generated from the saved old data, the prepared 100-row dataset, the recorded cross-validation predictions, and the live-equivalent comparison. They are not screenshots of an optimizer running. LASSO estimates coefficients directly; it does not train in epochs.")]
    story += [P("Before · legacy data and fitted values", "Subsection"), img(plots[0]), P("The 3D plot shows the old annual observations and old model fitted estimates. The vertical lines are residuals. The legacy target range and 5% cap differ from those in the new training dataset.", "SmallCustom"), PageBreak()]
    story += [P("During · location-year observations and held-out-year predictions", "Subsection"), img(plots[1]), P("Markers are the actual new training rows and the saved out-of-year predictions. For each validation fold, every location from the held-out year was excluded from fitting. The repeated target values across years mean that this temporal validation may still be optimistic for genuinely new infestation conditions.", "SmallCustom"), PageBreak()]
    story += [P("After · same weather passed to both models", "Subsection"), img(plots[2]), P("The old model was loaded from the pre-retraining backup; the new result came from the live prediction endpoint. The forecast used Puerto Princesa reference coordinates (9.7494° N, 118.7384° E), January 1–December 31, 2026. Both models received the same five climate values listed in section 5.", "SmallCustom"), PageBreak()]

    story += [P("4 · Training setup and validation", "Section")]
    training_table = [
        ["Setting", "Final retraining run"],
        ["Estimator", "LASSO regression in a StandardScaler → Lasso pipeline"],
        ["Features", "Rainfall · temperature · humidity · solar radiation · wind"],
        ["Regularization", f"Fixed alpha = {new['alpha']:.2f}; intercept fitted"],
        ["Optimizer settings", "Maximum iterations = 100,000; no epoch count for this estimator"],
        ["Output / risk thresholds", "0–100% output ceiling; Low < 33%, Medium 33–<66%, High ≥66%"],
        ["Samples", f"{new['samples']} rows; {new['training_period']}"],
    ]
    story += [table(training_table, [1.65*inch, 5.27*inch]), Spacer(1, 8)]
    val = meta["validation"]; spatial = meta["spatial_validation"]
    metrics_table = [
        ["Validation method", "LASSO MAE", "Baseline MAE", "LASSO RMSE", "Baseline RMSE"],
        ["Leave one year out (12 year groups)", f"{val['mae']:.2f}", f"{val['baseline_mae']:.2f}", f"{val['rmse']:.2f}", f"{val['baseline_rmse']:.2f}"],
        ["Leave one location out (23 locations)", f"{spatial['mae']:.2f}", f"{spatial['baseline_mae']:.2f}", f"{spatial['rmse']:.2f}", f"{spatial['baseline_rmse']:.2f}"],
    ]
    story += [table(metrics_table, [2.15*inch, 1.05*inch, 1.1*inch, 1.08*inch, 1.18*inch]), Spacer(1, 6), img(plots[3], 6.85*inch, 3.2*inch)]
    year_mae_gain = 100*(val["baseline_mae"]-val["mae"])/val["baseline_mae"]
    year_rmse_gain = 100*(val["baseline_rmse"]-val["rmse"])/val["baseline_rmse"]
    loc_mae_gain = 100*(spatial["baseline_mae"]-spatial["mae"])/spatial["baseline_mae"]
    loc_rmse_gain = 100*(spatial["baseline_rmse"]-spatial["rmse"])/spatial["baseline_rmse"]
    story += [P(f"Year holdout: MAE is {year_mae_gain:.1f}% lower and RMSE {year_rmse_gain:.1f}% lower than baseline. Location holdout: MAE is {loc_mae_gain:.1f}% lower, but RMSE is {abs(loc_rmse_gain):.1f}% higher than baseline. These are errors in percentage points, not percent error.", "Callout")]
    story += [P("The repeated-location target audit found {0} duplicate location/rate rows, and a median of {1:.0f} distinct target values per location. Since many places have the same supplied infestation rate across multiple nominal years, leave-one-year-out folds may see a location's repeated label in other years. That can make the year score look better than performance on new infestation observations. The location holdout is more relevant to transfer to an unseen municipality, but remains based on this same heterogeneous target file.".format(repeated_extra, unique_labels.median()))]

    story += [PageBreak(), P("5 · Prediction comparison on the same weather", "Section")]
    pred_table = [
        ["Model", "Estimate", "Configured ceiling", "Risk thresholds", "Risk"],
        ["Previous model", f"{previous['rate']:.2f}%", f"{previous['output_max']:.0f}%", f"{previous['low_threshold']:.1f}% / {previous['high_threshold']:.1f}%", previous["risk"]],
        ["Retrained model", f"{live['rate']:.2f}%", f"{live['output_max']:.0f}%", "33% / 66%", live["risk"]],
    ]
    story += [table(pred_table, [1.35*inch, .85*inch, 1.2*inch, 1.55*inch, .75*inch]), Spacer(1, 7)]
    weather_rows = [["Input", "Value", "Source for 2026 run"]]
    labels = {"rainfall": "Rainfall", "temperature": "Temperature", "humidity": "Relative humidity", "solar": "Solar radiation", "wind": "Wind speed"}
    units = {"rainfall": "mm/year", "temperature": "°C", "humidity": "%", "solar": "MJ/m²/day", "wind": "m/s"}
    for name in ["rainfall", "temperature", "humidity", "solar", "wind"]:
        weather_rows.append([labels[name], f"{weather[name]:.2f} {units[name]}", live["weather_sources"][name]])
    story += [table(weather_rows, [1.15*inch, 1.25*inch, 4.5*inch]), Spacer(1, 7)]
    story += [P(f"Difference: {live['rate']-previous['rate']:+.2f} percentage points (retrained minus previous). The new output is {live['rate']/max(previous['rate'],1e-9):.1f} times the old output on this one input, but the models were trained on outcome data with different distributions and construction methods. The previous model also clipped estimates at 5%; the new one can emit values through 100%. This difference cannot be interpreted as a measured increase in real infestation or as evidence that the new estimate is more accurate.", "Callout")]
    story += [P("Weather inputs were extracted for the full 2026 calendar window at the Puerto Princesa reference coordinate. Rainfall, temperature, humidity, and wind came from the named local CMIP6 files; solar radiation used the training-climatology fallback. CMIP6 is a climate model output and the solar field is a fallback, not direct 2026 farm observation.")]

    story += [PageBreak(), P("6 · Limitations and next evidence needed", "Section")]
    cautions = [
        "Target comparability: the supervised target mixes source annual percentages, unweighted sampled-month means, and harvest-weighted ratios. Confirm that all source values represent the same infestation-rate definition and denominator before using the difference between models as a performance claim.",
        "Repeated labels: most locations have only one distinct infestation target repeated over multiple years. Obtain actual year-specific outcomes to make temporal validation meaningful.",
        "Spatial transfer: location-holdout RMSE is worse than the baseline. The current evidence does not establish reliable transfer to every Palawan municipality.",
        "Climate support: municipal center coordinates approximate farm locations; CMIP6 grids are coarse; solar for this 2026 example fell back to training climatology.",
        "Prediction scope: the model returns a regression estimate, not a calibrated probability or confidence interval. Risk bands are configuration thresholds, not validated biological thresholds.",
    ]
    for item in cautions:
        story.append(P("• " + item))
    story += [KeepTogether([P("Recommended next step", "Subsection"), P("Before treating this as a dependable Palawan-wide forecaster, harmonize target definitions, remove/reconcile repeated target labels that are not truly annual observations, and evaluate on new time-stamped infestation records. Report errors against that held-out field data and keep a simple baseline in the comparison.", "Callout")])]

    story += [PageBreak(), P("Appendix · reproducibility and sources", "Section")]
    coef_rows = [["Weather feature", "Previous model coefficient", "Retrained model coefficient"]]
    old_est = old["pipeline"].named_steps.get("model", old["pipeline"].steps[-1][1])
    new_est = new["pipeline"].named_steps["lasso"]
    for i, name in enumerate(new["features"]):
        oc = float(old_est.coef_[i]) if i < len(old_est.coef_) else 0.0
        nc = float(new_est.coef_[i]) if i < len(new_est.coef_) else 0.0
        coef_rows.append([name, f"{oc:.5f}", f"{nc:.5f}"])
    story += [P("Stored coefficients are standardized pipeline coefficients. They are not direct effect sizes in original units; the fitted scaler must be applied.", "SmallCustom"), table(coef_rows, [2.25*inch, 2.3*inch, 2.3*inch]), Spacer(1, 8)]
    story += [P("Files used", "Subsection")]
    file_rows = [
        ["Role", "Workspace artifact"],
        ["Prepared annual training data", "datasets/processed/climate_training/palawan_retraining_dataset.csv"],
        ["Detailed annual data and target provenance", "datasets/processed/climate_training/palawan_lasso_training_annual.csv"],
        ["Data source/method notes", "datasets/processed/climate_training/source_notes.json"],
        ["Final run record", "ml-service/model_experiments/35a8782a52494c5ea97dc3f086018427/experiment.json"],
        ["Final model", "ml-service/model_experiments/35a8782a52494c5ea97dc3f086018427/model.joblib"],
        ["Archived previous model", "ml-service/models/lasso_weevil_model.pre-retrain.joblib"],
    ]
    story += [table(file_rows, [2.0*inch, 4.9*inch]), Spacer(1, 8), P("External source references", "Subsection")]
    source_paras = [
        '<link href="https://power.larc.nasa.gov/docs/services/api/temporal/monthly/" color="#16623E">NASA POWER Monthly API documentation</link> — monthly meteorological and solar parameters; NASA POWER values retain source spatial resolutions.',
        '<link href="https://psa.gov.ph/classification/psgc/citimuni/1705300000?vcode=7" color="#16623E">Philippine Statistics Authority · Palawan PSGC page</link> — official Palawan municipal list.',
        '<link href="https://climate-scenarios.canada.ca/?page=cmip6-model-list" color="#16623E">Canada Climate Scenarios CMIP6 model list</link> — CanESM5 model/scenario catalog reference.',
        '<link href="https://nominatim.openstreetmap.org/" color="#16623E">OpenStreetMap Nominatim</link> — source recorded for approximate municipality/town-center coordinates.',
    ]
    for s in source_paras: story.append(P("• " + s, "SmallCustom"))
    story += [Spacer(1, 8), P("Integrity identifiers", "Subsection"), P(f"Final model experiment ID: {meta['id']}<br/>Final dataset SHA-256: {hash_file(DATA_PATH)}<br/>Final model SHA-256: {hash_file(NEW_PATH)}<br/>Previous model SHA-256: {hash_file(OLD_PATH)}<br/>Dataset source note: {notes['weather_source']} · Generated report data values are read from the saved dataset/artifacts and the recorded live prediction.", "SmallCustom")]
    story += [P("Status note: the local workspace had no Git repository root or configured GitHub remote when the website was started. The report and image files are local artifacts and have not been committed to GitHub.", "SmallCustom")]

    # Replace the technical-first draft above with a client-facing narrative.
    story = []
    story += [Spacer(1, .45*inch), P("WEEWARE | PALAWAN", "CoverTag"), P("How the new Palawan<br/>forecast was trained", "CoverTitle"), P("A plain-language guide to the data, checks, and old-versus-new result", "SubtitleCustom")]
    story += [P(f"Prepared {created} | Training data: 2014-2025 | Example forecast: 2026", "CoverTag"), Spacer(1, .15*inch)]
    plain_stats = [["100", "23", "12", "5"], ["training entries", "labeled places", "years covered", "weather measures"]]
    plain_stat = Table([[P(x, "CoverTitle") for x in plain_stats[0]], [P(x, "SmallCustom") for x in plain_stats[1]]], colWidths=[1.7*inch]*4)
    plain_stat.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(PALETTE["light"])), ("BOX", (0, 0), (-1, -1), .7, colors.HexColor("#CFDDD5")), ("INNERGRID", (0, 0), (-1, -1), .4, colors.HexColor("#CFDDD5")), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [plain_stat, Spacer(1, .2*inch), img(plots[2], 6.85*inch, 4.0*inch), P("The new model is trained and connected to the local WeeWare website. Important: its much higher estimate does not prove that real infestation increased or that the new model is more accurate. The two models learned from different kinds of infestation records.", "Callout"), PageBreak()]

    story += [P("The short version", "Section"), P(f"We gave both models the same weather information for Puerto Princesa during 2026. The older model estimated <b>{previous['rate']:.2f}%</b>; the retrained model estimated <b>{live['rate']:.2f}%</b>. The new estimate is {live['rate']-previous['rate']:.2f} percentage points higher.")]
    story += [P("That gap is large, but the old model was trained on values between 0 and 5%, while the new training file includes values as high as 52.15%. The old model also cannot report above 5%. The input records are not fully comparable, so this test shows how the two formulas differ; it does not tell us which answer is closer to the true infestation rate.", "Callout")]
    story += [P("What the checks found", "Subsection"), P(f"When we hid one whole year at a time, the new model's average miss was <b>{val['mae']:.2f} points</b>. A simple guess using the average training value missed by <b>{val['baseline_mae']:.2f} points</b>. That is an improvement on this check."), P(f"When we hid one whole place at a time, the new model's average miss was <b>{spatial['mae']:.2f} points</b> versus <b>{spatial['baseline_mae']:.2f}</b> for the simple guess. But its score that penalizes large misses was worse: <b>{spatial['rmse']:.2f}</b> versus <b>{spatial['baseline_rmse']:.2f}</b>. This does not yet show dependable performance in a place absent from training.")]
    story += [P("Many places have the same supplied infestation value repeated in several years. So the 100 entries do not represent 100 fully independent, year-specific field measurements. This may make the year check look better than it would on new observations.", "Callout")]

    story += [P("What happened", "Section")]
    plain_timeline = [["Step", "In everyday terms"], ["Before", "The website used an older model trained on 12 annual Puerto Princesa records. It was limited to estimates from 0% to 5%."], ["Prepare", "Annual weather information was assembled for Palawan places. Existing climate-model values were compared with NASA weather estimates where both were available."], ["Train", "The model was fitted to 100 place-and-year entries with five weather measures. Checks hid whole years and whole places to see how estimates held up."], ["After", "The updated model was made active in the website. Both saved models were given the same 2026 weather information for a direct output comparison."], ["Website", "The local website, data service, and model service responded during the check. The active model reported 100 training entries and 23 labeled places."]]
    story += [table(plain_timeline, [1.0*inch, 5.9*inch]), Spacer(1, 8), P("LASSO is the name of the math method used here. It learns a formula that combines the five weather measures. It is not a neural network, so it does not have 'epochs'. This report shows the checks and prediction evidence instead of an epoch chart.", "Callout"), PageBreak()]

    story += [P("What went into training", "Section")]
    simple_rows = [["Item", "What the file contains"], ["Training entries", f"{len(data)} rows from {data.location.nunique()} labeled places and {data.year.nunique()} years, from {data.year.min()} to {data.year.max}."], ["Weather", "Rainfall, temperature, humidity, sunlight, and wind. All 100 entries have values for these five measures."], ["Infestation values", f"From {dist['min']:.2f}% to {dist['max']:.2f}%. The middle value is {dist['50%']:.2f}%. {int((data.infestation_rate == 0).sum())} entries are recorded as zero."], ["52 entries", "An average of sampled monthly infestation rates. The source did not include harvest amounts for this calculation."], ["36 entries", "Total damaged volume divided by estimated harvest, from the supplied workbooks."], ["12 entries", "Values retained from the older Puerto Princesa annual dataset."], ["Repeated values", f"{repeated_extra} entries repeat a place's reported rate in another year. The typical place has only {unique_labels.median():.0f} distinct supplied target value(s)."]]
    story += [table(simple_rows, [1.35*inch, 5.55*inch]), Spacer(1, 8), img(plots[4], 6.9*inch, 3.0*inch)]
    story += [P("Why repeated values matter", "Subsection"), P("A place can have different weather in 2014, 2017, 2021, and 2025. But if its infestation number is copied unchanged across those years, the model is not learning how infestation changed year to year at that place. We need a truly measured value for each year to check whether changing weather predicts changing infestation.", "Callout")]
    story += [P("Where the weather came from", "Subsection"), P("Historical weather was taken from NASA POWER monthly estimates and combined into annual values. Coordinates are town or municipality centers, not farm locations. They support area-level estimates, not weather readings from a specific orchard. Puerto Princesa is included; Narra has weather data but no infestation label in the supplied files, so it could not be used as a labeled training place.")]
    story += [PageBreak(), P("How the climate sources compared", "Section"), P("CMIP6 is the name of the global climate-model collection used here. Its local model files were compared with estimates from NASA POWER, a NASA service that provides weather and sunlight estimates for a location for months covered by both. A positive difference means the climate-model value was higher on average. The 'usual gap' is the typical size of the difference. This describes agreement between gridded sources; it is not proof of exact weather at any farm.")]
    plain_cmip = [["Weather and years", "Model average vs NASA", "Usual gap"]]
    for feature, start_year, end_year, unit in select_specs:
        match = cmip_pairs[(cmip_pairs.feature == feature) & (cmip_pairs.year_start == start_year) & (cmip_pairs.year_end == end_year)].iloc[0]
        plain_cmip.append([f"{feature.title()}, {start_year}-{end_year}", f"{match.mean_bias_cmip6_minus_nasa:+.2f} {unit}", f"{match.mae:.2f} {unit}"])
    story += [table(plain_cmip, [2.0*inch, 2.8*inch, 2.1*inch]), Spacer(1, 7), P("For rainfall in 2021-2025, climate-model values averaged about 38 mm/month higher than NASA POWER, and a typical month differed by about 102 mm. The 2026 example below used climate-model values for rain, temperature, humidity, and wind. Solar radiation was missing from the local 2026 files, so the service used an average from the training data instead.", "Callout")]
    story += [P("In the older Puerto Princesa weather table, the average difference from NASA POWER was 173 mm/year for rain and 0.67 degrees C for temperature. The differences were smaller for humidity, sunlight, and wind. Historical training weather was therefore prepared using one consistent NASA POWER source.")]

    story += [PageBreak(), P("Before training: the older model", "Section"), P("Each blue circle is a recorded infestation value from the old annual dataset. Each orange triangle is the old model's estimate for the same record. The line between them shows the gap, or miss. The chart also shows the year and annual rainfall.")]
    story += [img(plots[0]), P("The old model used 12 Puerto Princesa annual records and could not report above 5%.", "Callout"), PageBreak()]
    story += [P("During training: checking the new data", "Section"), P("Each mark represents one place in one year. The graph compares rain and temperature with the supplied infestation value. Red x marks show estimates for a year hidden while the model learned; all places from that year were hidden together.")]
    story += [img(plots[1]), P("This is a picture made from saved training and check results, not a camera image of training as it ran. The model learns a formula; it does not produce epoch-by-epoch progress pictures.", "Callout"), PageBreak()]
    story += [P("After training: one weather test, two models", "Section"), P("We gave both models the same weather information for January 1 to December 31, 2026, at the Puerto Princesa reference coordinate (9.7494 north, 118.7384 east). The bars show what each model estimated.")]
    story += [img(plots[2]), P("The estimates are not a fair accuracy contest: the models used different infestation records and different maximum output values. This comparison shows how the model result changed, not which result is correct.", "Callout"), PageBreak()]

    story += [P("How to read the model checks", "Section"), P("Think of validation as a practice test: hide some records, let the model learn from the rest, then compare its guesses with the hidden records. We also compare it with a simple guess that always uses the average infestation value from the visible records.")]
    story += [img(plots[3], 6.85*inch, 3.2*inch)]
    story += [P(f"Year check: the model's average miss was {val['mae']:.2f} percentage points, compared with {val['baseline_mae']:.2f} for the simple guess. Its score that penalizes especially large misses was {val['rmse']:.2f}, compared with {val['baseline_rmse']:.2f}. Lower numbers are better.")]
    story += [P(f"Place check: average miss was {spatial['mae']:.2f} for the model and {spatial['baseline_mae']:.2f} for the simple guess. But the large-miss score was {spatial['rmse']:.2f} for the model and {spatial['baseline_rmse']:.2f} for the simple guess. This is mixed evidence, not proof the model works reliably in a new municipality.", "Callout")]
    story += [P("Average miss is the typical distance between a guess and the supplied value. The large-miss score gives especially bad guesses more penalty. The unit is percentage points: for example, the gap between 20% and 15% is 5 percentage points. Repeated infestation values across years may make the year check look better than it would on new field observations.")]
    story += [PageBreak(), P("The 2026 result in detail", "Section")]
    pred_plain = [["Model", "Estimate", "Maximum allowed", "Risk label and cutoffs"], ["Previous", f"{previous['rate']:.2f}%", f"{previous['output_max']:.0f}%", f"{previous['risk']} (middle band: 1.5%-3%)"], ["Retrained", f"{live['rate']:.2f}%", f"{live['output_max']:.0f}%", f"{live['risk']} (middle band: 33%-66%)"]]
    story += [table(pred_plain, [1.0*inch, .95*inch, 1.25*inch, 3.65*inch]), Spacer(1, 8), P("Weather information used", "Subsection")]
    weather_plain = [["Measure", "Value", "Source"]]
    units_plain = {"rainfall":"mm/year", "temperature":"degrees C", "humidity":"%", "solar":"sunlight per day", "wind":"m/s"}
    source_plain = {"rainfall":"Climate model", "temperature":"Climate model", "humidity":"Climate model", "solar":"Training-data average (fallback)", "wind":"Climate model"}
    for name in ["rainfall", "temperature", "humidity", "solar", "wind"]:
        weather_plain.append([labels[name], f"{weather[name]:.2f} {units_plain[name]}", source_plain[name]])
    story += [table(weather_plain, [1.35*inch, 1.75*inch, 3.75*inch]), Spacer(1, 8), P("Both models say 'Medium', but that label uses different cutoffs in each model. It is a software category, not a verified biological danger level. The estimate is not a measured farm infestation rate, and the app does not provide a confidence range.", "Callout")]

    story += [PageBreak(), P("What we can and cannot conclude", "Section"), P("What we know", "Subsection"), P("The updated model was trained, saved as the active model, and returned an estimate through the WeeWare prediction service. It uses five weather measures and records for multiple Palawan places. Its year-check scores beat the simple average guess in this dataset."), P("What we do not know yet", "Subsection")]
    for item in ["Whether 36.91% is closer to reality than 1.81%; the source records and output limits differ.", "Whether the model works reliably in every Palawan municipality; the place check was mixed.", "Whether year-to-year weather changes predict year-to-year infestation; many supplied values repeat across years.", "The exact weather at a farm; the historical coordinates are town centers and climate grids cover broad areas."]:
        story.append(P("- " + item))
    story += [P("Best next step", "Subsection"), P("Confirm that all infestation numbers use the same definition. Replace repeated values with actual year-specific observations where possible. Then compare future predictions with new orchard survey results and keep the simple-average guess as a benchmark.", "Callout")]

    story += [PageBreak(), P("A few words explained", "Section")]
    glossary = [["Term", "Plain meaning"], ["Model", "A formula fitted to past examples that estimates a result from new inputs."], ["Training entry", "One row pairing one place, one year, weather values, and an infestation value."], ["Validation / practice test", "Checking guesses on records kept out while the formula is fitted."], ["LASSO", "The kind of formula used. It combines weather measures while limiting overly complicated weights."], ["CMIP6", "A collection of computer models used to estimate possible future climate."], ["NASA POWER", "A NASA service that provides weather and sunlight estimates for a location."], ["Alpha", "A setting that controls how strongly the formula is kept simple. This run used 0.05."], ["Average miss", "The average distance between a guess and the supplied value; lower is better."], ["Large-miss score", "An error score that penalizes especially large misses more; lower is better."], ["Percentage point", "The direct difference between two percentages. 20% minus 15% is 5 points."], ["Fallback", "A substitute value used when a weather measure is missing from local climate files."]]
    story += [table(glossary, [1.75*inch, 5.15*inch]), Spacer(1, 12), P("Sources and saved records", "Subsection")]
    story += [P("Weather: <link href='https://power.larc.nasa.gov/docs/services/api/temporal/monthly/' color='#16623E'>NASA POWER monthly API guide</link>. Place list: <link href='https://psa.gov.ph/classification/psgc/citimuni/1705300000?vcode=7' color='#16623E'>Philippine Statistics Authority - Palawan PSGC page</link>. Climate model catalog: <link href='https://climate-scenarios.canada.ca/?page=cmip6-model-list' color='#16623E'>CMIP6 CanESM5</link>. Coordinates: <link href='https://nominatim.openstreetmap.org/' color='#16623E'>OpenStreetMap Nominatim</link> town-center lookups.")]
    story += [P(f"Training record: {len(data)} entries from 2014-2025, experiment {meta['id']}. Saved files include the prepared training table, the detailed source table, the experiment record, and the active model. The final model used five weather measures, a setting called alpha of {new['alpha']:.2f}, and up to 100,000 solver steps. These technical settings are included for anyone who needs to reproduce the work.", "SmallCustom")]

    def footer(canvas, document):
        canvas.saveState()
        w, h = letter
        canvas.setStrokeColor(colors.HexColor("#D8E1DC")); canvas.setLineWidth(.5); canvas.line(.72*inch, .46*inch, w-.72*inch, .46*inch)
        canvas.setFont("DejaVu", 7.5); canvas.setFillColor(colors.HexColor(PALETTE["gray"]))
        canvas.drawString(.72*inch, .3*inch, "WeeWare · Palawan LASSO training evidence · 10 November 2026")
        canvas.drawRightString(w-.72*inch, .3*inch, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    manifest = {
        "report": pdf_path.name,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "experiment_id": meta["id"],
        "dataset_sha256": hash_file(DATA_PATH),
        "model_sha256": hash_file(NEW_PATH),
        "previous_model_sha256": hash_file(OLD_PATH),
        "live_prediction_weather": weather,
        "previous_prediction": previous,
        "retrained_prediction": {"rate": live["rate"], "raw_rate": live["raw_rate"], "risk": live["risk"]},
        "images": [str(p.relative_to(ROOT)) for p in plots],
    }
    (ARTIFACTS / "report_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"pdf": str(pdf_path), "bytes": pdf_path.stat().st_size, "images": [str(p) for p in plots], "experiment_id": meta["id"], "target_rows": len(data), "target_methods": detail["target_aggregation"].value_counts().to_dict(), "prediction_comparison": {"old": previous, "new": {"rate": live["rate"], "risk": live["risk"]}}}, indent=2))
    return pdf_path


if __name__ == "__main__":
    build_report()
