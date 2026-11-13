# WeeWare

WeeWare is a climate informed research application for mango pulp weevil monitoring across Palawan. The active stack is React, Express, MongoDB, and Python/FastAPI. The Python service reads the available CMIP6 NetCDF files and applies the retrained Palawan LASSO model.

## Project layout

```text
frontend/                 React/Vite client and pages
backend/                  Express API, Mongoose models, uploads, Socket.IO
ml-service/               FastAPI climate and LASSO service
datasets/climate/netcdf/  Imported raw CMIP6 NetCDF inputs
datasets/training/        Original annual LASSO training CSV
datasets/processed/       Prepared weather and infestation data
docs/                     System analysis, setup, and model validation
reports/                  Plain-language retraining report and figures
scripts/                  Setup, startup, data preparation, and report tools
```

## Start locally

1. Install Node.js 20 or newer, Python 3.10 or newer, and MongoDB 7 or newer.
2. Run `./scripts/setup.ps1` in PowerShell. It creates `backend/.env`, installs Node workspace dependencies, and prepares `ml-service/.venv`.
3. Set a private `JWT_SECRET` in `backend/.env` and start MongoDB.
4. Run `./scripts/start.ps1`, or run `npm run dev` from the repository root.
5. Open <http://localhost:5180>. Vite proxies API, upload, and Socket.IO requests to Express; Express connects to the internal Python ML service.

To enable Weka analysis in the researcher workspace, run `npm run setup:weka` in PowerShell once and restart the ML service. This installs the pinned Weka 3.8.7 Java runtime in a gitignored local cache. The researcher dashboard uses Weka for separate Random Forest, M5P, or Linear Regression cross-validation; it does not replace or deploy the live LASSO model.

The API serves the built frontend after `npm run build`. During development Vite proxies requests to Express.

## Main flows

- Signup/login use an HTTP-only JWT cookie. The signup email verification code is entered as six separate one-digit boxes.
- Protected app pages include location, climate calendar, climate charts, prediction, history, saved reports, forum, suggested actions, and profile settings.
- A prediction request sends a 365-day date window and pinned Palawan coordinates to Python. Python extracts the five weather features from available CMIP6 monthly files or a labeled training-climatology fallback, then applies the active LASSO artifact.
- The model output is on a 0-100 percentage scale. Risk bands are Low below 33%, Medium from 33% to below 66%, and High at 66% or above. Coordinates cover the broad Palawan study area and do not represent farm-level weather measurements.
- Express stores prediction history, saved reports, users, posts, comments, and notifications in MongoDB. Socket.IO publishes forum and notification updates.

## Model and data

The active model is `ml-service/models/lasso_weevil_model.joblib`. The prepared annual dataset, training experiment, and model validation evidence are under `datasets/processed/climate_training/` and `ml-service/model_experiments/`. See [model validation](docs/model-validation.md), [data inventory](docs/data-inventory.md), and the [plain-language report](reports/palawan_lasso_retraining/WeeWare_Palawan_LASSO_Retraining_Report.pdf).

Validation is exploratory. Some infestation labels repeat across location-years, target collection methods differ, and municipality-centre weather is not farm-level measurement. The estimate is not a calibrated probability of infestation.

Keep secrets in `backend/.env`; do not commit that file.
