# Public data leads for WeeWare

Checked 2026-10-16. No outside data has been appended to the training CSV or used to retrain the model in this research pass.

## Target (infestation) data

| Source | Geographic / time scope | What it provides | Use for training |
|---|---|---|---|
| [IPPC Philippines pest report, PHL-01/4](https://ippc.int/en/countries/philippines/pestreports/2016/09/declaring-mango-pulp-weevil-sternochetus-frigidus-fabr-a-dangerous-pest-and-injurious-to-mangoes-and-placing-the-palawan-island-group-under-quarantine-to-prevent-its-spread/) | Palawan; report posted 2016 | Pest present at low prevalence in certain Palawan areas. Its linked report files include “Low Monitoring Survey Data,” specifically a 2013–2015 spreadsheet. | Potentially useful raw survey records. Need obtain and inspect the file for Puerto Princesa/site/year, sample denominator, detections, and comparable infestation-rate definitions. The report-level status is not a numeric annual target. |
| [FAO/IPPC regional surveillance report](https://www.fao.org/4/i2731e/i2731e00.pdf) | Cites Puerto Princesa City delimiting/monitoring work for CY 2002–2008 | Bibliography identifies Montevirgen, Cayanan & Marasigan, *Delimiting and Monitoring of Mango Pulp Weevil in Puerto Princesa City, Palawan: CY 2002–2008* (BPI Plant Quarantine Service report). | Strong lead for local historical targets, but the source is cited as a report rather than published row-level data. Request the report and underlying annual survey tables from BPI. |
| [ACIAR HORT-2003-071 final report](https://www.aciar.gov.au/sites/default/files/2022-08/HORT-2003-071-final-report.pdf) | Palawan, project reports from the 2000s | Records that Puerto Princesa City Agriculturists’ Office operated an MPW Detection Center in Irawan and that mango X-ray/number-of-weevils-per-fruit data were accessed. | Ask the City Agriculturist’s Office for data availability, dates, collection locations, mango counts, positive fruit/weevil counts, and methods. The published report itself does not provide a ready-to-train annual time series. |
| [UPLB study on Palawan mango industry, 1990–2009](https://www.ukdr.uplb.edu.ph/journal-articles/6406/) | Province-wide Palawan, 1990–2009 | Mango production, yield and area trends; it explicitly cautions that yield losses are not directly linked to MPW damage. | Useful context/covariates only. Yield or production is not interchangeable with measured infestation percentage and must not be used as the infestation target. |
| [De Jesus & Gabo, life history and host range](https://www.ukdr.uplb.edu.ph/journal-articles/5940/) | Biological study in Puerto Princesa/Palawan, published 2000 | Life-cycle and host/variety findings, not an annual infestation series. | Context only, not a training table. |

The 2013–2015 IPPC spreadsheet is linked from the official report page as `Copy_of_LMS_Report_Breakdown_per_Region_2013-2015.xlsx`. The browser tool could not parse its Excel MIME type and a direct download attempt was blocked by network access in this environment. No file was added. Follow up through the [IPPC attachment link](https://assets.ippc.int/static/media/files/pestreport/2016/09/07/Copy_of_LMS_Report_Breakdown_per_Region_2013-2015.xlsx) or request the source workbook from the Bureau of Plant Industry.

Useful official request contacts found during the search:

- [Puerto Princesa City Agriculture Office](https://puertoprincesa.ph/office-of-the-city-agriculturist/): `cityagriculture@puertoprincesa.ph`, (048) 717-8020 / City Hall extension 311. The office lists an MPW Control Program and Mango Quality Control Center operation.
- [BPI Crop Pest Management Division](https://buplant.da.gov.ph/directory/): `cpmd@buplant.da.gov.ph` (division contact in the official directory).
- [BPI central contact](https://buplant.da.gov.ph/contact-us/): `bpi.do@buplant.da.gov.ph`, `info@buplant.da.gov.ph`.

## Weather covariates

| Source | Coverage / spatial detail | Recommended role |
|---|---|---|
| [NASA POWER temporal API](https://power.larc.nasa.gov/docs/services/api/temporal/) | Global point weather/solar analysis-ready data; daily and other temporal products, depending on parameter/community | Historical weather covariates at the same Puerto Princesa coordinates for years with pest labels. Its API supports time series at a single latitude/longitude; verify parameters, units, and grid representativeness before joining. |
| [Copernicus ERA5](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=documentation) | Hourly global reanalysis from 1940 onward | Alternative historical weather source. It can lengthen covariate history only if matching pest labels exist; it does not create pest outcomes. |
| Existing WeeWare CMIP6 files | Mixed historical, decadal forecast and SSP files; precipitation through 2030, solar only historical through 2014 | Keep for forward climate scenario inputs. They are not historical pest labels, and the mixed experiments should retain their source metadata. |

## What to request before retraining

Ask BPI Plant Quarantine Service / Crop Protection Division and the Puerto Princesa City Agriculturist’s Office / Irawan Detection Center for row-level MPW monitoring records, including:

- year and sampling date or mango phenology/season;
- barangay/farm/site coordinates or at least site name;
- mango variety and sampling method;
- number of fruits/trees inspected and number positive (denominator and numerator);
- whether the measured outcome is percent infested fruit, weevils per fruit, trap count, or presence/absence;
- management/treatment and missing-survey indicators;
- survey protocol changes and data-use permission/citation requirements.

Do not pool Palawan-wide, southern-Palawan, Puerto-Princesa, or single-farm observations as if they were the same spatial unit. Do not turn unsampled years into zero infestation. Preserve survey denominators so a future model can account for uncertainty in annual rates.

## Can non-Puerto-Princesa data be used?

Potentially, but not by simply adding rows. Data from other locations can support a regional or hierarchical model if they are true MPW measurements with comparable protocols and include location, crop/variety, season, management, and exposure information. The literature/search results include surveys in other Palawan areas and absence surveys elsewhere in the Philippines; absence-survey rows are not equivalent positive-area infestation rates, and protocol/selection differences matter. Foreign mango pests or mango seed-weevil data are not suitable substitutes for *Sternochetus frigidus* in Puerto Princesa. Keep external records separate until harmonized and validate on held-out years and, where possible, held-out locations.
