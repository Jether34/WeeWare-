"""CMIP6 and observed climate data access for WeeWare.


//this system extracts climate data for coordinates across the supported Palawan study area using available CMIP6 model outputs and labeled training-climatology fallbacks. The service retrieves monthly climate variables such as rainfall, temperature, humidity, solar radiation, and wind speed for specified years and locations.
//developed by Jether Garque
//MIT License must be included in all copies or substantial portions of the software.



The imported NetCDF files are retained under datasets/climate/netcdf. Missing
feature/year coverage is reported as a training-climatology fallback; the
service never labels a fallback value as a CMIP6 observation.
"""
from __future__ import annotations

import calendar
import functools
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
CLIMATE_DIR = ROOT / "datasets" / "climate" / "netcdf"
TRAINING_CSV = ROOT / "datasets" / "training" / "WEEWARE FINAL DATASET 2014-2025.csv"
FEATURES = ("rainfall", "temperature", "humidity", "solar", "wind")
TRAINING_COLUMNS = {"year": "SOLAR RAD", "solar": "ANN (Mj/m^2/d)", "humidity": "ANN (%)", "wind": "ANN (m/s)", "temperature": "ANN (*C)", "rainfall": "TOTAL (mm)", "infestation": "TOTAL (%)"}
VARIABLES = {"rainfall": "pr", "temperature": "tas", "humidity": "hurs", "solar": "rsds", "wind": "sfcWind"}
LOCATION = {"lat": 9.7494, "lng": 118.7384, "name": "Puerto Princesa, Palawan, Philippines"}
_PATTERNS = {
    "rainfall": ("pr_Amon_CanESM5-1_ssp245*.nc", "pr_Amon_GISS-E2-1-G_historical*.nc"),
    "temperature": ("tas_Amon_CanESM5_dcppB-forecast*.nc", "tas_Amon_CanESM5-1_ssp245*.nc", "tas_Amon_GISS*.nc"),
    "humidity": ("hurs_Amon_CanESM5_dcppB-forecast*.nc", "hurs_Amon_CanESM5-1_ssp245*.nc", "hurs_Amon_GISS*.nc"),
    "solar": ("rsds_Amon_CanESM5-1_ssp245*.nc", "rsds_Amon_CanESM5_dcppB-forecast*.nc", "rsds_Amon_GISS-E3-G_historical*.nc"),
    "wind": ("sfcWind_Amon_CanESM5_dcppB-forecast*.nc", "sfcWind_Amon_CanESM5-1_ssp245*.nc", "sfcWind_Amon_GISS*.nc"),
}


@functools.lru_cache(maxsize=1)
def training_rows() -> dict[int, dict[str, float]]:
    """Read the original wide LASSO sheet by its documented value columns."""
    if not TRAINING_CSV.exists():
        return {}
    frame = pd.read_csv(TRAINING_CSV)
    if not set(TRAINING_COLUMNS.values()).issubset(frame.columns):
        return {}
    values = frame[list(TRAINING_COLUMNS.values())].apply(pd.to_numeric, errors="coerce").dropna()
    result: dict[int, dict[str, float]] = {}
    for _, row in values.iterrows():
        year = int(row[TRAINING_COLUMNS["year"]])
        if year < 1900 or year > 2100 or year in result:
            continue
        result[year] = {name: float(row[column]) for name, column in TRAINING_COLUMNS.items() if name != "year"}
    return result


def training_climatology() -> dict[str, float]:
    rows = list(training_rows().values())
    if not rows:
        return {"rainfall": 0.0, "temperature": 0.0, "humidity": 0.0, "solar": 0.0, "wind": 0.0}
    return {feature: float(np.mean([row[feature] for row in rows])) for feature in FEATURES}


def _coordinate(ds: xr.Dataset, options: tuple[str, ...]) -> str | None:
    return next((name for name in options if name in ds.coords or name in ds.variables), None)


