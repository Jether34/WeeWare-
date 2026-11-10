"""Join Palawan infestation records to verified historical weather inputs.

Weather source: NASA POWER monthly point API. Location centres are resolved
through OpenStreetMap Nominatim and retained with each output row. This script
also compares every available local CMIP6 variable/file against NASA POWER over
their overlapping months. It does not overwrite or retrain the active model.
"""
from __future__ import annotations

import calendar
import json
import math
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
TRAINING_DIR = ROOT / "datasets" / "training"
CLIMATE_DIR = ROOT / "datasets" / "climate" / "netcdf"
OUTPUT_DIR = ROOT / "datasets" / "processed" / "climate_training"
CACHE_DIR = OUTPUT_DIR / "source_cache"
NASA_PARAMETERS = "PRECTOTCORR,T2M,RH2M,WS10M,ALLSKY_SFC_SW_DWN"
NASA_FEATURE_MAP = {
    "PRECTOTCORR": "rainfall",
    "T2M": "temperature",
    "RH2M": "humidity",
    "ALLSKY_SFC_SW_DWN": "solar",
    "WS10M": "wind",
}
TRAINING_COLUMNS = {
    "year": "SOLAR RAD",
    "solar": "ANN (Mj/m^2/d)",
    "humidity": "ANN (%)",
    "wind": "ANN (m/s)",
    "temperature": "ANN (*C)",
    "rainfall": "TOTAL (mm)",
    "infestation": "TOTAL (%)",
}
FEATURES = ("rainfall", "temperature", "humidity", "solar", "wind")
MONTHS = {name[:3].lower(): number for number, name in enumerate(calendar.month_name) if name}
# Philippine Statistics Authority PSGC lists 23 municipalities in Palawan.
# Puerto Princesa is also included because it is a separate highly urbanized city.
PALAWAN_AREAS = (
    "Aborlan", "Agutaya", "Araceli", "Balabac", "Bataraza", "Brooke's Point", "Busuanga",
    "Cagayancillo", "Coron", "Cuyo", "Dumaran", "El Nido", "Linapacan", "Magsaysay", "Narra",
    "Quezon", "Roxas", "San Vicente", "Taytay", "Kalayaan", "Culion", "Rizal", "Sofronio Española",
    "Puerto Princesa",
)


def _request_json(url: str, *, user_agent: str = "WeeWare-Palawan-Climate-Research/1.0") -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def _normalise_site(name: str) -> str:
    value = name.strip().replace("�", "ñ")
    value = re.sub(r"\s*\([^)]*district\)\s*$", "", value, flags=re.IGNORECASE)
    aliases = {"Sofronio Española": "Sofronio Española", "Española": "Sofronio Española"}
    return aliases.get(value, value)


