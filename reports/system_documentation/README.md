# WeeWare System: End-to-End Guide

**Prepared:** 11 November 2026
**Repository:** WeeWare 2.0
**Purpose:** explain the application pages, prediction workflow, API, services, and user/admin controls in one place.

## Files

- [End-to-end system guide (PDF)](WeeWare_System_End_to_End_Guide.pdf)
- [Mobile screenshot gallery](screenshots/)
- [Client-supplied screenshots (personal fields redacted)](screenshots/client-supplied/)
- [3D model and data visualizations](visualizations/)
- [PDF generator](generate_system_guide.js)
- [3D visualization generator](generate_visualizations.py)
- [Visualization Python dependencies](requirements-visualizations.txt)

The screenshots were captured from the running application in the local Android virtual device (`MathevoPhone`, 1080 x 1920 display). The local instance used a separate MongoDB database and synthetic demonstration accounts/content. The screenshots are not from client accounts or the live VPS. Some pages show sample data created for this guide.

The additional client screenshots came from the sibling `reports/system images` folder. Copies included here have personal name, email, phone, and address fields redacted where visible.

## System at a glance

WeeWare is a responsive React application for climate-informed mango pulp weevil monitoring across Palawan. A signed-in user selects a map point and a 365-day window. The Express API checks the request and calls a Python FastAPI service. That service assembles five annual weather features from monthly CMIP6 NetCDF files where available, uses a labeled training-climatology fallback for gaps, and applies the active StandardScaler + LASSO model. Express saves the result in MongoDB and returns it to the browser.

```text
Mobile/desktop browser
        | HTTPS / REST / Socket.IO
        v
React client <---- Express API ----> MongoDB
                       |
                       +---- FastAPI climate/model service
                                      |             |
                                      v             v
                                CMIP6 NetCDF    LASSO artifact
```

In local development, Vite serves the client at port 5180 and proxies `/api`, `/uploads`, and `/socket.io` to Express at 5021. FastAPI normally listens on 8021 and MongoDB on 27017. These are local development defaults, not public service addresses.

## End-to-end prediction flow

1. **Sign in.** The browser sends credentials to `POST /api/auth/login`. Express validates the account and issues an HTTP-only `weeware_token` cookie. API middleware verifies the signed JWT and puts its account ID and role on the request.
2. **Choose a point.** The prediction page starts with a Palawan map. A user clicks or moves the pin. The browser sends latitude and longitude with later climate and prediction requests. The backend and climate service accept coordinates in the configured study extent: 7.0–12.9 degrees N and 116.0–121.0 degrees E.
3. **Choose dates.** The service requires both dates, exactly 365 days inclusive (end date is 364 days after start), and a start date on or after January 1 of the current year.
4. **Extract and review weather.** The browser requests `GET /api/climate/window`. The API proxies the coordinates and dates to FastAPI. The climate service assembles rainfall, temperature, relative humidity, solar radiation, and wind speed, with monthly values and source labels, then returns the 365-day aggregates.
5. **Calculate the estimate.** The browser posts the dates and selected location to `POST /api/predictions`. Express repeats the date/extent validation and calls `POST /predict` on the ML service. The ML service builds the ordered five-feature vector, loads the active model, predicts the infestation-rate estimate, clamps it to the configured 0–100 scale, and assigns the Low/Medium/High band.
6. **Save and use the result.** Express stores dates, coordinates, annual weather values, weather-source labels, rate, risk category, suggested action, and model details in MongoDB. The browser shows the result and can save it, download a PDF, open history, or start another forecast.

**Risk bands:** Low below 33%; Medium from 33% to below 66%; High at 66% or above. This is a model estimate, not a calibrated probability or farm-level diagnosis.

## Weather extraction and model

The climate reader is `ml-service/climate.py`; the HTTP endpoints and input validation are in `ml-service/app.py`; model loading and prediction are in `ml-service/model.py`.

