const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'screenshots');
const OUTPUT = path.join(ROOT, 'WeeWare_System_End_to_End_Guide.pdf');
const regularFont = 'C:\\Windows\\Fonts\\arial.ttf';
const boldFont = 'C:\\Windows\\Fonts\\arialbd.ttf';
const colors = { green: '#155b3b', deep: '#123b2a', pale: '#e9f3ec', gray: '#617469', ink: '#23382d', line: '#dce8df', orange: '#aa6a0b' };

const screenshots = [
  ['01-home.png', 'Home and about', 'Public introduction, Palawan-wide scope, and links to create an account or sign in.'],
  ['02-create-account.png', 'Create an account', 'Mobile signup fields, optional profile information, and the email verification entry flow.'],
  ['03-sign-in.png', 'Sign in', 'Email/password form and password visibility control.'],
  ['04-forgot-password.png', 'Forgot password', 'Secure password recovery request form.'],
  ['05-reset-password.png', 'Reset password', 'Reset page for a missing/invalid token; a valid emailed link displays the new-password form.'],
  ['06-prediction-location.png', 'Prediction: select a location', 'First wizard step, coordinates, and interactive Palawan map.'],
  ['07-prediction-history.png', 'Prediction history', 'Saved forecast history and per-result actions.'],
  ['08-saved-reports.png', 'Saved reports', 'Forecasts retained for quick reference and download.'],
  ['09-community-forum.png', 'Community forum', 'Search, compose a post, add media, and browse discussions.'],
  ['10-messages.png', 'Messages inbox', 'Direct conversations and role-pinned accounts.'],
  ['11-ai-assistant.png', 'AI assistant', 'Conversation list and assistant message interface.'],
  ['12-settings.png', 'Profile settings', 'Profile, photo, language, and public visibility fields.'],
  ['13-user-profile.png', 'Member profile', 'Public profile view and available member actions.'],
  ['14-api-health.png', 'Express API health', 'The health endpoint returns service status and timestamp as JSON.'],
  ['15-model-api-reference.png', 'Climate/model API reference', 'FastAPI OpenAPI page lists the climate, prediction, and researcher operations.'],
  ['16-account-controls.png', 'Account controls', 'Password change, account deletion, and sign-out actions.'],
  ['17-admin-dashboard.png', 'Admin dashboard', 'System overview, account/content controls, and monitoring tabs.'],
  ['18-admin-group-chat.png', 'Designated group chat', 'Admin/DA/Researcher shared conversation on mobile.'],
  ['19-researcher-dashboard.png', 'Researcher dashboard', 'Active Palawan LASSO version, training evidence, and retraining workspace.'],
  ['20-da-dashboard.png', 'DA dashboard', 'Forecast and location summaries for agriculture monitoring.'],
  ['21-prediction-location-action.png', 'Location step control', 'Map-step button advances the wizard after choosing the pin.'],
  ['22-prediction-date-window.png', 'Date window control', 'A start date and a forecast end date exactly 365 calendar days apart.'],
  ['23-prediction-weather-review.png', 'Weather review', 'Annual totals/averages for five variables and monthly summaries.'],
  ['24-prediction-result.png', 'Prediction result', 'Estimate, risk category, selected period, and interpretation note.'],
  ['25-result-controls.png', 'Result actions', 'Save report, download PDF, view history, start over, or return to weather.'],
  ['26-forum-image-zoom.png', 'Forum photo viewer', 'Full-screen media viewer with previous/next, zoom in/out, and close controls.'],
];

const doc = new PDFDocument({ size: 'LETTER', margin: 44, bufferPages: true, info: {
  Title: 'WeeWare System End-to-End Guide', Author: 'WeeWare project documentation', Subject: 'System design, pages, API, services, and controls',
} });
doc.pipe(fs.createWriteStream(OUTPUT));
if (fs.existsSync(regularFont) && fs.existsSync(boldFont)) {
  doc.registerFont('Body', regularFont).registerFont('Strong', boldFont);
} else {
  doc.registerFont('Body', 'Helvetica').registerFont('Strong', 'Helvetica-Bold');
}