def read_infestation_observations() -> tuple[pd.DataFrame, pd.DataFrame]:
    monthly: list[dict[str, Any]] = []
    csv_path = TRAINING_DIR / "INFESTATION DATA FINAL(Sheet1).csv"
    frame = pd.read_csv(csv_path, header=None)
    site = ""
    for _, row in frame.iterrows():
        first = row.iloc[0]
        if isinstance(first, str) and first.strip() not in {"", "Year"} and not first.strip().isdigit() and pd.isna(row.iloc[1]):
            site = first.strip()
            continue
        if str(first).strip().isdigit() and isinstance(row.iloc[1], str):
            month = MONTHS.get(row.iloc[1].strip().lower()[:3])
            rate = pd.to_numeric(row.iloc[2], errors="coerce")
            if month and pd.notna(rate):
                monthly.append({"location": _normalise_site(site), "year": int(first), "month": month,
                                "infestation_rate_input": float(rate), "rate_unit_input": "fraction",
                                "target_source": csv_path.name, "target_aggregation_group": "monthly_simple_mean"})

    for path in sorted(TRAINING_DIR.glob("Infestation_Absolute_Log_Transformations_*.xlsx")):
        data = pd.read_excel(path, sheet_name=0, header=2)
        data.columns = [str(column).strip() for column in data.columns]
        for _, row in data.iterrows():
            location = row.get("Municipality / Location")
            period = row.get("Period")
            if pd.isna(location) or pd.isna(period):
                continue
            match = re.fullmatch(r"\s*(\d{4})\s*-\s*([A-Za-z]+)\s*", str(period))
            if not match:
                continue
            month = MONTHS.get(match.group(2).lower()[:3])
            rate = pd.to_numeric(row.get("Infestation Rate (Decimal)"), errors="coerce")
            harvest = pd.to_numeric(row.get("Estimated Harvest (MT)"), errors="coerce")
            damaged = pd.to_numeric(row.get("Damaged Volume (MT)"), errors="coerce")
            if month and pd.notna(rate) and pd.notna(harvest) and pd.notna(damaged):
                monthly.append({"location": _normalise_site(str(location)), "year": int(match.group(1)), "month": month,
                                "infestation_rate_input": float(rate), "rate_unit_input": "fraction",
                                "estimated_harvest_mt": float(harvest), "damaged_volume_mt": float(damaged),
                                "target_source": path.name, "target_aggregation_group": "harvest_weighted"})

    monthly_frame = pd.DataFrame(monthly)
    if monthly_frame.empty:
        raise ValueError("No infestation observations were parsed from the new training files.")
    monthly_frame["infestation_rate_pct"] = monthly_frame["infestation_rate_input"] * 100.0
    if monthly_frame.duplicated(["location", "year", "month"]).any():
        duplicates = monthly_frame.loc[monthly_frame.duplicated(["location", "year", "month"], keep=False), ["location", "year", "month", "target_source"]]
        raise ValueError(f"Duplicate site/year/month target observations found:\n{duplicates.to_string(index=False)}")

    annual: list[dict[str, Any]] = []
    for (location, year), group in monthly_frame.groupby(["location", "year"], sort=True):
        if group["target_aggregation_group"].nunique() != 1:
            raise ValueError(f"Mixed target aggregation methods for {location}, {year}.")
        if group["target_aggregation_group"].iloc[0] == "harvest_weighted":
            total_harvest = float(group["estimated_harvest_mt"].sum())
            target_pct = 100.0 * float(group["damaged_volume_mt"].sum()) / total_harvest if total_harvest else np.nan
            aggregation = "sum_damaged_volume / sum_estimated_harvest"
        else:
            target_pct = float(group["infestation_rate_pct"].mean())
            aggregation = "unweighted mean of available sampled months; no harvest denominator in source"
        annual.append({"location": location, "year": int(year), "infestation_rate_pct": target_pct,
                       "target_month_count": int(group["month"].nunique()), "target_months": ",".join(f"{m:02d}" for m in sorted(group["month"].unique())),
                       "target_aggregation": aggregation, "target_sources": "; ".join(sorted(group["target_source"].unique()))})

    # Keep the original Puerto Princesa annual observations as additional labelled rows.
    original_path = TRAINING_DIR / "WEEWARE FINAL DATASET 2014-2025.csv"
    original = pd.read_csv(original_path)
    required = set(TRAINING_COLUMNS.values())
    if not required.issubset(original.columns):
        raise ValueError("The existing annual training file does not contain its documented columns.")
    for _, row in original.iterrows():
        year = pd.to_numeric(row[TRAINING_COLUMNS["year"]], errors="coerce")
        target = pd.to_numeric(row[TRAINING_COLUMNS["infestation"]], errors="coerce")
        if pd.isna(year) or pd.isna(target):
            continue
        annual.append({"location": "Puerto Princesa", "year": int(year), "infestation_rate_pct": float(target),
                       "target_month_count": 12, "target_months": "annual", "target_aggregation": "source annual target; kept on source numeric percent scale",
                       "target_sources": original_path.name})
    annual_frame = pd.DataFrame(annual)
    if annual_frame.duplicated(["location", "year"]).any():
        dup = annual_frame.loc[annual_frame.duplicated(["location", "year"], keep=False), ["location", "year", "target_sources"]]
        raise ValueError(f"Duplicate location/year target rows found:\n{dup.to_string(index=False)}")
    return monthly_frame.sort_values(["location", "year", "month"]).reset_index(drop=True), annual_frame.sort_values(["location", "year"]).reset_index(drop=True)