| Model feature | CMIP6 variable | Display / model unit | Conversion performed when source units require it |
|---|---|---|---|
| Rainfall | `pr` | mm per year | Precipitation flux is multiplied by the number of days in the month and seconds per day; mm/day values are multiplied by days in the month. |
| Air temperature | `tas` | degrees Celsius | Kelvin is converted by subtracting 273.15. |
| Relative humidity | `hurs` | percent | Used as provided when present. |
| Solar radiation | `rsds` | MJ/m²/day | W/m² is multiplied by 0.0864. |
| Wind speed | `sfcWind` | m/s | Used as provided when present. |

For each requested calendar month, the reader searches the configured monthly NetCDF files, chooses the nearest available grid point to the selected latitude/longitude, selects the requested year/month, converts units, and records the source filename. The request can use a combination of available CMIP6 files. If a feature/month cannot be read, that period uses the labeled training-climatology fallback. Where the original annual training weather row is available, the climate reader also marks it as observed training data. The API returns source labels and daily coverage counts so a result is not presented as though every input came from CMIP6.

Within a 365-day window, rainfall is accumulated and the other four variables are averaged with the number of represented days as weights. The displayed monthly charts are summaries of this same selected window.

The active retraining evidence in the repository records 100 annual location rows, 23 Palawan locations and years 2014–2025. The model is a `StandardScaler` + LASSO pipeline with alpha 0.05 and a 0–100 target scale. Its leave-one-year-out MAE is 15.00 percentage points; this is an exploratory validation score on held-out years, not a guarantee of accuracy. The historical CMIP6 archive is incomplete and mixes historical, scenario, and decadal forecast files. Some future inputs therefore use fallbacks. Municipality-centre weather estimates are not farm measurements.

The new model was trained with annual NASA POWER municipality-center weather estimates paired with the supplied infestation records. CMIP6 was not part of that training table; the live prediction service uses available CMIP6 weather and labeled fallback values for prediction inputs.

## Application page directory

The routes below are the active routes in `frontend/src/App.jsx`. Pages inside `/app` require a signed-in account unless the route adds a narrower role gate.

| Route | Page | What it is for |
|---|---|---|
| `/` | Home / about | Explains WeeWare, the Palawan scope, intended audiences, and how to enter the application. |
| `/login` | Sign in | Authenticates an existing account. |
| `/signup` | Create account | Collects account/profile details, consent, and email-verification code. Verification uses six one-digit boxes. |
| `/forgot-password` | Password recovery | Requests a reset link without revealing whether an address is registered. |
| `/reset-password` | Password reset | Sets a new password through a valid, time-limited reset link. |
| `/app/prediction` | Prediction | Four steps: location, 365-day dates, weather review, and estimate/actions. |
| `/app/history` | Prediction history | Lists a member's forecasts, with report download/save/delete controls. |
| `/app/saved` | Saved reports | Reopens or deletes previously saved forecasts. |
| `/app/forum` | Community forum | Search, publish a text/media post, like/comment/reply, view profiles, and request removal. |
| `/app/profile/:id` | Member profile | Shows profile details that the account has chosen to make public; offers messaging where allowed. |
| `/app/messages` | Messages | Direct conversations, role-pinned contacts, designated Admin/DA/Researcher group chat, and admin broadcasts. Group files retain their original filename. |
| `/app/ai` | AI assistant | Stores an account's question/answer conversations and lets the user continue them. Availability depends on the configured local AI provider. |
| `/app/settings` | Profile settings | Edits the member's profile, public-field visibility, language, password, and account controls. |
| `/app/system-iteration` | Research workspace | Researcher-only model/data dashboard: view model/experiment data, preview eligible CSV/XLSX input, run separate Weka regression comparisons, retrain, and activate LASSO experiments. |
| `/app/da` | DA dashboard | DA or admin view of forecast counts, represented locations, risk summaries, and recent forecasts. |
| `/app/admin` | Admin dashboard | Admin-only account, moderation, conversation, database schema, system configuration, service health, topology, and traffic controls. |

Legacy map/calendar/climate URLs redirect into the current prediction flow; they are not separate page routes in the current React router.

## HTTP API reference

The Express API is mounted under `/api`. Express exposes `/api/health`; a generated Swagger page for Express is not configured. The Python service provides its OpenAPI browser at `/docs` and JSON schema at `/openapi.json`.