def _convert(feature: str, value: float, units: str, year: int, month: int) -> float:
    unit = units.lower().replace(" ", "")
    if feature == "temperature" and (unit in {"k", "kelvin"} or "kelvin" in unit):
        return value - 273.15
    if feature == "rainfall":
        if "s-1" in unit or "/s" in unit or "s**-1" in unit:
            return value * calendar.monthrange(year, month)[1] * 86400.0
        if "mm/day" in unit or "mmday-1" in unit:
            return value * calendar.monthrange(year, month)[1]
    if feature == "solar" and ("wm-2" in unit or "w/m2" in unit or "watt" in unit):
        return value * 0.0864
    return value


@functools.lru_cache(maxsize=256)
def _cmip6_year(feature: str, year: int, lat: float, lng: float) -> tuple[tuple[float | None, ...], str | None]:
    variable = VARIABLES[feature]
    files: list[Path] = []
    for pattern in _PATTERNS[feature]:
        files.extend(CLIMATE_DIR.glob(pattern))
    files = sorted(set(files))
    selected: list[tuple[int, float, str]] = []
    for path in files:
        try:
            with xr.open_dataset(path, decode_times=True) as ds:
                lat_name = _coordinate(ds, ("lat", "latitude", "nav_lat"))
                lon_name = _coordinate(ds, ("lon", "longitude", "nav_lon"))
                time_name = _coordinate(ds, ("time",))
                if not lat_name or not lon_name or not time_name or variable not in ds:
                    continue
                lons = np.asarray(ds[lon_name].values)
                target_lng = lng
                if np.nanmin(lons) >= 0 and target_lng < 0:
                    target_lng %= 360
                point = ds[variable].sel({lat_name: lat, lon_name: target_lng}, method="nearest")
                times = ds[time_name]
                years = np.asarray(times.dt.year.values, dtype=int)
                months = np.asarray(times.dt.month.values, dtype=int)
                indices = np.flatnonzero(years == year)
                if not len(indices):
                    continue
                units = str(ds[variable].attrs.get("units", ""))
                for index in indices:
                    month = int(months[index])
                    value = float(np.asarray(point.isel({time_name: int(index)}).values).squeeze())
                    if math.isfinite(value):
                        converted = _convert(feature, value, units, year, month)
                        selected.append((month, converted, f"CMIP6 {path.name}"))
        except ImportError:
            # If the configured NetCDF backend cannot load (for example, when
            # Windows Application Control blocks netCDF4's native DLL), all
            # CMIP6 reads will fail. Let monthly_climate report its training
            # climatology fallback instead of failing the whole request.
            return (None,) * 12, None
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            continue
    # Prefer SSP2-4.5 precipitation where it overlaps historical model data.
    by_month: dict[int, tuple[float, str]] = {}
    for month, value, source in selected:
        old = by_month.get(month)
        if old is None or ("ssp245" in source.lower() and "ssp245" not in old[1].lower()):
            by_month[month] = (value, source)
    if not by_month:
        return (None,) * 12, None
    values = tuple(by_month.get(month, (None, ""))[0] for month in range(1, 13))
    sources = {by_month[m][1] for m in by_month}
    return values, next(iter(sources)) if len(sources) == 1 else "CMIP6 (combined available files)"


