"""Create the 3D training, data, model, and validation figures used in the guide."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "reports" / "system_documentation"
VISUALS = DOCS / "visualizations"
DATA = ROOT / "datasets" / "processed" / "climate_training" / "palawan_retraining_dataset.csv"
EXPERIMENT = ROOT / "ml-service" / "model_experiments" / "35a8782a52494c5ea97dc3f086018427" / "experiment.json"
MODEL = ROOT / "ml-service" / "models" / "lasso_weevil_model.joblib"

VISUALS.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.titleweight": "bold", "axes.titlesize": 14})

data = pd.read_csv(DATA).sort_values(["year", "location"]).reset_index(drop=True)
experiment = json.loads(EXPERIMENT.read_text(encoding="utf-8"))
artifact = joblib.load(MODEL)
features = artifact["features"]

# 1. Annual weather/infestation records. Flat bands in z expose recurring labels.
fig = plt.figure(figsize=(12, 8), constrained_layout=True)
ax = fig.add_subplot(111, projection="3d")
scatter = ax.scatter(data["rainfall"], data["temperature"], data["infestation_rate"],
                     c=data["year"], cmap="viridis", s=42, alpha=0.82, edgecolor="white", linewidth=0.25)
ax.set_title("Palawan training records: weather and infestation")
ax.set_xlabel("Annual rainfall (mm)", labelpad=10)
ax.set_ylabel("Mean temperature (°C)", labelpad=10)
ax.set_zlabel("Recorded infestation rate (%)", labelpad=9)
fig.colorbar(scatter, ax=ax, pad=0.12, shrink=0.68, label="Record year")
ax.text2D(0.02, 0.02, "100 site-year rows · 23 locations · 2014–2025\nHorizontal bands show labels reused across years.", transform=ax.transAxes, fontsize=9)
fig.savefig(VISUALS / "3d_training_data.png", dpi=180, facecolor="white")
plt.close(fig)

# Data source mix: the label collection/aggregation method changes between rows.
fig = plt.figure(figsize=(11, 7), constrained_layout=True)
ax = fig.add_subplot(111, projection="3d")
source_labels = ["Earlier annual\nlabels", "Damage ÷\nestimated harvest", "Mean sampled\nmonthly rates"]
source_counts = [12, 36, 52]
source_colors = ["#4c78a8", "#176b49", "#e88935"]
for index, (label, count, color) in enumerate(zip(source_labels, source_counts, source_colors)):
    ax.bar3d(index * 1.4, 0, 0, 0.9, 0.8, count, color=color, shade=True, alpha=0.92)
    ax.text(index * 1.4 + 0.45, 0.4, count + 1.0, str(count), ha="center", fontsize=10)
ax.set_xticks([0.45, 1.85, 3.25], source_labels)
ax.set_yticks([])
ax.set_zlabel("Training rows", labelpad=10)
ax.set_title("Infestation label sources in the 100-row training set")
ax.text2D(0.02, 0.02, "Different source/aggregation rules mean the target is not fully uniform across rows.", transform=ax.transAxes, fontsize=9, color="#9b342c")
fig.savefig(VISUALS / "3d_infestation_label_sources.png", dpi=180, facecolor="white")
plt.close(fig)

# 2. Conditional surface from the active fitted artifact; remaining inputs fixed at medians.
rain = np.linspace(data["rainfall"].quantile(0.03), data["rainfall"].quantile(0.97), 42)
temp = np.linspace(data["temperature"].quantile(0.03), data["temperature"].quantile(0.97), 42)
rain_grid, temp_grid = np.meshgrid(rain, temp)
base = data[features].median(numeric_only=True)
grid = pd.DataFrame({feature: np.full(rain_grid.size, base[feature]) for feature in features})
grid["rainfall"] = rain_grid.ravel()
grid["temperature"] = temp_grid.ravel()
predicted = np.asarray(artifact["pipeline"].predict(grid[features])).reshape(rain_grid.shape)
fig = plt.figure(figsize=(12, 8), constrained_layout=True)
ax = fig.add_subplot(111, projection="3d")
surface = ax.plot_surface(rain_grid, temp_grid, predicted, cmap="YlGn", linewidth=0, antialiased=True, alpha=0.9)
ax.set_title("Active LASSO model response surface")
ax.set_xlabel("Annual rainfall (mm)", labelpad=10)
ax.set_ylabel("Mean temperature (°C)", labelpad=10)
ax.set_zlabel("Predicted infestation rate (%)", labelpad=9)
fig.colorbar(surface, ax=ax, pad=0.12, shrink=0.68, label="Predicted rate (%)")
ax.text2D(0.02, 0.02, "Only rainfall and temperature vary. Humidity, solar radiation, and wind are held at training medians.", transform=ax.transAxes, fontsize=9)
fig.savefig(VISUALS / "3d_lasso_response_surface.png", dpi=180, facecolor="white")
plt.close(fig)

# 3. Leave-one-year-out estimates, colored by absolute held-out error.
validation = experiment["validation"]
observed = np.asarray(validation["observed"], dtype=float)
predictions = np.asarray(validation["predictions"], dtype=float)
years = np.asarray(validation["years"], dtype=int)
absolute_error = np.abs(predictions - observed)
fig = plt.figure(figsize=(12, 8), constrained_layout=True)
ax = fig.add_subplot(111, projection="3d")
scatter = ax.scatter(observed, predictions, years, c=absolute_error, cmap="YlOrRd", s=44, alpha=0.86, edgecolor="white", linewidth=0.25)
low = min(observed.min(), predictions.min())
high = max(observed.max(), predictions.max())
ideal = np.linspace(low, high, 100)
for year in np.unique(years):
    ax.plot(ideal, ideal, np.full_like(ideal, year), color="#176b49", linewidth=1.2, alpha=0.18)
ax.plot(ideal, ideal, np.full_like(ideal, years.max()), color="#176b49", linewidth=2, label="Perfect estimate line (each year)")
ax.set_title(f"Held-out-year predictions · RMSE {validation['rmse']:.2f} points")
ax.set_xlabel("Observed infestation (%)", labelpad=10)
ax.set_ylabel("Predicted infestation (%)", labelpad=10)
ax.set_zlabel("Held-out year", labelpad=9)
fig.colorbar(scatter, ax=ax, pad=0.12, shrink=0.68, label="Absolute error (percentage points)")
ax.legend(loc="upper left", fontsize=8)
fig.savefig(VISUALS / "3d_held_out_predictions.png", dpi=180, facecolor="white")
plt.close(fig)

# 4. Model vs simple-mean baseline across year and location holdouts.
scores = [
    ("Year holdout", "LASSO", validation["mae"], validation["rmse"]),
    ("Year holdout", "Mean baseline", validation["baseline_mae"], validation["baseline_rmse"]),
    ("Location holdout", "LASSO", experiment["spatial_validation"]["mae"], experiment["spatial_validation"]["rmse"]),
    ("Location holdout", "Mean baseline", experiment["spatial_validation"]["baseline_mae"], experiment["spatial_validation"]["baseline_rmse"]),
]
fig = plt.figure(figsize=(12, 8), constrained_layout=True)
ax = fig.add_subplot(111, projection="3d")
for eval_index, evaluation in enumerate(("Year holdout", "Location holdout")):
    for model_index, model_name in enumerate(("LASSO", "Mean baseline")):
        row = next(row for row in scores if row[0] == evaluation and row[1] == model_name)
        x = eval_index * 3 + model_index
        color = "#176b49" if model_name == "LASSO" else "#9aaca2"
        for metric_index, value in enumerate((row[2], row[3])):
            ax.bar3d(x, metric_index, 0, 0.68, 0.62, value, color=color, shade=True, alpha=0.92)
            ax.text(x + 0.34, metric_index + 0.31, value + 0.45, f"{value:.2f}", ha="center", va="bottom", fontsize=8)
ax.set_xticks([0.5, 1.5, 3.5, 4.5], ["Year\nLASSO", "Year\nbaseline", "Location\nLASSO", "Location\nbaseline"])
ax.set_yticks([0.3, 1.3], ["MAE", "RMSE"])
ax.set_zlabel("Error (percentage points; lower is better)", labelpad=10)
ax.set_title("3D validation scores: year vs location holdouts")
ax.text2D(0.02, 0.02, "For unseen locations, the LASSO RMSE (20.41) is higher than the mean baseline (19.46).", transform=ax.transAxes, fontsize=9, color="#9b342c")
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color="#176b49", label="LASSO"), Patch(color="#9aaca2", label="Training-mean baseline")], loc="upper left", fontsize=8)
fig.savefig(VISUALS / "3d_validation_scores.png", dpi=180, facecolor="white")
plt.close(fig)

print(f"Created five 3D figures in {VISUALS}")
