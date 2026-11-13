# WeeWare data inventory

## Preserved application data

| Destination | Source | Use |
|---|---|---|
| `datasets/training/WEEWARE FINAL DATASET 2014-2025.csv` | Google Drive `LASSO Datasets` archive | Earlier annual training source |
| `datasets/training/WEEWARE PAYNAL DEYTA SITS.xlsx` | User-supplied workbook | Current annual training source; the schema-valid worksheet is selected from the workbook |
| `ml-service/models/lasso_weevil_model.joblib` | Workbook retraining experiment dba5929cf3154ee8a4a54146a7c0e6e2 | Active LASSO estimator; 12 Palawan-wide annual records, with LOYO error above the mean baseline |
| `ml-service/models/lasso_weevil_model.pre-retrain.joblib` | Google Drive backend archive | Archived prior LASSO estimator for comparison |
| `datasets/legacy/forum-media.bin` | Google Drive `LASSO Datasets` archive | Preserved legacy media binary; not interpreted by the new API |

## CMIP6 monthly inputs

| File | Variable | Imported experiment / temporal coverage |
|---|---|---|
| `pr_Amon_GISS-E2-1-G_historical_r12i1p3f1_gn_185001-201412.nc` | `pr` | GISS historical, 1850-2014 |
| `rsds_Amon_GISS-E3-G_historical_r1i1p101f1_gr_200001-201412.nc` | `rsds` | GISS historical, 2000-2014 |
| `pr_Amon_CanESM5-1_ssp245_r1i1p1f1_gn_201501010130-202012312230.nc` | `pr` | CanESM5-1 SSP2-4.5, 2015-2020 |
| `pr_Amon_CanESM5-1_ssp245_r1i1p1f1_gn_202101010130-203012312230.nc` | `pr` | CanESM5-1 SSP2-4.5, 2021-2030 |
| `tas_Amon_CanESM5_dcppB-forecast_s2022-r18i1p2f1_gn_202301-203212.nc` | `tas` | CanESM5 decadal forecast, 2023-2032 |
| `hurs_Amon_CanESM5_dcppB-forecast_s2022-r19i1p2f1_gn_202301-203212.nc` | `hurs` | CanESM5 decadal forecast, 2023-2032 |
| `sfcWind_Amon_CanESM5_dcppB-forecast_s2024-r7i1p2f1_gn_202501-203412.nc` | `sfcWind` | CanESM5 decadal forecast, 2025-2034 |

The seven extracted NetCDF files are preserved in `datasets/climate/netcdf`; their original ZIP is not kept. The API uses nearest-grid extraction at 9.7494 degrees N, 118.7384 degrees E and converts native CMIP6 units for the model features. Precipitation flux is integrated across the calendar month; temperature is converted from Kelvin when marked as such; surface shortwave flux in W/m2 is converted to MJ/m2/day. Missing variables or dates use a labeled climatology fallback.

## Integrity manifest

| File | SHA-256 |
|---|---|
| `datasets/training/WEEWARE FINAL DATASET 2014-2025.csv` | `4899C1EDC250743A49E7E594B3CB214F5742CBFF627415CDF29061CEAE2FDD0A` |
| `datasets/training/WEEWARE PAYNAL DEYTA SITS.xlsx` | `A1728A94355003503E8343F1E8A6049E4D30C632E1397612529760CE0A191333` |
| `datasets/legacy/forum-media.bin` | `F9BDAECD3B635787E570B908AB7CA8EADF95E23700068A048A01A282D4D3717A` |
| `ml-service/models/lasso_weevil_model.joblib` | `9A998B8DC8053850FC2078FD9AA70D70641B758E468BB0D473435176212373C0` |
| `hurs_Amon_CanESM5_dcppB-forecast_s2022-r19i1p2f1_gn_202301-203212.nc` | `ED679270CDCCBB208081BB1407560F082424A1B35D674729AA69950E10615440` |
| `pr_Amon_CanESM5-1_ssp245_r1i1p1f1_gn_201501010130-202012312230.nc` | `E9FA7E279C5CDB40CAE4C49AC7BC1CE28CA846021473DF09AF2E78C6B97FFC2E` |
| `pr_Amon_CanESM5-1_ssp245_r1i1p1f1_gn_202101010130-203012312230.nc` | `3ECFDCFC9BEB78B8B4BDA2FF25214EB7D9A01782EC5D8A58890624AF7620C9F6` |
| `pr_Amon_GISS-E2-1-G_historical_r12i1p3f1_gn_185001-201412.nc` | `9CF75104D4F76975C546B9089CF96BAD318B8FE5FF2384539A3F6C61E8F34D1E` |
| `rsds_Amon_GISS-E3-G_historical_r1i1p101f1_gr_200001-201412.nc` | `BE154BE3C25831E13725BEC0EC6E49D386778C3422AF8279E31D72053B8B5DB1` |
| `sfcWind_Amon_CanESM5_dcppB-forecast_s2024-r7i1p2f1_gn_202501-203412.nc` | `3D9C64651D8B6DC4276BD93DC79EFDC6802A109033F2DB7606457446879BE64F` |
| `tas_Amon_CanESM5_dcppB-forecast_s2022-r18i1p2f1_gn_202301-203212.nc` | `2EAD924E60963E7CEA6EFE5005CE173EFE2000FF2126543150F2AFDA945D6C8B` |

To regenerate hashes, run `Get-ChildItem datasets -Recurse -File | Get-FileHash -Algorithm SHA256` and `Get-FileHash ml-service/models/lasso_weevil_model.joblib -Algorithm SHA256` in PowerShell.