def resolve_site_coordinates(locations: list[str]) -> dict[str, dict[str, Any]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict[str, Any]] = {}
    for location in locations:
        cache_path = CACHE_DIR / f"geocode_{re.sub(r'[^a-z0-9]+', '_', location.lower()).strip('_')}.json"
        if cache_path.exists():
            candidates = json.loads(cache_path.read_text(encoding="utf-8"))
        else:
            query = f"{location}, Palawan, Philippines"
            url = "https://nominatim.openstreetmap.org/search?" + urlencode({"q": query, "format": "jsonv2", "limit": 5})
            candidates = _request_json(url, user_agent="WeeWare-Palawan-Climate-Research/1.0")
            cache_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
            time.sleep(1.1)  # Nominatim public service usage policy.
        if not isinstance(candidates, list):
            raise ValueError(f"Geocoder returned an unexpected response for {location}.")
        accepted = [candidate for candidate in candidates if "Palawan" in candidate.get("display_name", "") and "Philippines" in candidate.get("display_name", "")]
        if not accepted:
            raise ValueError(f"Could not resolve {location} to a Palawan municipality centre. Review geocode cache and add a verified coordinate.")
        candidate = accepted[0]
        result[location] = {"latitude": float(candidate["lat"]), "longitude": float(candidate["lon"]),
                            "geocode_display_name": candidate.get("display_name", ""),
                            "geocode_source": "OpenStreetMap Nominatim; municipality/town centre approximation",
                            "geocode_url": "https://nominatim.openstreetmap.org/"}
    return result


def nasa_power_monthly(location: str, coordinates: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, Any]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"nasa_power_{re.sub(r'[^a-z0-9]+', '_', location.lower()).strip('_')}_2014_2025.json"
    if cache_path.exists():
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    else:
        params = {"parameters": NASA_PARAMETERS, "community": "AG", "longitude": coordinates["longitude"],
                  "latitude": coordinates["latitude"], "start": "201401", "end": "202512", "format": "JSON"}
        # POWER's monthly API expects year bounds rather than YYYYMM.
        params["start"] = "2014"
        params["end"] = "2025"
        url = "https://power.larc.nasa.gov/api/temporal/monthly/point?" + urlencode(params)
        payload = _request_json(url)
        cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    properties = payload.get("properties", {})
    parameters = properties.get("parameter", {})
    meta = payload.get("parameters", {})
    geometry = payload.get("geometry", {}).get("coordinates", [])
    snapped = {"nasa_grid_longitude": geometry[0] if len(geometry) > 1 else None,
               "nasa_grid_latitude": geometry[1] if len(geometry) > 1 else None,
               "nasa_grid_elevation_m": geometry[2] if len(geometry) > 2 else None,
               "nasa_sources": ";".join(payload.get("header", {}).get("sources", [])),
               "nasa_api": "NASA POWER Monthly Point API", "nasa_api_url": "https://power.larc.nasa.gov/api/temporal/monthly/point"}
    month_keys = sorted({key for values in parameters.values() for key in values if len(key) == 6 and key[-2:] != "13"})
    rows: list[dict[str, Any]] = []
    for key in month_keys:
        row = {"location": location, "year": int(key[:4]), "month": int(key[4:]), **snapped}
        for source_name, feature in NASA_FEATURE_MAP.items():
            value = parameters.get(source_name, {}).get(key)
            row[feature] = float(value) if value is not None and math.isfinite(float(value)) and float(value) > -900 else np.nan
        # NASA precipitation is a monthly mean daily rate (mm/day); store the
        # monthly total for matching the CMIP6 monthly pr conversion.
        row["rainfall"] *= calendar.monthrange(row["year"], row["month"])[1]
        rows.append(row)
    frame = pd.DataFrame(rows)
    for feature in FEATURES:
        if feature not in frame or frame[feature].isna().any():
            raise ValueError(f"NASA POWER has missing {feature} values for {location}.")
    units = {name: value.get("units") for name, value in meta.items()}
    return frame, {**snapped, "nasa_input_units": units, "nasa_monthly_rainfall_conversion": "PRECTOTCORR mm/day multiplied by days in calendar month"}