function setFont(bold = false, size = 10, color = colors.ink) {
  doc.font(bold ? 'Strong' : 'Body').fontSize(size).fillColor(color);
}
function para(text, options = {}) {
  setFont(options.bold, options.size || 10, options.color || colors.ink);
  doc.text(text, { width: options.width || 520, lineGap: options.lineGap ?? 3, paragraphGap: options.paragraphGap ?? 7, ...options });
}
function bullet(text, x = 54, width = 500) {
  setFont(false, 9.6, colors.ink);
  const y = doc.y;
  doc.circle(x + 3, y + 6, 2.1).fill(colors.green);
  doc.text(text, x + 13, y, { width: width - 13, lineGap: 2.7, paragraphGap: 6 });
}
function section(title, kicker = 'SYSTEM GUIDE') {
  doc.addPage();
  setFont(true, 8, colors.green);
  doc.text(kicker.toUpperCase(), 44, 40, { characterSpacing: 1.2 });
  setFont(true, 22, colors.deep);
  doc.text(title, 44, 57, { width: 520 });
  doc.moveTo(44, 90).lineTo(568, 90).lineWidth(1).strokeColor(colors.line).stroke();
  doc.y = 103;
}
function subhead(title) {
  if (doc.y > 690) doc.addPage();
  setFont(true, 13, colors.green);
  doc.text(title, 44, doc.y, { width: 520, paragraphGap: 5 });
  doc.moveDown(0.35);
}
function card(title, text) {
  if (doc.y > 680) doc.addPage();
  const y = doc.y;
  setFont(true, 10.4, colors.deep);
  doc.text(title, 48, y, { width: 510 });
  setFont(false, 9.3, colors.gray);
  doc.text(text, 48, doc.y + 1, { width: 510, lineGap: 2.5, paragraphGap: 7 });
  doc.moveDown(0.25);
}
function table(headers, rows, widths, opts = {}) {
  const x0 = 44;
  const pageBottom = 720;
  const pad = 6;
  function drawHeader() {
    const y = doc.y;
    const height = 24;
    doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), height).fill(colors.green);
    let x = x0;
    headers.forEach((item, i) => {
      setFont(true, 8.3, '#ffffff');
      doc.text(item, x + pad, y + 6, { width: widths[i] - pad * 2, height: height - pad, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + height;
  }
  drawHeader();
  rows.forEach((row, rowIndex) => {
    const startY = doc.y;
    const cellHeights = row.map((value, i) => {
      setFont(i === 0 && opts.firstBold !== false, opts.size || 8.1, i === 0 ? colors.deep : colors.ink);
      return doc.heightOfString(String(value), { width: widths[i] - pad * 2, lineGap: 1.7 }) + pad * 2;
    });
    const height = Math.max(23, ...cellHeights);
    if (startY + height > pageBottom) {
      doc.addPage();
      doc.y = 48;
      drawHeader();
    }
    const y = doc.y;
    if (rowIndex % 2 === 0) doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), height).fill('#f2f7f3');
    doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), height).lineWidth(0.35).strokeColor(colors.line).stroke();
    let x = x0;
    row.forEach((value, i) => {
      setFont(i === 0 && opts.firstBold !== false, opts.size || 8.1, i === 0 ? colors.deep : colors.ink);
      doc.text(String(value), x + pad, y + pad, { width: widths[i] - pad * 2, lineGap: 1.7 });
      x += widths[i];
    });
    doc.y = y + height;
  });
  doc.moveDown(0.7);
}

// Cover
doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.deep);
setFont(true, 9, '#a7d0b5');
doc.text('WEEWARE  |  SYSTEM GUIDE', 54, 66, { characterSpacing: 1.5 });
setFont(true, 30, '#ffffff');
doc.text('End-to-end system\ndocumentation', 54, 105, { width: 495, lineGap: 4 });
setFont(false, 13, '#d8e9de');
doc.text('Pages, prediction flow, API, services, and user controls', 56, 193, { width: 480, lineGap: 4 });
doc.image(path.join(SHOTS, '01-home.png'), 175, 245, { fit: [262, 465] });
setFont(true, 10, '#ffffff');
doc.text('Mango pulp weevil monitoring across Palawan', 56, 727, { width: 500, align: 'center' });
setFont(false, 9, '#c4d9cc');
doc.text('Prepared 11 November 2026  |  Repository version 2.0', 56, 750, { width: 500, align: 'center' });

