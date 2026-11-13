# Palawan LASSO retraining and validation

## Current active retrain (13 November 2026)

The active artifact was retrained from `datasets/training/WEEWARE FINAL DATASET 2014-2025.csv` and is recorded as experiment `264192d1bf394c0eb85644180c250bdd`. The source has 12 annual Palawan-wide observations (one per year from 2014 to 2025), not location-level observations. It uses fixed alpha 0.05 and a 0-5 output range.

| Validation | MAE (percentage points) | RMSE (percentage points) |
|---|---:|---:|
| Active LASSO, leave-one-year-out | 0.883 | 1.063 |
| Training-mean baseline, leave-one-year-out | 0.666 | 0.847 |

The active run scores worse than the mean baseline on both measures, and it has no held-out-location validation. The system activated it because the training route deploys completed runs automatically; these results do not support treating it as a reliable forecasting model. The earlier 100-row, location-year experiment and its validation evidence are documented below as historical results. Collect more independent location-year observations and compare against the baseline before relying on forecasts.

## Training data and model

The previous model was trained from `datasets/processed/climate_training/palawan_retraining_dataset.csv`. It contains 100 annual location records from 23 Palawan municipalities/city and 12 distinct years (2014-2025), with rainfall, temperature, humidity, solar radiation, and wind as inputs. The target is infestation rate in percent. The source table combines the available existing annual records and infestation observations with annual NASA POWER weather estimates at municipality centres; those are not farm-level weather measurements.

This historical run is experiment `35a8782a52494c5ea97dc3f086018427`. It used a StandardScaler + LASSO pipeline with fixed alpha 0.05 and a 0-100 output scale. It has been superseded by the current active run above; its prior artifact is preserved as `ml-service/models/lasso_weevil_model.pre-retrain.joblib`.

The infestation target is not fully uniform: the prepared data inventory reports 12 rows from earlier annual labels, 36 rows calculated as damaged amount divided by estimated harvest, and 52 rows using an unweighted average of sampled monthly rates. In addition, 65 annual records reuse a location's infestation label across years. Weather uses NASA POWER values at municipality-center coordinates, not farm or necessarily station measurements. These factors limit the independence and comparability of the target labels.

Training-set MAE was 14.09 percentage points and RMSE was 16.16. These are in-sample figures and are not forecast accuracy.

## Validation

The experiment uses leave-one-year-out (LOYO) validation: each year is held out as a group while the model is fit on all other years. It compares the model with a baseline that predicts the training-set mean.

| Method | MAE (percentage points) | RMSE (percentage points) |
|---|---:|---:|
| Palawan LASSO, LOYO | 15.00 | 17.11 |
| Training-mean baseline, LOYO | 17.73 | 18.56 |
| Held-out location LASSO | 17.76 | 20.41 |
| Held-out location mean baseline | 18.59 | 19.46 |

The yearly holdout is modestly better than its baseline on this dataset. The held-out-location RMSE is worse than its baseline. These scores are uncertain because 65 records reuse an infestation label at the same location across years, and the label sources use mixed aggregation methods. They should not be read as a guarantee that weather alone predicts future infestation accurately.

There is no universal 30-year minimum for this LASSO implementation. Thirty years is commonly used to define climatological normals; a stronger infestation model needs more independent infestation observations paired with weather at the same locations and years. More duplicated annual labels alone would not add equivalent evidence.

The validation pattern points to limited independent data, mixed/reused infestation labels, coarse municipality-level weather, and omitted orchard/pest conditions as important constraints. It cannot establish one single cause for forecast error. In particular, location-held-out RMSE exceeds the simple baseline, so transfer to a location absent from the training rows remains uncertain.

## Prediction comparison

For one fixed 2026 weather input, the earlier archived model produced 1.81% and the 100-row retrained model produced 36.91%. Their training targets and output scales differed. This historical software/output comparison is not an accuracy comparison.

## Scope and limitations

- The model combines one Palawan-wide training set; it is not a separate model for each municipality.
- Municipality-centre annual weather values approximate local conditions and may be repeated at coarse climate-grid resolution.
- The infestation observations are sparse, include repeated labels, and have mixed definitions/collection methods.
- The available CMIP6 files mix historical, scenario, and decadal forecast sources and do not provide complete consistent future coverage for all five variables. The service labels when it uses the training-climatology fallback.
- The output is a model estimate, not a calibrated probability or a farm-level diagnosis. Field observations remain necessary.

See the [client report](../reports/palawan_lasso_retraining/WeeWare_Palawan_LASSO_Retraining_Report.pdf) for a plain-language summary and figures.

The historical leave-one-year-out risk-class confusion matrix is available in [model validation artifacts](../reports/model_validation/README.md). It used the earlier model's 33% and 66% cutoffs. No High-risk examples occur in the held-out sample, so High-class performance cannot be estimated; interpret accuracy with class support and the continuous MAE/RMSE.