def monthly_climate(year: int, lat: float = LOCATION["lat"], lng: float = LOCATION["lng"]) -> dict[str, Any]:
    observed = training_rows().get(year)
    climate: list[dict[str, Any]] = []
    climatology = training_climatology()
    for month in range(1, 13):
        values: dict[str, float] = {}
        sources: dict[str, str] = {}
        for feature in FEATURES:
            if observed and feature in observed:
                annual = observed[feature]
                values[feature] = annual / 12.0 if feature == "rainfall" else annual
                sources[feature] = "Observed training data"
                continue
            series, source = _cmip6_year(feature, year, round(lat, 3), round(lng, 3))
            value = series[month - 1]
            if value is not None:
                values[feature] = float(value)
                sources[feature] = source or "CMIP6"
            else:
                fallback = climatology[feature]
                values[feature] = fallback / 12.0 if feature == "rainfall" else fallback
                sources[feature] = "Training climatology fallback"
        climate.append({"month": month, "values": values, "sources": sources})
    annual = {
        feature: (sum(item["values"][feature] for item in climate) if feature == "rainfall" else float(np.mean([item["values"][feature] for item in climate])))
        for feature in FEATURES
    }
    annual_sources = {feature: ", ".join(sorted({item["sources"][feature] for item in climate})) for feature in FEATURES}
    return {"year": year, "location": {"lat": lat, "lng": lng, "name": "Palawan, Philippines"}, "annual": annual, "sources": annual_sources, "monthly": climate}


def climate_window(start_date: str, end_date: str, lat: float | None = None, lng: float | None = None) -> dict[str, Any]:
    start = pd.Timestamp(start_date).normalize()
    end = pd.Timestamp(end_date).normalize()
    if (end - start).days + 1 != 365:
        raise ValueError("The prediction window must contain exactly 365 days; choose an end date 364 days after the start date.")
    lat = LOCATION["lat"] if lat is None else float(lat)
    lng = LOCATION["lng"] if lng is None else float(lng)
    if not math.isfinite(lat) or not math.isfinite(lng) or not (7.0 <= lat <= 12.9 and 116.0 <= lng <= 121.0):
        raise ValueError("Select coordinates within the supported Palawan map extent.")
    sums = {feature: 0.0 for feature in FEATURES}
    weighted = {feature: 0.0 for feature in FEATURES}
    coverage: dict[str, dict[str, int]] = {feature: {} for feature in FEATURES}
    monthly: dict[tuple[int, int], dict[str, Any]] = {}
    day_count = (end - start).days + 1
    cache: dict[int, dict[str, Any]] = {}
    for day in pd.date_range(start, end, freq="D"):
        year, month = day.year, day.month
        if year not in cache:
            cache[year] = monthly_climate(year, lat, lng)
        item = cache[year]["monthly"][month - 1]
        days_in_month = calendar.monthrange(year, month)[1]
        bucket = monthly.setdefault((year, month), {"days": 0, "sums": {feature: 0.0 for feature in FEATURES}, "weighted": {feature: 0.0 for feature in FEATURES}, "sources": {feature: set() for feature in FEATURES}})
        bucket["days"] += 1
        for feature in FEATURES:
            value = item["values"][feature]
            source = item["sources"][feature]
            coverage[feature][source] = coverage[feature].get(source, 0) + 1
            bucket["sources"][feature].add(source)
            if feature == "rainfall":
                daily_value = value / days_in_month
                sums[feature] += daily_value
                bucket["sums"][feature] += daily_value
            else:
                weighted[feature] += value
                bucket["weighted"][feature] += value
    result = {feature: round(sums[feature] if feature == "rainfall" else weighted[feature] / day_count, 6) for feature in FEATURES}
    source_summary = {feature: ", ".join(sorted(coverage[feature])) for feature in FEATURES}
    monthly_result = []
    for (year, month), bucket in sorted(monthly.items()):
        values = {feature: (bucket["sums"][feature] if feature == "rainfall" else bucket["weighted"][feature] / bucket["days"]) for feature in FEATURES}
        monthly_result.append({"year": year, "month": month, "label": f"{year}-{month:02d}", "days": bucket["days"], "values": {feature: round(value, 6) for feature, value in values.items()}, "sources": {feature: ", ".join(sorted(bucket["sources"][feature])) for feature in FEATURES}})
    return {"start_date": start.date().isoformat(), "end_date": end.date().isoformat(), "days": day_count, "location": {"lat": lat, "lng": lng, "name": "Palawan, Philippines"}, "weather": result, "sources": source_summary, "source_days": coverage, "monthly": monthly_result}


