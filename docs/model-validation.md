# Palawan LASSO retraining and validation

## Training data and model

The active model was trained from `datasets/processed/climate_training/palawan_retraining_dataset.csv`. It contains 100 annual location records from 23 Palawan municipalities/city and 12 distinct years (2014-2025), with rainfall, temperature, humidity, solar radiation, and wind as inputs. The target is infestation rate in percent. The source table combines the available existing annual records and infestation observations with annual NASA POWER weather estimates at municipality centres; those are not farm-level weather measurements.

The training run is recorded as experiment `35a8782a52494c5ea97dc3f086018427`. It uses a StandardScaler + LASSO pipeline with fixed alpha 0.05 and a 0-100 output scale. The archived previous artifact is `ml-service/models/lasso_weevil_model.pre-retrain.joblib`; the active artifact is `ml-service/models/lasso_weevil_model.joblib`.

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

## Prediction comparison

For one fixed 2026 weather input, the archived model produced 1.81% and the retrained model produced 36.91%. The old model was limited to a 0-5 scale while the new model uses a 0-100 scale, and their training targets differ. This is a software/output comparison, not an accuracy comparison.

## Scope and limitations

- The model combines one Palawan-wide training set; it is not a separate model for each municipality.
- Municipality-centre annual weather values approximate local conditions and may be repeated at coarse climate-grid resolution.
- The infestation observations are sparse, include repeated labels, and have mixed definitions/collection methods.
- The available CMIP6 files mix historical, scenario, and decadal forecast sources and do not provide complete consistent future coverage for all five variables. The service labels when it uses the training-climatology fallback.
- The output is a model estimate, not a calibrated probability or a farm-level diagnosis. Field observations remain necessary.

See the [client report](../reports/palawan_lasso_retraining/WeeWare_Palawan_LASSO_Retraining_Report.pdf) for a plain-language summary and figures.