section('How the pieces fit together', '01  /  Architecture');
para('WeeWare is a responsive React application for reviewing annual climate patterns and producing a climate-informed mango pulp weevil screening estimate. A normal forecast crosses four service boundaries: the browser, Express API, MongoDB, and the Python climate/model service.', { size: 10.5 });
doc.moveDown(0.4);
const boxes = [
  { x: 52, y: 190, w: 145, h: 88, title: 'Browser', body: 'React pages\nmap · charts · forms' },
  { x: 238, y: 190, w: 145, h: 88, title: 'Express API', body: 'Auth · validation\nrecords · reports' },
  { x: 424, y: 190, w: 145, h: 88, title: 'MongoDB', body: 'Accounts · forecasts\nforum · messages' },
  { x: 238, y: 345, w: 145, h: 88, title: 'FastAPI service', body: 'Climate assembly\nLASSO prediction' },
  { x: 52, y: 500, w: 220, h: 78, title: 'CMIP6 NetCDF', body: 'Monthly variables · nearest climate grid' },
  { x: 310, y: 500, w: 220, h: 78, title: 'Active model artifact', body: 'StandardScaler + LASSO pipeline' },
];
boxes.forEach((b) => {
  doc.roundedRect(b.x, b.y, b.w, b.h, 9).fillAndStroke(colors.pale, colors.line);
  setFont(true, 10, colors.green); doc.text(b.title, b.x + 10, b.y + 12, { width: b.w - 20, align: 'center' });
  setFont(false, 8.7, colors.gray); doc.text(b.body, b.x + 8, b.y + 34, { width: b.w - 16, align: 'center', lineGap: 2 });
});
function arrow(x1, y1, x2, y2, label) {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(1.4).strokeColor(colors.green).stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  doc.moveTo(x2, y2).lineTo(x2 - 7 * Math.cos(angle - 0.45), y2 - 7 * Math.sin(angle - 0.45)).lineTo(x2 - 7 * Math.cos(angle + 0.45), y2 - 7 * Math.sin(angle + 0.45)).fill(colors.green);
  if (label) { setFont(false, 7.7, colors.gray); doc.text(label, Math.min(x1, x2), Math.min(y1, y2) - 13, { width: Math.abs(x2 - x1) + 10, align: 'center' }); }
}
arrow(197, 234, 238, 234, 'HTTPS / REST');
arrow(383, 234, 424, 234, 'persist');
arrow(310, 278, 310, 345, 'weather + prediction');
arrow(272, 539, 285, 433, 'monthly fields');
arrow(420, 539, 360, 433, 'five features');
doc.y = 610;
subhead('Local development addresses');
table(['Service', 'Local default', 'What it does'], [
  ['Vite / React', 'localhost:5180', 'Mobile/desktop development client; proxies API, uploads, and Socket.IO.'],
  ['Express API', '127.0.0.1:5021', 'Authentication, validation, persistence, API routes, real-time events.'],
  ['FastAPI', '127.0.0.1:8021', 'Climate data extraction and model operations.'],
  ['MongoDB', '127.0.0.1:27017', 'Application records and account-owned history.'],
], [104, 126, 294]);