| Express route group | Main operations |
|---|---|
| `/api/auth` | `POST /signup`, `/signup/verify`, `/password/forgot`, `/password/reset`, `/login`, `/logout`; `GET /me`. |
| `/api/users` | Current profile, member search, public member profile, profile/password update, and account deletion. |
| `/api/climate` | `GET /years`, `/year/:year`, and `/window?start_date=…&end_date=…&lat=…&lng=…`. |
| `/api/predictions` | `GET /` history; `POST /` generate; `POST /:id/save`; `GET /:id` and `GET /:id/report`; `DELETE /:id`. |
| `/api/saved-predictions` | `GET /` saved reports; `DELETE /:id`. |
| `/api/posts`, `/api/comments` | Search/list/create posts; list/create comments; like a post/comment; create replies; update/delete own content. |
| `/api/messages` | Thread/pinned-account list, direct messages, group messages, group files/chunk uploads, and admin-only broadcast/recipient list. |
| `/api/uploads` | Upload post media; query permitted media types and configured file limit. |
| `/api/notifications` | `GET /` notifications and unread count; `PATCH /read` for one/all read state. |
| `/api/ai/conversations` | List/create conversations and append a user message/AI response. |
| `/api/ml` | Researcher/admin proxy for model information, training status/experiments, Weka runtime status/analysis, template, dataset preview/training, Palawan retraining, experiment activation/download/deletion. |
| `/api/moderation` | Submit content removal requests; admin queue/review/publication/removal operations. |
| `/api/system` | Admin overview/users/roles/conversations/schema/config/traffic/health; DA/admin forecast overview. |

The ML service endpoints include `GET /health`, `/model/info`, `/train/status`, `/train/experiments`, `/train/template`, `/weka/status`, `/climate/years`, `/climate/year/{year}`, `/climate/window`; `POST /train/preview`, `/train`, `/train/palawan`, `/weka/analyze`, `/train/experiments/{id}/activate`, `/predict`; `GET /train/experiments/{id}/dataset`; and `DELETE /train/experiments/{id}`. The Weka analyzer returns cross-validated regression metrics and held-out predictions, plus a risk-band confusion matrix derived using the researcher-selected thresholds. Results are for comparison and cannot activate a production model. The service is intended to be internal behind Express in normal deployment. Do not expose its training operations directly to untrusted clients.

## Services and persisted data

| Component | Responsibility | Main technology / state |
|---|---|---|
| Web client | Responsive pages, input, charts/maps, results, report actions | React 18, React Router, Vite, Leaflet, i18next, Axios, Socket.IO client. |
| API | Authentication, role checks, request validation, business logic, reports, realtime events, service proxy | Express 4, Node.js, Mongoose, Socket.IO. In production it can also serve `frontend/dist`. |
| Database | User/account records and application history | MongoDB. Mongoose models include User, Prediction, SavedPrediction, Post, Comment, Notification, messaging, and AIConversation. |
| Climate/model service | Climate extraction, source labeling, LASSO prediction, experiment/training interface | Python 3, FastAPI, xarray, pandas, NumPy, scikit-learn, joblib. |
| Climate inputs | Monthly climate arrays used for coordinate/year/month lookup | Seven imported CMIP6 monthly NetCDF files under `datasets/climate/netcdf/`. |
| File storage | Post media and group-chat attachment bytes | Local configured upload directories; group uploads use 8 MiB chunks, up to 1 GiB total. |
| Mail delivery | Signup verification and password-reset email | Nodemailer with SMTP configuration; auth email actions fail if delivery is not configured. |
| Optional AI provider | Responds to account conversation prompts | Ollama-compatible HTTP endpoint/model configured through environment variables. |

MongoDB holds application records; the model artifact and NetCDF files are filesystem assets. Socket.IO notifies the client about real-time forum/notification/message activity. Admin health checks report frontend/API/database/model availability and basic performance/traffic counters.

## Controls and permissions

