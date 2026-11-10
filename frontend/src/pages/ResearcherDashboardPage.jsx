import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../auth';

const defaultConfig = { alpha_mode: 'auto', alpha: 0.1, cv_folds: 5, max_iter: 100000, fit_intercept: true, features: ['rainfall', 'temperature', 'humidity', 'solar', 'wind'], prediction: { min: 0, max: 100, low_threshold: 33, high_threshold: 66 } };
const asConfig = (config) => ({ ...defaultConfig, ...config, prediction: { ...defaultConfig.prediction, ...(config?.prediction || {}) } });
const dateLabel = (date) => date ? new Date(date).toLocaleString() : '—';

function Metric({ label, value, detail }) {
  return <article className="research-metric"><span>{label}</span><strong>{value ?? '—'}</strong>{detail && <small>{detail}</small>}</article>;
}

function CoefficientView({ model }) {
  const values = Object.entries(model?.coefficients || {});
  const max = Math.max(0.000001, ...values.map(([, value]) => Math.abs(Number(value) || 0)));
  return <section className="card research-panel lasso-panel">
    <div className="research-panel-head"><div><span className="section-kicker">MODEL STRUCTURE</span><h2>Inside the LASSO model</h2><p>Standardized coefficient weights selected by the active regularized regression.</p></div><span className="research-live-chip"><i/> Active model</span></div>
    <div className="lasso-formula"><span>ŷ</span><b>=</b><strong>{Number(model?.intercept || 0).toFixed(3)}</strong>{values.map(([name, value]) => <span className="formula-term" key={name}>{Number(value) < 0 ? '−' : '+'} {Math.abs(Number(value)).toFixed(3)} <small>{name}</small></span>)}</div>
    <div className="coefficient-list">{values.map(([name, value]) => { const coefficient = Number(value) || 0; return <div className="coefficient-row" key={name}><span>{name}</span><div className="coefficient-track"><i className={coefficient < 0 ? 'negative' : ''} style={{ width: `${Math.max(coefficient === 0 ? 0 : 2, Math.abs(coefficient) / max * 48)}%`, left: coefficient < 0 ? undefined : '50%', right: coefficient < 0 ? '50%' : undefined }}/></div><strong>{coefficient.toFixed(5)}</strong></div>; })}</div>
    <p className="research-footnote">Zero weights are removed by L1 regularization. Weights are shown after feature standardization; the scaler mean and scale are stored with the active pipeline.</p>
  </section>;
}

function ValidationView({ validation, spatialValidation }) {
  if (!validation) return <p className="research-empty">Train a dataset to see held-out validation results.</p>;
  const observed = validation.observed || [];
  const predicted = validation.predictions || [];
  const years = validation.years || [];
  const format = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';
  const all = [...observed, ...predicted];
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const points = (list) => list.map((value, index) => `${10 + index * (280 / Math.max(1, list.length - 1))},${92 - ((value - min) / (max - min || 1)) * 76}`).join(' ');
  return <div className="validation-view">{observed.length > 0 && predicted.length > 0 && <div className="validation-chart"><svg viewBox="0 0 300 100" role="img" aria-label="Observed and cross-validated infestation rates by year"><line x1="10" y1="92" x2="290" y2="92"/><polyline className="observed-line" points={points(observed)}/><polyline className="predicted-line" points={points(predicted)}/></svg><div className="validation-legend"><span><i className="observed-key"/>Observed</span><span><i className="predicted-key"/>LOYO prediction</span></div><div className="validation-years">{years.map((year, index) => <small key={`${year}-${index}`}>{year}</small>)}</div></div>}{observed.length === 0 && <p className="research-empty">Detailed year-by-year validation is available for model versions trained in this workspace.</p>}<div className="validation-metrics"><Metric label="Validation MAE" value={format(validation.mae)} detail="percentage points"/><Metric label="Mean baseline MAE" value={format(validation.baseline_mae)} detail="lower is better"/><Metric label="Validation RMSE" value={format(validation.rmse)} detail="percentage points"/></div>{spatialValidation && <div className="validation-metrics"><Metric label="Held-out location MAE" value={format(spatialValidation.mae)} detail={`${spatialValidation.locations} locations; baseline ${format(spatialValidation.baseline_mae)}`}/><Metric label="Held-out location RMSE" value={format(spatialValidation.rmse)} detail={`baseline ${format(spatialValidation.baseline_rmse)}`}/></div>}<p className="research-footnote">Year and location holdouts are compared with training-mean baselines. Spatial transfer performance should guide use across Palawan.</p></div>;
}

