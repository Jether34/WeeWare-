import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import api from '../api';
import DatePicker from '../components/DatePicker';
import { defaultPalawanLocation, FitPalawanExtent, isPalawanCoordinate, PalawanMangoAreas, savedPalawanPin } from '../components/PalawanMangoAreas';

const center = defaultPalawanLocation;
const featureNames = { rainfall: 'Rainfall', temperature: 'Temperature', humidity: 'Relative humidity', solar: 'Solar radiation', wind: 'Wind speed' };
const actionByRisk = { Low: 'Continue routine fruit and orchard monitoring.', Medium: 'Increase field checks and use integrated pest management with local guidance.', High: 'Promptly inspect and manage suspected infestation with a local agriculture specialist.' };
const units = { rainfall: 'mm', temperature: '°C', humidity: '%', solar: 'MJ/m²/day', wind: 'm/s' };
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const predictionMinDate = () => `${new Date().getFullYear()}-01-01`;
const addDays = (date, count) => new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
const icon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border:4px solid white;border-radius:50%;background:#16804b;box-shadow:0 1px 7px #173a2c88"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
function MapClick({ onPick }) { useMapEvents({ click: (event) => onPick([event.latlng.lat, event.latlng.lng]) }); return null; }

function MonthlyChart({ climate, feature, featureNames, locale }) {
  const rows = climate?.monthly || [];
  const values = rows.map((row) => Number(row.values?.[feature] ?? 0));
  const max = Math.max(...values, 0.01);
  const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2023, index, 1).toLocaleDateString(locale, { month: 'short' }));
  return <div className="monthly-chart" role="img" aria-label={`${featureNames[feature]} monthly values`}>
    {rows.map((row, index) => <div className="monthly-column" key={row.label || index} title={`${row.label || monthNames[(row.month || index + 1) - 1]} (${row.days} days): ${values[index].toFixed(2)} ${units[feature]}`}>
      <span className="monthly-value">{values[index].toFixed(feature === 'humidity' ? 0 : 1)}</span><div className="monthly-bar-track"><div className="monthly-bar" style={{ height: `${Math.max(4, values[index] / max * 100)}%` }} /></div>
      <span className="monthly-label">{monthNames[(row.month || index + 1) - 1]}</span>
    </div>)}
  </div>;
}
function WeatherChart({ climate, labels, locale }) {
  return <div className="weather-chart-grid">{Object.keys(labels).map((feature) => <article className="weather-chart-card" key={feature}><div className="section-head"><strong>{labels[feature]}</strong><small>{units[feature]}</small></div><MonthlyChart climate={climate} feature={feature} featureNames={labels} locale={locale} /></article>)}</div>;
}
export default function PredictionPage() {
  const { t, i18n } = useTranslation();
  const featureLabels = { rainfall: t('Rainfall'), temperature: t('Temperature'), humidity: t('Relative humidity'), solar: t('Solar radiation'), wind: t('Wind speed') };
  const locale = ({ en: 'en-US', tl: 'fil-PH', ceb: 'ceb-PH', hil: 'hil-PH', krj: 'krj-PH', cyo: 'fil-PH' })[i18n.resolvedLanguage] || 'en-US';
  const [step, setStep] = useState(1);
  const [startDate, setStartDate] = useState(localToday);
  const [pin, setPin] = useState(savedPalawanPin);
  const [climate, setClimate] = useState(null);
  const [loadingClimate, setLoadingClimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const location = useMemo(() => ({ lat: Number(pin[0].toFixed(5)), lng: Number(pin[1].toFixed(5)), name: 'Palawan, Philippines' }), [pin]);
  const endDate = startDate ? addDays(startDate, 364) : '';
  const dates = useMemo(() => ({ startDate, endDate }), [startDate, endDate]);
  const annual = climate?.weather || {};

  useEffect(() => { localStorage.setItem('weeware-location', JSON.stringify(location)); }, [location]);
  function pick(point) { if (!isPalawanCoordinate(point)) { setError(t('Select a pin within the supported Palawan map extent.')); return; } setPin(point); setClimate(null); setPrediction(null); setError(''); }
  async function extractWeather() {
    if (!startDate || loadingClimate) return;
    setLoadingClimate(true); setClimate(null); setPrediction(null); setError('');
    try {
      const { data } = await api.get('/climate/window', { params: { start_date: dates.startDate, end_date: dates.endDate, lat: location.lat, lng: location.lng } });
      setClimate(data); setStep(3);
    } catch (err) { setError(err.response?.data?.message || err.message); }
    finally { setLoadingClimate(false); }
  }
  async function generate() {
    if (!climate || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const { data } = await api.post('/predictions', { ...dates, location });
      setPrediction(data.prediction); setStep(4);
    } catch (err) { setError(err.response?.data?.message || err.message); }
    finally { setBusy(false); }
  }
  async function save() { try { await api.post(`/predictions/${prediction._id}/save`, { title: prediction.title }); setSaved(true); } catch (err) { setError(err.response?.data?.message || err.message); } }

  return <div className="page prediction-page">
    <h1 className="page-title prediction-heading">{t('Annual infestation prediction')}</h1>
    <p className="page-subtitle prediction-description">{t('Choose a location and any available start date. WeeWare extracts the following 365 days of climate data before forecasting with LASSO.')}</p>
    <nav className="prediction-stepper" aria-label={t('Prediction steps')}>{['Location', 'Date window', 'Weather', 'Result'].map((label, index) => <div className={`prediction-stepper-item ${step === index + 1 ? 'active' : ''} ${step > index + 1 ? 'complete' : ''}`} key={label}><span>{step > index + 1 ? '✓' : index + 1}</span><small>{t(label)}</small></div>)}</nav>

    {step === 1 && <section className="prediction-step-card card"><div className="prediction-step-title"><span>1</span><div><h2>{t('Pin the forecast location')}</h2></div></div>
      <div className="pin-readout"><strong>{t('Palawan location')}</strong><span>{location.lat.toFixed(5)}° N, {location.lng.toFixed(5)}° E</span></div>
      <p className="muted">{t('Click anywhere on the Palawan map or drag the pin. These coordinates determine the weather data and prediction location.')}</p>
      <div className="prediction-map"><MapContainer center={center} zoom={6} minZoom={5} maxZoom={20} scrollWheelZoom className="prediction-map-canvas"><PalawanMangoAreas t={t} /><FitPalawanExtent /><MapClick onPick={pick} /><Marker position={pin} icon={icon} draggable eventHandlers={{ dragend: (event) => { const point = event.target.getLatLng(); pick([point.lat, point.lng]); } }}><Tooltip permanent direction="top" offset={[0, -10]}>{t('Selected mango farm location')}</Tooltip><Popup>{t('Selected mango farm location')}<br />{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</Popup></Marker></MapContainer></div>
      {error && <p className="error">{error}</p>}<div className="prediction-navigation"><button className="button" onClick={() => { setError(''); setStep(2); }}>{t('Next: choose dates')}</button></div>
    </section>}

    {step === 2 && <section className="prediction-step-card card"><div className="prediction-step-title"><span>2</span><div><h2>{t('Choose the start date')}</h2></div></div>
      <div className="prediction-controls"><div className="field date-picker-field"><span>{t('Start date')}</span><DatePicker value={startDate} min={predictionMinDate()} showJanuary onChange={(date) => { setStartDate(date); setClimate(null); setError(''); }} /></div>
        <div className="field date-end-field"><span>{t('Forecast end date')}</span><div className="date-end-shell" aria-live="polite"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg><strong>{endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : t('Select a start date')}</strong></div></div></div>
      {loadingClimate && <div className="weather-loading" role="status" aria-live="polite"><div className="weather-loading-sheen" /><div className="weather-loading-icon"><span/><span/><span/></div><div className="weather-loading-copy"><strong>{t('Reading the climate window')}</strong><span>{t('Extracting CMIP6 variables for {{start}} through {{end}}', { start: startDate, end: endDate })}</span><small>{location.lat.toFixed(4)}° N, {location.lng.toFixed(4)}° E <i/> {t('365 daily values')} <i/> {t('5 weather variables')}</small></div><div className="weather-loading-track"><span/></div></div>}
      {error && <p className="error">{error}</p>}<div className="prediction-navigation"><button className="button secondary" onClick={() => setStep(1)}>{t('Back to location')}</button><button className="button" onClick={extractWeather} disabled={!startDate || loadingClimate}>{t('Next: extract weather')}</button></div>
    </section>}

    {step === 3 && <section className="prediction-step-card card"><div className="prediction-step-title"><span>3</span><div><h2>{t('Review extracted weather')}</h2><p className="muted">{dates.startDate} {t('through')} {dates.endDate} · {climate?.days || 365} {t('days')} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</p></div></div>
      {climate && <><div className="annual-feature-grid">{Object.entries(featureLabels).map(([key, label]) => <article className="annual-feature" key={key}><span>{label}</span><strong>{Number(annual[key]).toFixed(2)}</strong><small>{units[key]} · {t('365-day aggregate')}</small></article>)}</div><h3 className="window-monthly-title">{t('Monthly climate values within the selected window')}</h3><WeatherChart climate={climate} labels={featureLabels} locale={locale} /></>}
      {error && <p className="error">{error}</p>}<div className="prediction-navigation"><button className="button secondary" onClick={() => setStep(2)} disabled={busy}>{t('Change dates')}</button><button className="button" onClick={generate} disabled={!climate || busy}>{busy ? <><span className="inline-prediction-spinner" aria-hidden="true"/> {t('Calculating forecast…')}</> : t('Run prediction')}</button></div>
    </section>}

    {step === 4 && prediction && <section className="card prediction-result"><div className="prediction-step-title"><span>4</span><div><h2>{t('Prediction result and suggested action')}</h2><p className="muted">{dates.startDate} {t('through')} {dates.endDate} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</p></div></div>
      <div className="result-overview"><div><div className="result-rate">{Number(prediction.infestationRate).toFixed(2)}%</div><span className={`pill risk-${prediction.riskCategory?.toLowerCase()}`}>{t(prediction.riskCategory)} {t('risk')}</span><div className="severity-score"><strong>{prediction.severityScore ?? Math.max(1, Math.min(100, Math.round(Number(prediction.infestationRate) / (Number(prediction.modelInfo?.outputMax) || 5) * 100)))}/100</strong><span>{t('Relative infestation severity')}</span><small>{t('Scaled to the active model output range; this is not a field-measured percentage.')}</small></div></div><div><strong>{t('Estimated infestation rate for the selected period')}</strong><p>{t(prediction.actionKey || actionByRisk[prediction.riskCategory] || prediction.suggestedAction)}</p></div></div>
      <section className="prediction-findings recommendation-panel"><div className="section-head"><h3>{t('Suggested measurements')}</h3><span className="pill">{t('Based on the forecast risk')}</span></div><ul>{(prediction.measurementKeys || []).map((key) => <li key={key}>{t(key)}</li>)}</ul><p className="recommendation-caveat">{t('This forecast is a screening estimate. Inspect suspect fruit in the field and message the WeeWare DA account for local guidance.')}</p><div className="recommendation-sources"><strong>{t('Guidance sources')}</strong><a href="https://www.da.gov.ph/wp-content/uploads/2023/05/Philippine-Mango-Industry-Roadmap.pdf" target="_blank" rel="noreferrer">{t('Philippine Department of Agriculture mango industry roadmap')}</a><a href="https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/priority-pest-disease/mango-pulp-weevil" target="_blank" rel="noreferrer">{t('Mango pulp weevil monitoring guidance')}</a><a className="button secondary recommendation-contact" href="/app/messages">{t('Message the DA account')}</a></div></section>
      {error && <p className="error">{error}</p>}<div className="row"><button className="button secondary" onClick={save} disabled={saved}>{saved ? t('Saved to reports') : t('Save report')}</button><a className="button secondary" href={`/api/predictions/${prediction._id}/report`}>{t('Download PDF')}</a><a className="button secondary" href="/app/history">{t('Prediction history')}</a></div>
      <div className="prediction-navigation"><button className="button secondary" onClick={() => setStep(3)}>{t('Back to weather')}</button><button className="button" onClick={() => { setStep(1); setClimate(null); setPrediction(null); setStartDate(localToday()); }}>{t('Start a new prediction')}</button></div>
    </section>}
  </div>;
}
