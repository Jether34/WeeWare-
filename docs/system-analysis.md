# WeeWare system analysis

## Purpose and data flow

WeeWare estimates mango pulp weevil infestation risk across the Palawan study area using five annual weather features. A user selects a 365-day date window and a map location. Express authenticates the request, checks that the coordinates fall within the supported Palawan map extent, and sends it to the Python service. Python builds weather values from the available CMIP6 monthly files and labeled training-climatology fallbacks, then runs the active LASSO model. Express stores the result in MongoDB and serves history and saved reports.

```text
React pages -> Express REST API -> MongoDB
                    |
                    +-> FastAPI -> CMIP6 NetCDF + training data -> LASSO artifact
```

The selected coordinates are for spatial lookup within the broad Palawan study area. They do not imply farm-level weather observations. CMIP6 grid cells are coarse, and historical climate/infestation datasets are sparse.

## Page map and user flows

| Page | User flow | Route |
|---|---|---|
| Home/About | Learn about the project and enter the application | `/` |
| Login | Authenticate with email and password | `/login` |
| Signup | Create an account, complete profile, accept terms, and enter email verification code | `/signup` |
| Location map | Select a study coordinate within Palawan | `/app/map` |
| Climate calendar | Inspect monthly values by feature and source | `/app/calendar` |
| Climate data | Compare monthly values, annual summaries, and source attribution | `/app/climate` |
| Prediction | Choose a 365-day window, calculate risk, save a report, and download PDF | `/app/prediction` |
| History | Review, download, save, or delete predictions | `/app/history` |
| Saved reports | Reopen or delete saved reports | `/app/saved` |
| Community forum | Create posts with media, search, like, comment, reply, and delete own posts | `/app/forum` |
| Suggested actions | Review monitoring guidance for risk categories | `/app/actions` |
| Settings | Update profile, picture, and language | `/app/settings` |

Signup verification presents a six-digit email code in six separate boxes, one digit per box. The form supports code paste and one-time-code autofill.

## LASSO model

- Model: scikit-learn StandardScaler + LASSO regression pipeline.
- Training set: 100 location-year rows, 23 municipality/city locations, and 12 years (2014-2025), with five weather features and infestation rate as the target.
- Features: rainfall (mm/year), temperature (degrees Celsius), relative humidity (percent), solar radiation (MJ/m2/day), and wind speed (m/s).
- Model experiment: fixed alpha 0.05, recorded under `ml-service/model_experiments/35a8782a52494c5ea97dc3f086018427/`.
- Output range: 0-100 percent, with Low below 33%, Medium from 33% to below 66%, and High at 66% or above.
- Validation: leave-one-year-out and held-out-location comparisons are in [model validation](model-validation.md). The scores are exploratory due to repeated infestation labels, mixed target definitions, limited records, and spatially estimated weather. The result is not a calibrated probability.

## CMIP6 inventory and coverage

The project retains seven imported monthly NetCDF files. Their variables, source experiments, date ranges, and hashes are listed in [data inventory](data-inventory.md).

- Precipitation (`pr`): GISS historical through 2014 and CanESM5-1 SSP2-4.5 through 2030.
- Temperature (`tas`) and humidity (`hurs`): CanESM5 decadal forecast inputs covering 2023-2032.
- Wind (`sfcWind`): CanESM5 decadal forecast input covering 2025-2034.
- Solar radiation (`rsds`): GISS historical input through 2014 only in the supplied archive.
- When a raw file does not cover a requested month, the service uses annual training-set climatology and labels the source as a fallback.

These inputs do not form a complete, internally consistent five-variable future climate series. They mix historical, SSP2-4.5, and decadal forecast sources. Their source attribution is retained rather than implying that all fields come from one model scenario.

## Persistence mapping

The imported MariaDB schema describes users, predictions, saved predictions, feedback, subscriptions, forum posts/media/likes/comments, and notifications. Active MongoDB models cover users, predictions, saved reports, posts, nested comments, and notifications. Post media is represented as upload metadata and files rather than SQL BLOB fields. Feedback and subscriptions remain outside the active user flows because the current frontend has no complete page/API flow for them.

## Legacy inconsistencies

Older notes variously call the pest a coconut weevil and describe Flask, PHP, and MariaDB. The current application identifies mango pulp weevil and uses Express/MongoDB with a separate Python FastAPI climate/model service. Archived extraction scripts reference 3-hourly files not present in the import; the active climate reader uses the seven imported monthly files.