def _convert_cmip6(feature: str, value: float, units: str, year: int, month: int) -> float:
    unit = units.lower().replace(" ", "")
    if feature == "temperature" and unit in {"k", "kelvin"}:
        return value - 273.15
    if feature == "rainfall" and ("s-1" in unit or "/s" in unit or "s**-1" in unit):
        return value * calendar.monthrange(year, month)[1] * 86400.0
    if feature == "rainfall" and ("mm/day" in unit or "mmday-1" in unit):
        return value * calendar.monthrange(year, month)[1]
    if feature == "solar" and ("wm-2" in unit or "w/m2" in unit or "watt" in unit):
        return value * 0.0864
    return value


def compare_cmip6_to_nasa(nasa_monthly: pd.DataFrame, coordinates: dict[str, dict[str, Any]]) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    for path in sorted(CLIMATE_DIR.glob("*.nc")):
        name = path.name
        feature = next((candidate for candidate, variable in {"rainfall": "pr", "temperature": "tas", "humidity": "hurs", "solar": "rsds", "wind": "sfcWind"}.items() if name.startswith(f"{variable}_") or f"_{variable}_" in name), None)
        if not feature:
            continue
        variable = {"rainfall": "pr", "temperature": "tas", "humidity": "hurs", "solar": "rsds", "wind": "sfcWind"}[feature]
        try:
            with xr.open_dataset(path, decode_times=True) as ds:
                lat_name = next((n for n in ("lat", "latitude", "nav_lat") if n in ds.coords or n in ds.variables), None)
                lon_name = next((n for n in ("lon", "longitude", "nav_lon") if n in ds.coords or n in ds.variables), None)
                if not lat_name or not lon_name or "time" not in ds.coords or variable not in ds:
                    continue
                lon_values = np.asarray(ds[lon_name].values)
                years = np.asarray(ds.time.dt.year.values, dtype=int)
                months = np.asarray(ds.time.dt.month.values, dtype=int)
                units = str(ds[variable].attrs.get("units", ""))
                time_lookup = {(int(year), int(month)): index for index, (year, month) in enumerate(zip(years, months))}
                for location, point in coordinates.items():
                    site_weather = nasa_monthly.loc[nasa_monthly.location == location]
                    if site_weather.empty:
                        continue
                    nasa_grid_lat = float(site_weather.nasa_grid_latitude.iloc[0])
                    nasa_grid_lon = float(site_weather.nasa_grid_longitude.iloc[0])
                    target_lon = point["longitude"] % 360 if np.nanmin(lon_values) >= 0 and point["longitude"] < 0 else point["longitude"]
                    selected = ds[variable].sel({lat_name: point["latitude"], lon_name: target_lon}, method="nearest")
                    model_lat = float(ds[lat_name].sel({lat_name: point["latitude"]}, method="nearest").values)
                    model_lon = float(ds[lon_name].sel({lon_name: target_lon}, method="nearest").values)
                    observed = site_weather.set_index(["year", "month"])
                    for (year, month), index in time_lookup.items():
                        if (year, month) not in observed.index:
                            continue
                        model_value = float(np.asarray(selected.isel(time=index).values).squeeze())
                        if not math.isfinite(model_value):
                            continue
                        model_value = _convert_cmip6(feature, model_value, units, year, month)
                        observed_value = float(observed.loc[(year, month), feature])
                        parts.append(pd.DataFrame([{"location": location, "year": year, "month": month, "feature": feature,
                            "cmip6_value": model_value, "nasa_power_value": observed_value,
                            "difference_cmip6_minus_nasa": model_value - observed_value,
                            "cmip6_file": name, "cmip6_model_latitude": model_lat, "cmip6_model_longitude": model_lon,
                            "cmip6_units": units, "nasa_grid_latitude": nasa_grid_lat, "nasa_grid_longitude": nasa_grid_lon}]))
        except (ImportError, OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            print(f"SKIP CMIP6 {name}: {type(exc).__name__}: {exc}")
    if not parts:
        return pd.DataFrame()
    pairs = pd.concat(parts, ignore_index=True)
    comparisons: list[dict[str, Any]] = []
    for (feature, source), group in pairs.groupby(["feature", "cmip6_file"], sort=True):
        delta = group["difference_cmip6_minus_nasa"].to_numpy(dtype=float)
        model = group["cmip6_value"].to_numpy(dtype=float)
        observed = group["nasa_power_value"].to_numpy(dtype=float)
        corr = float(np.corrcoef(model, observed)[0, 1]) if len(group) > 1 and np.std(model) > 0 and np.std(observed) > 0 else np.nan
        comparisons.append({"feature": feature, "cmip6_file": source, "paired_site_months": len(group),
            "year_start": int(group.year.min()), "year_end": int(group.year.max()),
            "cmip6_mean": float(model.mean()), "nasa_power_mean": float(observed.mean()),
            "mean_bias_cmip6_minus_nasa": float(delta.mean()), "mae": float(np.abs(delta).mean()),
            "rmse": float(np.sqrt(np.mean(delta ** 2))), "correlation": corr,
            "distinct_cmip6_grid_cells": int(group[["cmip6_model_latitude", "cmip6_model_longitude"]].drop_duplicates().shape[0]),
            "interpretation": "monthly paired model-vs-reanalysis comparison; not an exact-weather forecast verification"})
    pairs.to_csv(OUTPUT_DIR / "cmip6_nasa_monthly_pairs.csv", index=False)
    pd.DataFrame(comparisons).to_csv(OUTPUT_DIR / "cmip6_nasa_comparison_summary.csv", index=False)
    return pd.DataFrame(comparisons)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    infestation_monthly, annual_targets = read_infestation_observations()
    labelled_locations = sorted(set(infestation_monthly.location) | set(annual_targets.location))
    locations = sorted(set(labelled_locations) | set(PALAWAN_AREAS))
    coordinates = resolve_site_coordinates(locations)
    coordinate_rows = [{"location": location, **coordinates[location]} for location in locations]
    pd.DataFrame(coordinate_rows).to_csv(OUTPUT_DIR / "palawan_location_coordinates.csv", index=False)

    weather_frames: list[pd.DataFrame] = []
    for index, location in enumerate(locations, start=1):
        print(f"NASA POWER {index}/{len(locations)}: {location}")
        frame, _meta = nasa_power_monthly(location, coordinates[location])
        weather_frames.append(frame)
        if index % 5 == 0:
            time.sleep(0.3)
    weather = pd.concat(weather_frames, ignore_index=True)
    weather.to_csv(OUTPUT_DIR / "nasa_power_monthly_weather.csv", index=False)
    monthly = infestation_monthly.merge(weather, on=["location", "year", "month"], how="left", validate="one_to_one")
    missing = monthly[monthly[list(FEATURES)].isna().any(axis=1)]
    if not missing.empty:
        raise ValueError(f"Weather join left {len(missing)} infestation rows unmatched.")
    monthly.to_csv(OUTPUT_DIR / "palawan_monthly_infestation_weather.csv", index=False)

    # Annual weather features align with the existing model: rainfall is a sum;
    # the four rate-like features are calendar-day-weighted annual means.
    weather = weather.copy()
    weather["days_in_month"] = [calendar.monthrange(int(y), int(m))[1] for y, m in zip(weather.year, weather.month)]
    annual_weather_rows = []
    for (location, year), group in weather.groupby(["location", "year"], sort=True):
        annual_weather_rows.append({"location": location, "year": int(year),
            "rainfall": float(group.rainfall.sum()),
            **{feature: float(np.average(group[feature], weights=group.days_in_month)) for feature in ("temperature", "humidity", "solar", "wind")},
            "weather_source": "NASA POWER Monthly Point API", "weather_month_count": int(group.month.nunique()),
            "nasa_grid_latitude": float(group.nasa_grid_latitude.iloc[0]), "nasa_grid_longitude": float(group.nasa_grid_longitude.iloc[0])})
    annual_weather = pd.DataFrame(annual_weather_rows)
    annual_weather.to_csv(OUTPUT_DIR / "palawan_municipality_annual_weather.csv", index=False)
    annual = annual_targets.merge(annual_weather, on=["location", "year"], how="left", validate="one_to_one")
    annual = annual.loc[annual.year.between(2014, 2025)].copy()
    annual["infestation_rate"] = annual["infestation_rate_pct"]
    annual.to_csv(OUTPUT_DIR / "palawan_lasso_training_annual.csv", index=False)
    final_columns = ["location", "year", *FEATURES, "infestation_rate"]
    annual[final_columns].to_csv(OUTPUT_DIR / "palawan_retraining_dataset.csv", index=False)

    # Compare the original Puerto Princesa annual weather fields to NASA's same
    # year aggregates so the legacy climate measurements have an explicit check.
    original = pd.read_csv(TRAINING_DIR / "WEEWARE FINAL DATASET 2014-2025.csv")
    pp_weather = annual_weather.loc[annual_weather.location == "Puerto Princesa"].set_index("year")
    legacy_pairs = []
    for _, row in original.iterrows():
        year = int(row[TRAINING_COLUMNS["year"]])
        if year not in pp_weather.index:
            continue
        for feature in FEATURES:
            source_column = TRAINING_COLUMNS[feature]
            source_value = float(row[source_column])
            nasa_value = float(pp_weather.loc[year, feature])
            legacy_pairs.append({"year": year, "feature": feature, "legacy_training_value": source_value,
                                "nasa_power_value": nasa_value, "legacy_minus_nasa": source_value - nasa_value,
                                "legacy_source_column": source_column})
    pd.DataFrame(legacy_pairs).to_csv(OUTPUT_DIR / "legacy_training_vs_nasa_power.csv", index=False)

    comparisons = compare_cmip6_to_nasa(weather, coordinates)
    if not comparisons.empty:
        comparisons.to_csv(OUTPUT_DIR / "cmip6_nasa_comparison_summary.csv", index=False)

    sources = {
        "weather_source": "NASA POWER Monthly Point API",
        "weather_source_url": "https://power.larc.nasa.gov/api/temporal/monthly/point",
        "weather_source_docs": "https://power.larc.nasa.gov/docs/services/api/temporal/monthly/",
        "weather_variables": {"rainfall": "PRECTOTCORR, converted from mm/day to monthly/annual mm", "temperature": "T2M, °C", "humidity": "RH2M, %", "solar": "ALLSKY_SFC_SW_DWN, MJ/m²/day", "wind": "WS10M, m/s"},
        "coordinate_source": "OpenStreetMap Nominatim municipality/town centres; approximation, not farm coordinates",
        "coordinate_source_url": "https://nominatim.openstreetmap.org/",
        "cmip6_comparison": "Only exact overlapping months are paired. Bias, MAE, RMSE and correlation are descriptive; CMIP6 monthly climate outputs are not expected to reproduce observed weather month-for-month.",
        "target_units": "New input infestation rates explicitly marked decimal are converted to percent by multiplying by 100; existing annual WeeWare targets are retained on their existing 0-5 numeric percentage-point scale.",
        "target_aggregation": "Workbook observations use summed damaged volume divided by summed estimated harvest. CSV observations without harvest denominators use the unweighted mean of available sampled-month rates. Source rows are preserved in palawan_monthly_infestation_weather.csv.",
        "training_readiness": "The annual table contains one location-year row per target sample and all five weather features. It is not accepted unchanged by the current training endpoint: that endpoint rejects duplicate years and caps target values at 5, while this table has multiple locations per year and percent values up to 52.15. The pipeline must support grouped spatial samples and an output scale consistent with the source rates before activation.",
        "municipality_coverage": "NASA POWER annual weather is assembled for all 23 Palawan municipalities listed by PSA PSGC plus Puerto Princesa City. Narra has weather rows but no infestation label in the supplied files, so Narra is excluded from supervised training rows.",
        "caution": "Target methods/units differ between the legacy annual dataset and new area/month records. Review the target definitions and the annual training output before fitting one model. NASA POWER spatial resolution differs by parameter; municipality centres and coarse CMIP6 cells may repeat values across locations.",
        "outputs": ["palawan_retraining_dataset.csv", "palawan_monthly_infestation_weather.csv", "palawan_lasso_training_annual.csv", "palawan_municipality_annual_weather.csv", "nasa_power_monthly_weather.csv", "palawan_location_coordinates.csv", "legacy_training_vs_nasa_power.csv", "cmip6_nasa_monthly_pairs.csv", "cmip6_nasa_comparison_summary.csv"]}
    (OUTPUT_DIR / "source_notes.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nPrepared files at", OUTPUT_DIR)
    print("monthly infestation rows", len(monthly), "annual training rows", len(annual))
    print("CMIP6 comparison groups", len(comparisons))
    print("all weather features present", not annual[list(FEATURES)].isna().any().any())


if __name__ == "__main__":
    main()