section('A prediction from start to finish', '02  /  User journey');
[
  ['1. Authenticate', 'Login issues a signed HTTP-only cookie. Subsequent API requests include it automatically; the API resolves the account ID and role from the JWT.'],
  ['2. Select the map point', 'The user clicks or drags the pin in the Palawan map. The selected coordinates are passed into weather extraction and prediction. The configured accepted extent is 7.0–12.9°N and 116.0–121.0°E.'],
  ['3. Choose the date window', 'The forecast must contain exactly 365 inclusive days. The end date is 364 days after the start, and the start must be no earlier than January 1 of the current year.'],
  ['4. Review weather', 'The browser requests the 365-day climate window. The service returns five weather values, monthly summaries, source names, and coverage counts.'],
  ['5. Run LASSO', 'Express validates the same window and location again, then passes dates and coordinates to FastAPI. Python assembles the ordered feature vector, applies the active StandardScaler/LASSO pipeline, and produces the estimate and risk band.'],
  ['6. Persist and act', 'Express stores the input values, source metadata, output, and model information. The user can save the report, download its PDF, revisit history, or contact an agriculture account.'],
].forEach(([title, text]) => card(title, text));
para('The output is a screening estimate. It is not a calibrated probability or a farm-level diagnosis; field inspection and local agriculture guidance remain important.', { size: 9.4, color: colors.orange });

section('How climate values are assembled', '03  /  Climate service');
para('The active extraction logic is in `ml-service/climate.py`. It opens the imported monthly NetCDF files with xarray, finds the latitude/longitude coordinate names, selects the nearest grid point, filters the requested year/month, converts units when needed, and preserves the source filename.', { size: 9.7 });
doc.moveDown(0.35);
table(['Feature', 'CMIP6 variable', 'Model unit', 'Conversion / aggregation'], [
  ['Rainfall', 'pr', 'mm/year', 'Flux: multiply by seconds/day and days in month. mm/day: multiply by days in month. Sum represented days.'],
  ['Temperature', 'tas', '°C', 'When input is Kelvin, subtract 273.15. Day-weighted average over the date window.'],
  ['Relative humidity', 'hurs', '%', 'Use source values when present; day-weighted average.'],
  ['Solar radiation', 'rsds', 'MJ/m²/day', 'W/m² × 0.0864; day-weighted average.'],
  ['Wind speed', 'sfcWind', 'm/s', 'Use source values when present; day-weighted average.'],
], [85, 74, 82, 283], { size: 7.6 });
card('Data fallback order', 'For each feature/month, use an available original annual weather row when one matches; otherwise read a covering CMIP6 monthly series at the selected coordinate. Missing coverage falls back to a labeled training-climatology value. The API reports each source so mixed/fallback inputs remain visible.');
card('Window aggregation', 'The selected dates are traversed day by day. Monthly input is reused for days within that month. Rainfall is accumulated across the 365 days; temperature, humidity, solar radiation, and wind are averaged with day counts as weights.');
card('Climate file coverage', 'The archive has seven imported monthly files. It mixes historical, SSP2-4.5, and decadal-forecast sources; the fields do not make one complete, consistent future climate series. NetCDF grid cells are coarse, so the nearest-grid result is an area estimate, not a farm weather station.');

section('Model, training, and result meaning', '04  /  Prediction model');
card('Inputs and artifact', 'The five model inputs are annual rainfall (mm/year), temperature (°C), humidity (%), solar radiation (MJ/m²/day), and wind speed (m/s). The active artifact is a scikit-learn StandardScaler + LASSO regression pipeline. The documented Palawan retraining used alpha 0.05, 100 annual location rows, 23 locations, and years 2014–2025.');
card('Prediction output', 'The active model uses a 0–100 infestation-rate scale. Results are constrained to this configured range. Low is below 33%; Medium is 33% to below 66%; High is 66% or higher. The UI also shows suggested monitoring actions, the selected dates/location, and the extracted weather context.');
card('Validation evidence', 'Leave-one-year-out validation holds out all locations from one year at a time, fits on the other years, and compares predictions with held-out labels. The recorded MAE is 15.00 percentage points; the simple training-mean baseline is 17.73. The held-out-location LASSO MAE is 17.76. This is exploratory evidence, not a production guarantee.');
card('Interpretation limits', 'The dataset is modest; some labels repeat across years and survey definitions differ. Weather rows approximate municipality centers rather than farms. Do not interpret the output as a calibrated probability, causal effect, or field diagnosis. See `docs/model-validation.md` and `docs/data-inventory.md` for experiment and source detail.');

