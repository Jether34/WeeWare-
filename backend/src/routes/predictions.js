const express = require('express');
const PDFDocument = require('pdfkit');
const Prediction = require('../models/Prediction');
const SavedPrediction = require('../models/SavedPrediction');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { trackedFetch } = require('../services/traffic');
const router = express.Router();
const PALAWAN_PREDICTION_EXTENT = Object.freeze({ minLat: 7, maxLat: 12.9, minLng: 116, maxLng: 121 });

function isPalawanPredictionLocation(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const extent = PALAWAN_PREDICTION_EXTENT;
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= extent.minLat && lat <= extent.maxLat
    && lng >= extent.minLng && lng <= extent.maxLng;
}

function validateAnnualForecast(body) {
  const start = body.startDate;
  const end = body.endDate;
  if (typeof start !== 'string' || typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return 'Choose a valid start and end date for the 365-day prediction window.';
  }
  const startDay = Date.parse(`${start}T00:00:00Z`);
  const endDay = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || new Date(startDay).toISOString().slice(0, 10) !== start || new Date(endDay).toISOString().slice(0, 10) !== end || endDay - startDay !== 364 * 86400000) {
    return 'The prediction window must contain exactly 365 days; choose an end date 364 days after the start date.';
  }
  const now = new Date();
  const earliest = `${now.getFullYear()}-01-01`;
  if (start < earliest) return 'Choose a start date from January 1 of the current year onward.';
  if (!isPalawanPredictionLocation(body.location)) {
    return 'Select a pinned location within the supported Palawan map extent.';
  }
  return null;
}

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const rows = await Prediction.find({ user: req.user.sub }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, predictions: rows });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const validationError = validateAnnualForecast(req.body);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const payload = { start_date: req.body.startDate, end_date: req.body.endDate, year: req.body.year, lat: req.body.location?.lat, lng: req.body.location?.lng };
    const response = await trackedFetch(`${env.mlServiceUrl}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, message: result.detail || 'Prediction could not be generated.' });
    const prediction = await Prediction.create({
      user: req.user.sub,
      title: req.body.title || `${result.location?.name || 'Puerto Princesa'} · ${result.start_date}`,
      startDate: result.start_date,
      endDate: result.end_date,
      year: new Date(result.start_date).getUTCFullYear(),
      location: result.location,
      weather: result.weather,
      weatherSources: result.weather_sources,
      infestationRate: result.rate,
      rawRate: result.raw_rate,
      confidenceLevel: result.confidence,
      riskCategory: result.risk,
      suggestedAction: result.action,
      severityScore: result.severity_score,
      actionKey: result.action_key,
      measurementKeys: result.measurement_keys,
      modelInfo: { type: result.model_type, trainingPeriod: result.training_period, sourceDays: result.source_days, confidenceNote: result.confidence_note, outputMin: result.output_min, outputMax: result.output_max },
    });
    res.status(201).json({ success: true, prediction });
  } catch (error) { next(error); }
});

router.post('/:id/save', async (req, res, next) => {
  try {
    const prediction = await Prediction.findOne({ _id: req.params.id, user: req.user.sub });
    if (!prediction) return res.status(404).json({ success: false, message: 'Prediction not found.' });
    const saved = await SavedPrediction.findOneAndUpdate(
      { user: req.user.sub, prediction: prediction._id },
      { $setOnInsert: { title: req.body.title || prediction.title, description: req.body.description || '' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    prediction.isSaved = true;
    await prediction.save();
    res.status(201).json({ success: true, savedPrediction: saved });
  } catch (error) { next(error); }
});

router.get('/:id/report', async (req, res, next) => {
  try {
    const item = await Prediction.findOne({ _id: req.params.id, user: req.user.sub });
    if (!item) return res.status(404).json({ success: false, message: 'Prediction not found.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="weeware-prediction-${item.year}.pdf"`);
    const pdf = new PDFDocument({ margin: 48 });
    pdf.pipe(res);
    pdf.fontSize(22).fillColor('#155b3b').text('WeeWare Prediction Report');
    pdf.moveDown().fontSize(11).fillColor('#222').text(`Location: ${item.location?.name || 'Puerto Princesa, Palawan'}`);
    pdf.text(`Prediction window: ${item.startDate.toISOString().slice(0, 10)} to ${item.endDate.toISOString().slice(0, 10)}`);
    pdf.text(`Generated: ${item.createdAt.toISOString().slice(0, 10)}`).moveDown();
    pdf.fontSize(16).text(`Estimated infestation: ${item.infestationRate}% (${item.riskCategory} risk)`);
    if (Number.isFinite(item.confidenceLevel)) pdf.fontSize(11).text(`Confidence: ${item.confidenceLevel}%`).moveDown();
    const chartX = 48; const chartY = pdf.y + 12; const chartW = 500; const chartH = 22;
    const rate = Math.max(0, Math.min(100, Number(item.infestationRate) || 0));
    pdf.fontSize(10).fillColor('#33483a').text('Prediction result (%)', chartX, chartY - 2);
    pdf.roundedRect(chartX, chartY + 16, chartW, chartH, 5).fill('#edf2ee');
    pdf.roundedRect(chartX, chartY + 16, Math.max(4, chartW * rate / 100), chartH, 5).fill(item.riskCategory === 'High' ? '#bd5144' : item.riskCategory === 'Medium' ? '#d5a038' : '#3f9863');
    for (const threshold of [33, 66]) {
      const x = chartX + chartW * threshold / 100;
      pdf.moveTo(x, chartY + 10).lineTo(x, chartY + 43).lineWidth(1).stroke('#596c60');
      pdf.fontSize(8).fillColor('#596c60').text(`${threshold}%`, x - 12, chartY + 43, { width: 28, align: 'center' });
    }
    pdf.fontSize(8).fillColor('#596c60').text('0%', chartX, chartY + 43).text('100%', chartX + chartW - 25, chartY + 43);
    pdf.y = chartY + 64;
    pdf.text('Weather values used:');
    Object.entries(item.weather || {}).forEach(([key, value]) => pdf.text(`${key}: ${value}`));
    pdf.moveDown().text(`Suggested action: ${item.suggestedAction || ''}`);
    pdf.end();
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const prediction = await Prediction.findOne({ _id: req.params.id, user: req.user.sub });
    if (!prediction) return res.status(404).json({ success: false, message: 'Prediction not found.' });
    res.json({ success: true, prediction });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await SavedPrediction.deleteMany({ prediction: req.params.id, user: req.user.sub });
    const result = await Prediction.findOneAndDelete({ _id: req.params.id, user: req.user.sub });
    if (!result) return res.status(404).json({ success: false, message: 'Prediction not found.' });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;