export default function ResearcherDashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [config, setConfig] = useState(defaultConfig);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInput = useRef(null);
  const configInitialized = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      const { data } = await api.get('/ml/researcher/dashboard', { timeout: 30000 });
      setDashboard(data);
      if (!configInitialized.current && data.model?.config) {
        setConfig(asConfig(data.model.config));
        configInitialized.current = true;
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDashboard(); const timer = window.setInterval(loadDashboard, busy ? 2200 : 4000); return () => window.clearInterval(timer); }, [loadDashboard, busy]);

  const configPayload = useMemo(() => ({ ...config, alpha: Number(config.alpha), cv_folds: Number(config.cv_folds), max_iter: Number(config.max_iter), prediction: Object.fromEntries(Object.entries(config.prediction).map(([key, value]) => [key, Number(value)])) }), [config]);
  const oneClickTrainingConfig = useMemo(() => ({ ...configPayload, alpha_mode: 'fixed', alpha: 0.05 }), [configPayload]);
  function updateConfig(key, value) { setConfig((current) => ({ ...current, [key]: value })); setPreview(null); }
  function toggleFeature(feature) { setConfig((current) => ({ ...current, features: current.features.includes(feature) ? current.features.filter((item) => item !== feature) : [...current.features, feature] })); setPreview(null); }
  function updatePredictionConfig(key, value) { setConfig((current) => ({ ...current, prediction: { ...current.prediction, [key]: value } })); setPreview(null); }
  function selectFile(nextFile) {
    setPreview(null); setNotice('');
    if (nextFile && !/\.(xlsx|csv)$/i.test(nextFile.name)) { setFile(null); setError('Use an .xlsx workbook or .csv file. Older .xls files are not supported.'); return; }
    if (nextFile && nextFile.size > 12 * 1024 * 1024) { setFile(null); setError('Training datasets must be 12 MB or smaller.'); return; }
    setFile(nextFile); setError('');
  }
  function uploadForm(modelConfig = configPayload) { const form = new FormData(); form.append('dataset', file); form.append('modelConfig', JSON.stringify(modelConfig)); return form; }

  async function downloadFile(url, filename) {
    const { data } = await api.get(url, { responseType: 'blob', timeout: 60000 });
    const objectUrl = URL.createObjectURL(data);
    const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function previewDataset() {
    if (!file) return;
    setBusy(true); setAction('preview'); setError(''); setNotice('');
    try { const { data } = await api.post('/ml/train/preview', uploadForm(), { timeout: 60000 }); setPreview(data); setNotice('Dataset validated. Review it before retraining the live model.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); setAction(''); }
  }

  async function startTraining() {
    if (!file || busy) return;
    setBusy(true); setAction('training'); setError(''); setNotice('Retraining and leave-one-year-out validation are running. The current model serves predictions until the new model passes and activates.');
    try { const { data } = await api.post('/ml/train', uploadForm(oneClickTrainingConfig), { timeout: 10 * 60 * 1000 }); setNotice(`Retraining completed with the signal-preserving LASSO method. Model ${data.id.slice(0, 8)} is now live for new predictions.`); setFile(null); setPreview(null); if (fileInput.current) fileInput.current.value = ''; await loadDashboard(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); setAction(''); }
  }

  async function trainPreparedPalawan() {
    if (busy) return;
    setBusy(true); setAction('prepared-training'); setError(''); setNotice('Training from the prepared Palawan annual dataset with year and location holdouts.');
    try {
      const { data } = await api.post('/ml/train/palawan', {}, { timeout: 10 * 60 * 1000 });
      setNotice(`Palawan retraining completed. Model ${data.id.slice(0, 8)} is now live for new predictions.`);
      await loadDashboard();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setAction(''); }
  }

  const model = dashboard?.model || {};
  const training = dashboard?.training || {};
  const predictions = dashboard?.predictions || [];
  const experiments = dashboard?.experiments || [];
  const activeExperiment = experiments.find((experiment) => experiment.active);

  return <div className="page role-tool-page researcher-dashboard-page">
    <header className="role-tool-heading"><div><span className="section-kicker">RESEARCH WORKSPACE</span><h1 className="page-title">LASSO model dashboard</h1><p className="page-subtitle">Retrain the production model, configure prediction behavior, review model versions, and monitor live activity.</p></div><span className={`role-tool-badge ${training.state === 'running' ? 'training-badge' : ''}`}>{training.state === 'running' ? 'Retraining live' : 'Researcher access'}</span></header>

    {(error || notice) && <div className={`iteration-notice ${error ? 'research-error' : ''}`} role={error ? 'alert' : 'status'}><strong>{error ? 'Action needed' : 'Workspace update'}</strong><span>{error || notice}</span></div>}

    <section className="research-metrics-grid" aria-label="Active model summary"><Metric label="Active model" value={model.model_type || 'LASSO Regression'} detail={activeExperiment ? `Version ${activeExperiment.id.slice(0, 8)}` : 'Bundled model'} /><Metric label="Training rows" value={model.samples ?? '—'} detail={model.training_period || 'Training period unavailable'} /><Metric label="Selected alpha" value={model.alpha == null ? '—' : Number(model.alpha).toPrecision(4)} detail="Signal-preserving LASSO" /><Metric label="Last trained" value={model.retrained_at ? dateLabel(model.retrained_at) : '—'} detail={model.model_file || 'Model artifact'} /></section>

    <div className="research-dashboard-grid">
      <div className="research-main-column">
        <CoefficientView model={model}/>
        <section className="card research-panel training-panel">
          <div className="research-panel-head"><div><span className="section-kicker">PRODUCTION MODEL TRAINING</span><h2>Retrain the live model</h2><p>Drop a dataset and select Retrain and deploy. The dashboard applies signal-preserving LASSO at alpha 0.05, validates with whole-year and whole-location holdouts, then activates the model.</p></div></div>
          <div className="training-toolbar"><button className="button" type="button" disabled={busy} onClick={trainPreparedPalawan}>{action === 'prepared-training' ? 'Training Palawan dataset…' : 'Train with prepared Palawan dataset'}</button><button className="button secondary" type="button" onClick={() => downloadFile('/ml/train/template', 'weeware-lasso-training-template.xlsx').catch((err) => setError(err.message))}>Download Excel template</button><span>100 location-year records · five annual weather variables · infestation rates</span></div>
          <div className={`research-dropzone ${file ? 'has-file' : ''} ${isDraggingFile ? 'is-dragging' : ''}`} role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click(); } }} onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDraggingFile(false); }} onDrop={(event) => { event.preventDefault(); setIsDraggingFile(false); selectFile(event.dataTransfer.files?.[0] || null); }}>
            <input ref={fileInput} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onClick={(event) => event.stopPropagation()} onChange={(event) => { selectFile(event.target.files?.[0] || null); event.currentTarget.value = ''; }}/>
            <span className="excel-icon">XLSX / CSV</span><strong>{file?.name || 'Drop your training dataset here'}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB · ready to validate or retrain` : 'Drag and drop a WeeWare .xlsx or .csv file, or browse your device.'}</small>
            <span className="button secondary">Browse files</span>
          </div>
          <div className="research-action-row"><button type="button" className="button secondary" disabled={!file || busy} onClick={previewDataset}>{action === 'preview' ? 'Validating…' : 'Validate and preview'}</button><button type="button" className="button" disabled={!file || busy} onClick={startTraining}>{action === 'training' ? 'Training…' : 'Retrain and deploy model'}</button></div>
          {training.state === 'running' && <div className="training-progress"><div className="training-progress-copy"><strong>{training.message || 'Training model…'}</strong><span>{training.progress || 0}%</span></div><div className="training-progress-track"><i style={{ width: `${training.progress || 0}%` }}/></div></div>}
          {preview && <div className="dataset-preview"><div className="dataset-preview-head"><div><strong>Validated dataset</strong><span>{preview.rows} location-year rows · {preview.locations || 1} locations · {preview.years} years ({preview.year_start}–{preview.year_end})</span></div><small>Dataset is sent to the model service when retraining starts.</small></div><div className="research-table-wrap"><table className="research-data-table"><thead><tr>{preview.columns.map((column) => <th key={column}>{column.replace('_', ' ')}</th>)}</tr></thead><tbody>{preview.preview.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column}>{column === 'location' ? row[column] : Number(row[column]).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>)}</tr>)}</tbody></table></div></div>}
        </section>

        <section className="card research-panel configuration-panel">
          <div className="research-panel-head"><div><span className="section-kicker">TRAINING AND PREDICTION ENGINE</span><h2>Model configuration</h2><p>These settings are applied when the next retraining run succeeds and deploys.</p></div></div>
          <div className="research-config-grid">
            <fieldset className="research-feature-fieldset"><legend>Climate predictors</legend><div className="research-feature-options">{[['rainfall','Rainfall'],['temperature','Temperature'],['humidity','Humidity'],['solar','Solar radiation'],['wind','Wind speed']].map(([feature,label]) => <label key={feature}><input type="checkbox" checked={config.features.includes(feature)} disabled={config.features.length === 1 && config.features.includes(feature)} onChange={() => toggleFeature(feature)}/><span>{label}</span></label>)}</div></fieldset>
            <div className="research-method-summary"><strong>One-click training method</strong><span>Standardized LASSO · alpha 0.05 · leave-one-year-out validation · automatic activation</span></div>
            <label><span>Inner CV folds</span><input type="number" min="2" max="10" value={config.cv_folds} onChange={(event) => updateConfig('cv_folds', event.target.value)}/></label>
            <label><span>Maximum iterations</span><input type="number" min="1000" max="1000000" step="1000" value={config.max_iter} onChange={(event) => updateConfig('max_iter', event.target.value)}/></label>
            <label><span>Prediction output minimum</span><input type="number" min="0" max="100" step="any" value={config.prediction.min} onChange={(event) => updatePredictionConfig('min', event.target.value)}/></label>
            <label><span>Prediction output maximum</span><input type="number" min="0.01" max="100" step="any" value={config.prediction.max} onChange={(event) => updatePredictionConfig('max', event.target.value)}/></label>
            <label><span>Low risk threshold</span><input type="number" min="0" max="100" step="any" value={config.prediction.low_threshold} onChange={(event) => updatePredictionConfig('low_threshold', event.target.value)}/></label>
            <label><span>High risk threshold</span><input type="number" min="0" max="100" step="any" value={config.prediction.high_threshold} onChange={(event) => updatePredictionConfig('high_threshold', event.target.value)}/></label>
            <label className="research-checkbox"><input type="checkbox" checked={config.fit_intercept} onChange={(event) => updateConfig('fit_intercept', event.target.checked)}/><span>Fit an intercept</span></label>
          </div>
          <p className="research-footnote">Risk bands are Low below the low threshold, Medium between thresholds, and High at or above the high threshold. Output bounds expand to 100% when rates exceed 5%; set risk thresholds to match the supplied infestation-rate definition.</p>
        </section>
      </div>

      <aside className="research-side-column">
        <section className="card research-panel validation-panel"><div className="research-panel-head"><div><span className="section-kicker">MODEL QUALITY</span><h2>Validation results</h2><p>Active model · {model.validation?.method || 'not available'}</p></div></div><ValidationView validation={model.validation} spatialValidation={model.spatial_validation}/></section>
        <section className="card research-panel live-predictions-panel"><div className="research-panel-head"><div><span className="section-kicker">LIVE SYSTEM ACTIVITY</span><h2>Recent predictions</h2><p>Refreshes automatically · {predictions.length} latest runs</p></div><span className="research-live-chip"><i/> Live</span></div>
          <div className="live-prediction-list">{predictions.map((prediction) => <article className="live-prediction-row" key={prediction._id}><span className={`risk-dot risk-${String(prediction.riskCategory || 'low').toLowerCase()}`}/><div><strong>{prediction.location?.name || 'Puerto Princesa'}</strong><small>{prediction.year} · {dateLabel(prediction.createdAt)}</small></div><b>{Number(prediction.infestationRate).toFixed(2)}%</b></article>)}{!predictions.length && <p className="research-empty">No saved predictions yet.</p>}</div>
        </section>
        <section className="card research-panel system-state-panel"><div className="research-panel-head"><div><span className="section-kicker">TRAINING MONITOR</span><h2>Current run status</h2></div></div><div className="run-status-row"><span className={`status-indicator ${training.state === 'running' ? 'is-running' : ''}`}/><div><strong>{training.state || 'idle'}</strong><small>{training.message || 'Waiting for a training run.'}</small></div></div><small className="run-updated">Updated {dateLabel(training.updated_at)}</small></section>
      </aside>
    </div>

    {loading && !dashboard && <div className="research-loading">Loading model workspace…</div>}
  </div>;
}