section('Page directory', '05  /  Interface');
table(['Route', 'Page', 'Purpose'], [
  ['/', 'Home', 'Project overview, Palawan scope, and account entry.'],
  ['/login', 'Sign in', 'Authenticate an existing account.'],
  ['/signup', 'Create account', 'Profile, consent, and email verification.'],
  ['/forgot-password', 'Password recovery', 'Request a secure reset link.'],
  ['/reset-password', 'Password reset', 'Set a new password from a valid link.'],
  ['/app/prediction', 'Prediction', 'Location → dates → weather → result.'],
  ['/app/history', 'History', 'Review, save, download, or delete forecasts.'],
  ['/app/saved', 'Saved reports', 'Reopen/delete saved forecasts.'],
  ['/app/forum', 'Community forum', 'Search, post media, like, comment, and reply.'],
  ['/app/profile/:id', 'Member profile', 'Public member information and message link.'],
  ['/app/messages', 'Messages', 'Direct, designated group, and admin broadcast chats.'],
  ['/app/ai', 'AI assistant', 'Saved assistant conversations, if provider is configured.'],
  ['/app/settings', 'Settings', 'Profile, privacy, language, password, account.'],
  ['/app/system-iteration', 'Researcher', 'Model, datasets, experiments, retraining.'],
  ['/app/da', 'DA dashboard', 'Forecast and risk summaries for DA/admin.'],
  ['/app/admin', 'Admin', 'Users, moderation, services, traffic, configuration.'],
], [118, 118, 288], { size: 7.6 });
para('Legacy map, calendar, and climate URLs redirect into the current prediction flow; they are not separate pages in the active React router.', { size: 8.8, color: colors.gray });

section('API reference: Express', '06  /  Application programming interface');
para('The Express service is mounted at `/api`. Authentication is cookie-based for the browser; route middleware applies account and role checks. Public health is available at `/api/health`. Express does not currently publish its own Swagger UI.', { size: 9.6 });
table(['Route group', 'Key operations', 'Access purpose'], [
  ['/auth', 'Signup, verify, login/logout, current account, password reset.', 'Public auth actions; current-account route requires login.'],
  ['/users', 'Current/public profiles, search, profile/password update, deletion.', 'Personal changes require login; public profile reads may be anonymous.'],
  ['/climate', 'Years, year detail, 365-day window.', 'Climate proxy endpoints.'],
  ['/predictions', 'Create/list/get/delete, save, PDF report.', 'Signed-in user; history is scoped to that user.'],
  ['/saved-predictions', 'List and delete saved items.', 'Signed-in owner.'],
  ['/posts + /comments', 'Search/list/create, media, comments/replies/likes, update/delete.', 'Public reads where configured; writing requires login.'],
  ['/messages', 'Threads, direct/group messages, chunked group files, broadcast.', 'Signed-in; group membership/admin restrictions apply.'],
  ['/uploads', 'Media upload and limits.', 'Upload requires login.'],
  ['/notifications', 'List/unread count and read-state updates.', 'Signed-in account.'],
  ['/ai/conversations', 'List/create, append message/response.', 'Signed-in roles.'],
  ['/ml', 'Model info, preview/train, experiments, activation.', 'Researcher/admin.'],
  ['/moderation', 'Removal requests and moderation queue/actions.', 'Member request; admin review/actions.'],
  ['/system', 'Overview, accounts/roles, schema, config, health, traffic; DA forecast summary.', 'Admin, except DA/admin forecast summary.'],
], [103, 238, 183], { size: 7.2 });

