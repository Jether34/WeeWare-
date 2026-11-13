import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

const defaultConfig = { alpha_mode: 'auto', alpha: 0.1, cv_folds: 5, max_iter: 100000, fit_intercept: true, features: ['rainfall', 'temperature', 'humidity', 'solar', 'wind'], prediction: { min: 0, max: 100, low_threshold: 33, high_threshold: 66 } };
const asConfig = (config) => ({ ...defaultConfig, ...config, prediction: { ...defaultConfig.prediction, ...(config?.prediction || {}) } });
const dateLabel = (date) => date ? new Date(date).toLocaleString() : '—';

function Metric({ label, value, detail }) {
  return <article className="research-metric"><span>{label}</span><strong>{value ?? '—'}</strong>{detail && <small>{detail}</small>}</article>;
}

function WekaEvaluationView({ result, onDownload }) {
  if (!result) return null;
  const risk = result.risk_evaluation;
  const points = result.predictions || [];
  const extent = Math.max(100, ...points.flatMap((point) => [point.actual, point.predicted]));
  const x = (value) => 38 + (Number(value) / extent) * 260;
  const y = (value) => 188 - (Number(value) / extent) * 158;
  const metric = (value) => Number(value).toFixed(3);
  return <div className="weka-evaluation" aria-live="polite">
    <div className="validation-metrics weka-result-metrics">
      <Metric label="Cross-validation MAE" value={metric(result.metrics.mae)} detail="percentage points; lower is better"/>
      <Metric label="Cross-validation RMSE" value={metric(result.metrics.rmse)} detail="percentage points; lower is better"/>
      <Metric label="Correlation" value={metric(result.metrics.correlation)} detail="observed vs predicted"/>
      <Metric label="Risk-band accuracy" value={`${(risk.accuracy * 100).toFixed(1)}%`} detail={`${points.length} held-out predictions`}/>
    </div>
    <section className="weka-evaluation-section">
      <div className="weka-evaluation-title"><div><h3>Observed vs predicted infestation rate</h3><p>Each dot is a held-out Weka prediction. The diagonal shows a perfect match.</p></div><button type="button" className="button secondary" onClick={onDownload}>Download predictions CSV</button></div>
      <div className="validation-chart weka-scatter-chart">
        <svg viewBox="0 0 320 220" role="img" aria-label="Weka observed versus predicted infestation rates scatter plot">
          <line x1="38" y1="188" x2="298" y2="188"/><line x1="38" y1="188" x2="38" y2="30"/>
          <line className="weka-ideal-line" x1="38" y1="188" x2={x(extent)} y2={y(extent)}/>
          {points.map((point) => <circle key={point.row} className={`weka-point weka-point-${point.actual_risk.toLowerCase()}`} cx={x(point.actual)} cy={y(point.predicted)} r="3.4"><title>{`CV row ${point.row}: observed ${point.actual.toFixed(2)}%, predicted ${point.predicted.toFixed(2)}%`}</title></circle>)}
          <text x="168" y="215" textAnchor="middle">Observed infestation rate (%)</text><text x="12" y="110" textAnchor="middle" transform="rotate(-90 12 110)">Predicted (%)</text>
        </svg>
        <div className="validation-legend"><span><i className="weka-point-key"/>Cross-validation rows</span><span><i className="weka-line-key"/>Perfect prediction</span></div>
      </div>
    </section>
    <section className="weka-evaluation-section">
      <div className="weka-evaluation-title"><div><h3>Risk-band confusion matrix</h3><p>Actual bands are rows; predicted bands are columns. Thresholds: Low &lt; {risk.thresholds.low}%, Medium &lt; {risk.thresholds.high}%, High otherwise.</p></div></div>
      <div className="research-table-wrap"><table className="research-data-table weka-confusion-table"><thead><tr><th>Actual ↓ / Predicted →</th>{risk.labels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{risk.matrix.map((row, index) => <tr key={risk.labels[index]}><th>{risk.labels[index]}</th>{row.map((count, column) => <td key={risk.labels[column]}>{count}</td>)}</tr>)}</tbody></table></div>
      <div className="research-table-wrap"><table className="research-data-table weka-class-metrics"><thead><tr><th>Risk band</th><th>Support</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>{risk.per_class.map((item) => <tr key={item.name}><th>{item.name}</th><td>{item.support}</td><td>{metric(item.precision)}</td><td>{metric(item.recall)}</td><td>{metric(item.f1)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="weka-evaluation-section">
      <div className="weka-evaluation-title"><div><h3>Cross-validation predictions</h3><p>Showing the first {Math.min(20, points.length)} of {points.length} held-out predictions, in Weka output order.</p></div></div>
      <div className="research-table-wrap weka-prediction-scroll"><table className="research-data-table"><thead><tr><th>CV row</th><th>Observed %</th><th>Predicted %</th><th>Abs. error</th><th>Actual risk</th><th>Predicted risk</th></tr></thead><tbody>{points.slice(0, 20).map((point) => <tr key={point.row}><td>{point.row}</td><td>{point.actual.toFixed(3)}</td><td>{point.predicted.toFixed(3)}</td><td>{point.absolute_error.toFixed(3)}</td><td>{point.actual_risk}</td><td>{point.predicted_risk}</td></tr>)}</tbody></table></div>
    </section>
    <p className="research-footnote">Dataset: {result.filename} · {result.validation} · {result.rows} rows · features: {result.features.join(', ')}. {result.note}</p>
  </div>;
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
  const [dashboard, setDashboard] = useState(null);
  const [config, setConfig] = useState(defaultConfig);
  const [file, setFile] = useState(null);
  const [wekaFile, setWekaFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [wekaRuntime, setWekaRuntime] = useState(null);
  const [wekaResult, setWekaResult] = useState(null);
  const [wekaAlgorithm, setWekaAlgorithm] = useState('random_forest');
  const [wekaFolds, setWekaFolds] = useState(5);
  const [wekaLowThreshold, setWekaLowThreshold] = useState(33);
  const [wekaHighThreshold, setWekaHighThreshold] = useState(66);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInput = useRef(null);
  const wekaFileInput = useRef(null);
  const configInitialized = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      const { data } = await api.get('/ml/researcher/dashboard', { timeout: 30000 });
      setDashboard(data);
      if (!configInitialized.current && data.model?.config) {
        setConfig(asConfig(data.model.config));
        setWekaLowThreshold(Number(data.model.config.prediction?.low_threshold ?? 33));
        setWekaHighThreshold(Number(data.model.config.prediction?.high_threshold ?? 66));
        configInitialized.current = true;
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDashboard(); const timer = window.setInterval(loadDashboard, busy ? 2200 : 4000); return () => window.clearInterval(timer); }, [loadDashboard, busy]);
  useEffect(() => { api.get('/ml/weka/status').then(({ data }) => setWekaRuntime(data)).catch(() => setWekaRuntime({ available: false })); }, []);

  const configPayload = useMemo(() => ({ ...config, alpha: Number(config.alpha), cv_folds: Number(config.cv_folds), max_iter: Number(config.max_iter), prediction: Object.fromEntries(Object.entries(config.prediction).map(([key, value]) => [key, Number(value)])) }), [config]);
  const oneClickTrainingConfig = useMemo(() => ({ ...configPayload, alpha_mode: 'fixed', alpha: 0.05 }), [configPayload]);
  function selectFile(nextFile) {
    setPreview(null); setWekaResult(null); setNotice('');
    if (nextFile && !/\.(xlsx|csv)$/i.test(nextFile.name)) { setFile(null); setError('Use an .xlsx workbook or .csv file. Older .xls files are not supported.'); return; }
    if (nextFile && nextFile.size > 12 * 1024 * 1024) { setFile(null); setError('Training datasets must be 12 MB or smaller.'); return; }
    setFile(nextFile); setError('');
  }
  function selectWekaFile(nextFile) {
    setWekaResult(null); setNotice('');
    if (nextFile && !/\.(xlsx|csv)$/i.test(nextFile.name)) { setWekaFile(null); setError('Use a WeeWare .xlsx workbook or .csv file for Weka analysis.'); return; }
    if (nextFile && nextFile.size > 12 * 1024 * 1024) { setWekaFile(null); setError('Weka datasets must be 12 MB or smaller.'); return; }
    setWekaFile(nextFile); setError('');
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

  async function analyzeWithWeka(usePrepared = false) {
    const analysisFile = wekaFile || file;
    if ((!usePrepared && !analysisFile) || busy) return;
    setBusy(true); setAction(usePrepared ? 'weka-prepared' : 'weka'); setError(''); setNotice(''); setWekaResult(null);
    try {
      let response;
      if (usePrepared) {
        response = await api.post('/ml/weka/analyze/palawan', { algorithm: wekaAlgorithm, folds: wekaFolds, lowThreshold: wekaLowThreshold, highThreshold: wekaHighThreshold }, { timeout: 240_000 });
      } else {
        const form = new FormData(); form.append('dataset', analysisFile); form.append('modelConfig', JSON.stringify(configPayload));
        form.append('algorithm', wekaAlgorithm); form.append('folds', String(wekaFolds));
        form.append('lowThreshold', String(wekaLowThreshold)); form.append('highThreshold', String(wekaHighThreshold));
        response = await api.post('/ml/weka/analyze', form, { timeout: 240_000 });
      }
      const { data } = response;
      setWekaResult(data);
      setNotice(`Weka ${data.algorithm_label} completed ${data.folds}-fold cross-validation on ${data.rows} rows.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setAction(''); }
  }

  function downloadWekaPredictions() {
    if (!wekaResult?.predictions?.length) return;
    const columns = ['cv_row', 'observed_rate', 'predicted_rate', 'absolute_error', 'actual_risk', 'predicted_risk'];
    const escapeCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = wekaResult.predictions.map((item) => [item.row, item.actual, item.predicted, item.absolute_error, item.actual_risk, item.predicted_risk]);
    const blob = new Blob([[columns, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'weka-cross-validation-predictions.csv'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const model = dashboard?.model || {};
  const training = dashboard?.training || {};
  const predictions = dashboard?.predictions || [];
  const experiments = dashboard?.experiments || [];
  const activeExperiment = experiments.find((experiment) => experiment.active);

  return <div className="page role-tool-page researcher-dashboard-page">
    <header className="role-tool-heading"><div><span className="section-kicker">RESEARCH WORKSPACE</span><h1 className="page-title">LASSO model dashboard</h1><p className="page-subtitle">Model controls, validation, and activity.</p></div><span className={`role-tool-badge ${training.state === 'running' ? 'training-badge' : ''}`}>{training.state === 'running' ? 'Retraining live' : 'Researcher access'}</span></header>

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

                <section className="card research-panel weka-research-panel">
          <div className="research-panel-head"><div><span className="section-kicker">WEKA RESEARCH WORKSPACE</span><h2>Analyze and evaluate a dataset</h2><p>Run Weka regression models, compare held-out predictions, and inspect risk-band performance.</p></div><span className={`research-live-chip ${wekaRuntime?.available ? '' : 'weka-unavailable'}`}><i/>{wekaRuntime?.available ? `Weka ${wekaRuntime.version}` : 'Runtime unavailable'}</span></div>
          <div className="research-config-grid weka-config-grid">
            <label><span>Weka algorithm</span><select value={wekaAlgorithm} onChange={(event) => { setWekaAlgorithm(event.target.value); setWekaResult(null); }}><option value="random_forest">Random Forest</option><option value="m5p">M5P Model Tree</option><option value="linear_regression">Linear Regression</option></select></label>
            <label><span>Cross-validation folds</span><select value={wekaFolds} onChange={(event) => { setWekaFolds(Number(event.target.value)); setWekaResult(null); }}>{[2,3,4,5,6,7,8,9,10].map((fold) => <option key={fold} value={fold}>{fold} folds</option>)}</select></label>
            <label><span>Low risk cutoff (%)</span><input type="number" min="0" max="99.99" step="any" value={wekaLowThreshold} onChange={(event) => { setWekaLowThreshold(Number(event.target.value)); setWekaResult(null); }}/></label>
            <label><span>High risk cutoff (%)</span><input type="number" min="0.01" max="100" step="any" value={wekaHighThreshold} onChange={(event) => { setWekaHighThreshold(Number(event.target.value)); setWekaResult(null); }}/></label>
            <div className="research-method-summary weka-dataset-summary"><strong>Dataset to evaluate</strong><span>{wekaFile ? `${wekaFile.name} · selected for Weka` : file ? `${file.name} · using the training-card file` : 'No uploaded file selected. You can analyze the prepared Palawan dataset below.'}</span><input ref={wekaFileInput} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" aria-label="Choose a Weka dataset" onChange={(event) => { selectWekaFile(event.target.files?.[0] || null); event.currentTarget.value = ''; }}/><button type="button" className="button secondary" onClick={() => wekaFileInput.current?.click()}>Choose Weka dataset</button></div>
          </div>
          {!wekaRuntime?.available && <p className="research-footnote">Install the pinned Weka runtime with <code>npm run setup:weka</code>, then restart the ML service.</p>}
          <p className="research-footnote">Weka runs random-fold cross-validation. The risk-band confusion matrix is derived from each held-out predicted rate using the cutoffs above. This analysis is separate from the production LASSO model.</p>
          <div className="research-action-row"><button type="button" className="button secondary" disabled={busy || !wekaRuntime?.available} onClick={() => analyzeWithWeka(true)}>{action === 'weka-prepared' ? 'Evaluating prepared data…' : 'Analyze prepared Palawan dataset'}</button><button type="button" className="button" disabled={(!wekaFile && !file) || busy || !wekaRuntime?.available} onClick={() => analyzeWithWeka(false)}>{action === 'weka' ? 'Evaluating with Weka…' : 'Run Weka evaluation'}</button></div>
          <WekaEvaluationView result={wekaResult} onDownload={downloadWekaPredictions}/>
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