- **Authentication:** signed JWT in an HTTP-only cookie; `requireAuth` protects personal history, saved reports, messaging, and other member operations. Some read-only public content/profile endpoints intentionally permit anonymous requests.
- **Role-based access:** farmer/member features are available to signed-in users. The research dashboard and training API require `researcher` or `admin`; the DA dashboard requires `da` or `admin`; system administration, moderation, and broad broadcasts require `admin`. The shared group conversation is limited to the configured admin, DA, and researcher accounts.
- **Signup verification:** six-digit code, delivered by email; challenge expires after 10 minutes, allows at most five failed attempts, and has a 30-second resend cooldown. Verification inputs are six separate one-digit boxes that support paste/autofill.
- **Forecast validation:** the API and ML service independently check 365-day windows; the API checks the configured Palawan coordinate rectangle. Invalid dates or out-of-extent coordinates are rejected before saving.
- **Training controls:** researcher dashboard validates an uploaded CSV/XLSX before training, accepts files up to 12 MiB, offers prepared Palawan retraining, and stores experiment metadata. Admin access is also permitted by the API for model administration.
- **Upload controls:** post media accepts image/video files and has an eight-file request limit; group chat uses chunked uploads with file names retained and a 1 GiB size ceiling.
- **Account controls:** profile, language, password, visibility preferences, sign out, and account deletion. Deletion is a destructive action and requires a browser confirmation.
- **Operational controls:** admin tabs include account roles/status, content moderation, service health, topology, traffic, conversation inspection, database schema, and environment configuration visibility. Secrets should remain in `.env`/the deployment secret store and must never be committed.

## Data, interpretation, and known limits

- The active LASSO prediction is an estimate based on five climate values. It is not a calibrated probability, a causal claim, or a farm-specific diagnosis.
- CMIP6 files use coarse nearest-grid extraction. The available files mix models/experiments and have incomplete temporal overlap; the service labels its fallbacks.
- Annual weather used for the Palawan training rows is estimated at municipality centers rather than measured at each farm.
- The new training table has 100 annual rows from 23 locations across 12 years (2014–2025). Sixty-five rows reuse infestation labels at the same location across years; these are not 65 independent new field observations.
- The target values combine three aggregation approaches: 12 earlier annual entries, 36 damage-volume/estimated-harvest ratios, and 52 unweighted means of sampled monthly rates. This target inconsistency is a major documented limitation.
- Annual training weather comes from NASA POWER monthly point values assembled for municipality-center coordinates. It is not farm-level or necessarily station-observed weather. Prediction weather is assembled separately from available CMIP6 NetCDF data, with labeled training-climatology fallbacks for gaps.
- Leave-one-year-out MAE/RMSE are 15.00/17.11 percentage points. Leave-one-location-out scores are 17.76/20.41; the location-held-out RMSE is higher than the simple mean baseline (19.46). This warns that transfer to unseen locations is uncertain.
- The strongest evidence points to few independent infestation observations, mixed/reused labels, coarse location weather, and omitted orchard/pest factors. The available validation cannot prove one sole cause of error.
- Thirty years is a common climatological-normal period, not a hard requirement in the current LASSO training code. More independent infestation observations paired with weather by location and year would improve the evidence base; repeated labels do not substitute for new observations.
- Saved predictions retain the input weather/source labels and model metadata so the generated result can be reviewed later.
- The API service currently has no Express Swagger UI. Use source route definitions and `/api/health`; FastAPI's `/docs` lists the climate/model contract.

## Local developer startup

1. Install Node.js 20+, Python 3.10+, and MongoDB 7+.
2. Run `scripts/setup.ps1`, configure `backend/.env` with a strong local `JWT_SECRET` and MongoDB URI, and ensure MongoDB is available.
3. Run `scripts/start.ps1` or `npm run dev` at the repository root.
4. Browse to `http://localhost:5180`. Vite proxies API, uploads, and Socket.IO requests to the API. The ML service is started by `scripts/run-ml.js`.
5. Production builds use `npm run build`; the Express API serves the generated `frontend/dist` when present.

Do not place credentials in screenshots, source control, or this guide. The demo accounts and data used for this guide were created only in the isolated local documentation database.

## Screenshot index

Every image below is a direct Android virtual-device screen capture; the browser and Android status/navigation bars are included. Pages with example records display synthetic local documentation data.