section('API reference: climate and LASSO', '07  /  Python service');
table(['Method + path', 'Purpose'], [
  ['GET /health', 'Service/model and CMIP6-file health summary.'],
  ['GET /model/info', 'Active model metadata/configuration.'],
  ['GET /train/status', 'Current retraining state.'],
  ['GET /train/experiments', 'List saved training experiments.'],
  ['GET /train/template', 'Download a training input template.'],
  ['POST /train/preview', 'Validate a CSV/XLSX dataset without activation.'],
  ['POST /train', 'Train and validate a supplied dataset.'],
  ['POST /train/palawan', 'Train from the prepared Palawan dataset.'],
  ['POST /train/experiments/{id}/activate', 'Activate an existing experiment.'],
  ['GET /train/experiments/{id}/dataset', 'Download an experiment dataset.'],
  ['DELETE /train/experiments/{id}', 'Delete an experiment.'],
  ['GET /climate/years and /year/{year}', 'Climate year list/details.'],
  ['GET /climate/window', '365-day coordinate/date feature extraction.'],
  ['POST /predict', 'Climate-window features through active LASSO inference.'],
  ['GET /docs', 'Interactive OpenAPI reference (FastAPI).'],
], [238, 286], { size: 7.8 });
para('The ML service should normally be reached through the Express API. Training/activation routes change model state and must stay behind researcher/admin authorization; do not publish the ML port to untrusted networks.', { size: 9, color: colors.orange });

section('Services, storage, and events', '08  /  Runtime');
table(['Component', 'Responsibility', 'Stored state / notes'], [
  ['React + Vite', 'Pages, form state, maps, charts, API calls.', 'Client assets; Vite proxies API/uploads/Socket.IO in development.'],
  ['Express + Socket.IO', 'JWT auth, role controls, validation, record operations, PDFs, real-time messages/events.', 'Serves built frontend in production when `frontend/dist` is present.'],
  ['MongoDB + Mongoose', 'Accounts and application records.', 'Users, predictions, saved reports, posts, comments, notifications, messages, conversations.'],
  ['FastAPI climate/model', 'CMIP6 reading, fallbacks, inference, training operations.', 'Seven NetCDF monthly inputs and joblib experiment/model artifacts on disk.'],
  ['File storage', 'Community media and group attachments.', 'Configured upload paths; group transfer uses 8 MiB chunks and up to 1 GiB.'],
  ['SMTP mailer', 'Verification/reset messages.', 'Requires SMTP credentials in runtime secret configuration.'],
  ['Optional Ollama endpoint', 'AI assistant responses.', 'Requires configured URL and model; page may be unavailable without it.'],
], [112, 197, 215], { size: 7.4 });
card('Realtime path', 'Socket.IO authenticates a socket from the signed cookie/token and joins account/admin rooms. The API emits events for notifications, forum and messaging updates so connected pages can refresh without polling every interaction.');
card('Persistence map', 'MongoDB stores application records. The active climate reader loads source NetCDF and training CSV from the repository data tree; scikit-learn/joblib loads the active estimator from `ml-service/models/`. Uploaded files use local configured directories, so backups must cover both database and file storage.');

section('Controls, roles, and validation', '09  /  Access and safety');
table(['Control', 'What it enforces'], [
  ['Signed-in cookie', 'HTTP-only JWT cookie is checked by `requireAuth`; a bearer token is also recognized by the middleware.'],
  ['Roles', 'Farmer/member pages; researcher/admin model workspace; DA/admin forecast dashboard; admin-only system and moderation controls.'],
  ['Verification', 'Six-digit email code in six separate boxes; 10-minute expiry, five failed attempts, 30-second resend cooldown.'],
  ['Forecast request', 'Exactly 365 days, start on/after current-year Jan 1, required dates, accepted coordinate extent.'],
  ['Research input', 'CSV/XLSX only, maximum 12 MiB; preview/validation endpoint is separate from model training.'],
  ['Media', 'Images/video for posts, up to eight files; group files stream in chunks, retain original filenames, and cap at 1 GiB.'],
  ['Account deletion', 'Confirmation dialog; removes the account and related personal records. Treat as irreversible.'],
], [132, 392], { size: 7.8 });
card('Admin control center', 'The admin dashboard includes overview, users/roles, forum review, live topology, traffic monitoring, conversation inspection, database schema, system configuration, and health/performance data. Changes are role-gated in Express; the UI is not the security boundary.');
card('Researcher controls', 'The researcher dashboard can preview a dataset, start a retraining job, use the prepared Palawan set, inspect experiments, download datasets, and activate an experiment. Training routes are protected for researcher/admin.');
card('Privacy and deployment', 'Keep JWT/SMTP/provider credentials in `.env` or the deployment secret store. Do not commit environment files. Health and service endpoints are intended for the application/operations layer, not public exposure of training controls.');

section('Operating notes and limits', '10  /  Practical guide');
subhead('Start locally');
[
  'Install Node.js 20+, Python 3.10+, and MongoDB 7+.',
  'Run `scripts/setup.ps1`; configure `backend/.env` with a strong local JWT secret and MongoDB URI.',
  'Start MongoDB, then run `scripts/start.ps1` or `npm run dev` from the repository root.',
  'Open `http://localhost:5180`. The development client proxies `/api`, `/uploads`, and `/socket.io` to Express.',
].forEach((text) => bullet(text));
subhead('If a page or forecast fails');
[
  'Check `/api/health` for Express and the admin health tab for database/model status.',
  'Check the ML service `/health` and `/docs`; confirm the model artifact and imported NetCDF files are present.',
  'Confirm start/end dates span 365 days and the pin is within the configured extent.',
  'Check the returned per-feature source labels. Fallback data can be valid to display while still differing from a complete CMIP6 series.',
  'If signup/reset email fails, verify SMTP runtime settings; account email actions require a working mail transport.',
].forEach((text) => bullet(text));
subhead('Interpret with care');
para('The new Palawan model has a 15.00 percentage-point leave-one-year-out MAE and a 17.76-point leave-one-location-out MAE. The simple yearly mean baseline is 17.73 points. The scores are exploratory because the annual dataset is limited, some labels repeat, and weather values are estimated at municipality centers. They are not a guarantee for any farm or future season.', { size: 9.4 });

section('Mobile screenshot gallery', '11  /  Captured screens');
para('The following direct captures are from the local Android virtual device at 1080 x 1920. The page captions identify the main purpose of each screen. Examples in account settings, history, forum, chat, and dashboards are synthetic demonstration data in the isolated documentation database.', { size: 9.3 });

for (const [filename, title, caption] of screenshots) {
  const imagePath = path.join(SHOTS, filename);
  if (!fs.existsSync(imagePath)) throw new Error(`Screenshot is missing: ${imagePath}`);
  doc.addPage();
  setFont(true, 8, colors.green);
  doc.text('MOBILE SCREEN CAPTURE', 44, 35, { characterSpacing: 1.1 });
  setFont(true, 16, colors.deep);
  doc.text(title, 44, 50, { width: 524 });
  const imageTop = 83;
  const imageMeta = doc.openImage(imagePath);
  const scale = Math.min(524 / imageMeta.width, 610 / imageMeta.height);
  const imageWidth = imageMeta.width * scale;
  const imageHeight = imageMeta.height * scale;
  const imageX = (doc.page.width - imageWidth) / 2;
  doc.image(imagePath, imageX, imageTop, { width: imageWidth, height: imageHeight });
  setFont(false, 8.8, colors.gray);
  doc.text(`${caption}\nFile: screenshots/${filename}`, 54, 705, { width: 504, align: 'center', lineGap: 2 });
}

const pages = doc.bufferedPageRange();
for (let i = 0; i < pages.count; i += 1) {
  doc.switchToPage(pages.start + i);
  if (i === 0) continue;
  doc.save();
  doc.moveTo(44, 730).lineTo(568, 730).lineWidth(0.5).strokeColor(colors.line).stroke();
  setFont(false, 7.5, colors.gray);
  doc.text('WeeWare  |  System end-to-end guide  |  11 November 2026', 44, 735, { width: 390 });
  doc.text(`${i + 1} / ${pages.count}`, 486, 735, { width: 82, align: 'right' });
  doc.restore();
}
doc.end();
doc.on('finish', () => console.log(`PDF written: ${OUTPUT} (${pages.count} pages)`));