| File | Page / control shown |
|---|---|
| `01-home.png` | Public project introduction and entry actions. |
| `02-create-account.png` | Signup profile fields and terms/verification start. |
| `03-sign-in.png` | Login form. |
| `04-forgot-password.png` | Password recovery form. |
| `05-reset-password.png` | Invalid/missing reset-link state and recovery navigation. |
| `06-prediction-location.png` | Prediction wizard and Palawan location map. |
| `07-prediction-history.png` | Forecast history and per-record actions. |
| `08-saved-reports.png` | Saved report list. |
| `09-community-forum.png` | Search, compose, upload, and community feed. |
| `10-messages.png` | Messenger inbox and role-pinned contacts. |
| `11-ai-assistant.png` | AI conversation page. |
| `12-settings.png` | Profile settings form. |
| `13-user-profile.png` | Public member profile. |
| `14-api-health.png` | Express API health JSON response. |
| `15-model-api-reference.png` | FastAPI OpenAPI/Swagger screen. |
| `16-account-controls.png` | Password change, account deletion, and sign-out controls. |
| `17-admin-dashboard.png` | Admin overview and control-center tabs. |
| `18-admin-group-chat.png` | Designated Admin/DA/Researcher group conversation. |
| `19-researcher-dashboard.png` | Active model and retraining workspace. |
| `20-da-dashboard.png` | Agriculture monitoring dashboard. |
| `21-prediction-location-action.png` | Map-step navigation control. |
| `22-prediction-date-window.png` | Start/end date controls and 365-day wizard step. |
| `23-prediction-weather-review.png` | Extracted five-variable weather summary. |
| `24-prediction-result.png` | Estimate, risk class, and result context. |
| `25-result-controls.png` | Save, PDF download, history, and restart controls. |
| `26-forum-image-zoom.png` | Full-screen photo viewer with navigation and zoom controls. |

## Client-provided screenshots

All 11 images supplied in `reports/system images` are included in the PDF and copied into `screenshots/client-supplied/`. The settings and forgot-password screenshots had visible personal contact fields, so the report copies mask those values. The forgot-password image shows a request in progress; it is not evidence that delivery completed.

## 3D training, data, model, and validation figures

- `visualizations/3d_training_data.png`: annual rainfall, temperature, and infestation labels by location-year, colored by year.
- `visualizations/3d_infestation_label_sources.png`: number of training rows from each target aggregation approach.
- `visualizations/3d_lasso_response_surface.png`: active LASSO output while rainfall and temperature vary; other features are held at dataset medians.
- `visualizations/3d_held_out_predictions.png`: observed versus held-out-year estimates, colored by absolute error.
- `visualizations/3d_validation_scores.png`: MAE/RMSE comparisons for held-out years and locations against the training-mean baseline.

The PDF also includes the existing 3D training-process figure. A 3D rendering is a way to inspect the recorded data/model; it does not increase sample size, establish causation, or make the model more accurate.

To rebuild the 3D plots, install `requirements-visualizations.txt` in the Python environment that can load the active model artifact, then run `python reports/system_documentation/generate_visualizations.py` from the repository root. To rebuild the PDF afterward, run `node reports/system_documentation/generate_system_guide.js` from the repository root.

## Password-reset email: diagnosis and change

The prior API route swallowed Nodemailer exceptions and still returned HTTP 200 with a generic “check your inbox” response. That caused the frontend to report success even when the SMTP provider rejected the message. The route now checks SMTP availability and validates the reset-page URL before looking up an account and returns the same HTTP 503 for every address if the mail service or link configuration is unavailable. If a send fails after the check, it removes the unusable token (or restores the previous valid reset challenge), logs the provider error, and keeps the account response generic to avoid email enumeration. The frontend displays the service-wide API error.

This checkout has no `backend/.env`, so no local SMTP credentials are present and real delivery cannot be demonstrated here. The deployed API still needs protected runtime values for `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, and `FRONTEND_URL`. Use an authorized sender and the production website origin. The same successful response covers unknown accounts and reset requests, so it does not prove delivery. A provider may accept a message that filtering or a later bounce keeps out of the inbox.
