const express = require('express');
const multer = require('multer');
const path = require('path');
const PDFDocument = require('pdfkit');
const Prediction = require('../models/Prediction');
const env = require('../config/env');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { trackedFetch } = require('../services/traffic');

const router = express.Router();
const researcherAccess = [requireAuth, requireRoles('researcher', 'admin')];
const datasetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, ['.xlsx', '.csv'].includes(path.extname(file.originalname).toLowerCase())),
});

async function jsonResponse(response, res) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!body || typeof body !== 'object') return res.status(response.ok ? 502 : response.status).json({ success: false, message: 'The model service returned an invalid response.' });
  return res.status(response.status).json(body);
}

async function proxyJson(pathname, res, options = {}) {
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}${pathname}`, { signal: AbortSignal.timeout(options.timeout || 30_000), ...options.fetchOptions });
    return await jsonResponse(response, res);
  } catch (error) {
    console.error(`[ml] ${pathname} request failed:`, error);
    return res.status(503).json({ success: false, message: 'Model service is unavailable. Please try again shortly.' });
  }
}

router.get('/model-info', ...researcherAccess, (_req, res) => proxyJson('/model/info', res));
router.get('/train/status', ...researcherAccess, (_req, res) => proxyJson('/train/status', res));
router.get('/train/experiments', ...researcherAccess, (_req, res) => proxyJson('/train/experiments', res));
router.get('/weka/status', ...researcherAccess, (_req, res) => proxyJson('/weka/status', res));

router.get('/researcher/dashboard', ...researcherAccess, async (_req, res, next) => {
  try {
    const [modelResponse, statusResponse, experimentResponse, predictions] = await Promise.all([
      trackedFetch(`${env.mlServiceUrl}/model/info`, { signal: AbortSignal.timeout(20_000) }),
      trackedFetch(`${env.mlServiceUrl}/train/status`, { signal: AbortSignal.timeout(20_000) }),
      trackedFetch(`${env.mlServiceUrl}/train/experiments`, { signal: AbortSignal.timeout(20_000) }),
      Prediction.find({}).sort({ createdAt: -1 }).limit(20).select('createdAt year location infestationRate riskCategory modelInfo weather'),
    ]);
    const [modelInfo, training, experimentList] = await Promise.all([modelResponse.json(), statusResponse.json(), experimentResponse.json()]);
    res.json({ success: true, model: modelInfo, training, experiments: experimentList.experiments || [], predictions });
  } catch (error) { next(error); }
});

router.get('/train/template', ...researcherAccess, async (_req, res) => {
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/train/template`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return res.status(response.status).json({ success: false, message: 'Could not generate the training template.' });
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="weeware-lasso-training-template.xlsx"');
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[ml] template request failed:', error);
    res.status(503).json({ success: false, message: 'Model service is unavailable. Please try again shortly.' });
  }
});

async function sendDataset(req, res, endpoint) {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose an Excel workbook or CSV file first.' });
  let config;
  try { config = JSON.parse(req.body.modelConfig || '{}'); }
  catch { return res.status(400).json({ success: false, message: 'Model settings are invalid.' }); }
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': path.extname(req.file.originalname).toLowerCase() === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-Dataset-Name': encodeURIComponent(path.basename(req.file.originalname)),
        'X-Model-Config': JSON.stringify(config),
        'X-Researcher-Id': String(req.user.sub),
      },
      body: req.file.buffer,
      signal: AbortSignal.timeout(endpoint.endsWith('/train') ? 600_000 : 60_000),
    });
    return await jsonResponse(response, res);
  } catch (error) {
    console.error(`[ml] ${endpoint} upload failed:`, error);
    return res.status(503).json({ success: false, message: 'Model service is unavailable. The active model was not changed.' });
  }
}

router.post('/train/preview', ...researcherAccess, datasetUpload.single('dataset'), (req, res) => sendDataset(req, res, '/train/preview'));
router.post('/train', ...researcherAccess, datasetUpload.single('dataset'), (req, res) => sendDataset(req, res, '/train'));
router.post('/weka/analyze/palawan', ...researcherAccess, async (req, res) => {
  const options = req.body || {};
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/weka/analyze/palawan`, {
      method: 'POST',
      headers: {
        'X-Weka-Algorithm': String(options.algorithm || 'random_forest'),
        'X-Weka-Folds': String(options.folds || '5'),
        'X-Weka-Low-Threshold': String(options.lowThreshold || '33'),
        'X-Weka-High-Threshold': String(options.highThreshold || '66'),
      },
      signal: AbortSignal.timeout(240_000),
    });
    return await jsonResponse(response, res);
  } catch (error) {
    console.error('[ml] prepared Weka analysis failed:', error);
    return res.status(503).json({ success: false, message: 'Weka analysis service is unavailable. Please try again shortly.' });
  }
});
router.post('/weka/analyze', ...researcherAccess, datasetUpload.single('dataset'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose an Excel workbook or CSV file first.' });
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/weka/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': path.extname(req.file.originalname).toLowerCase() === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-Dataset-Name': encodeURIComponent(path.basename(req.file.originalname)),
        'X-Weka-Algorithm': String(req.body.algorithm || 'random_forest'),
        'X-Weka-Folds': String(req.body.folds || '5'),
        'X-Weka-Low-Threshold': String(req.body.lowThreshold || '33'),
        'X-Weka-High-Threshold': String(req.body.highThreshold || '66'),
      },
      body: req.file.buffer,
      signal: AbortSignal.timeout(240_000),
    });
    return await jsonResponse(response, res);
  } catch (error) {
    console.error('[ml] Weka analysis failed:', error);
    return res.status(503).json({ success: false, message: 'Weka analysis service is unavailable. Please try again shortly.' });
  }
});
router.post('/weka/export/xlsx', ...researcherAccess, async (req, res) => {
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/weka/export/xlsx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return await jsonResponse(response, res);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="weka-analysis-report.xlsx"');
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[ml] Weka Excel export failed:', error);
    return res.status(503).json({ success: false, message: 'Could not generate the Weka Excel report.' });
  }
});
router.post('/weka/export/pdf', ...researcherAccess, (req, res) => {
  const result = req.body || {};
  const risk = result.risk_evaluation;
  if (!Array.isArray(result.predictions) || !risk || !Array.isArray(risk.labels) || !Array.isArray(risk.matrix)) {
    return res.status(400).json({ success: false, message: 'A completed Weka evaluation is required.' });
  }
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="weka-analysis-report.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    doc.on('error', (error) => { console.error('[ml] Weka PDF generation failed:', error); if (!res.headersSent) res.status(500).end(); else res.destroy(error); });
    doc.pipe(res);
    const line = (label, value) => doc.fontSize(10).fillColor('#164f38').text(`${label}: `, { continued: true }).fillColor('#24352d').text(String(value ?? '—'));
    doc.fontSize(20).fillColor('#145a3b').text('Weka evaluation report');
    doc.moveDown(0.7);
    line('Dataset', result.filename);
    line('Algorithm', result.algorithm_label || result.algorithm);
    line('Weka version', result.version);
    line('Validation', `${result.validation || 'Random-fold cross-validation'} · ${result.folds || '—'} folds · ${result.rows || result.predictions.length} rows`);
    line('Features', Array.isArray(result.features) ? result.features.join(', ') : '—');
    doc.moveDown(0.6).fontSize(14).fillColor('#145a3b').text('Regression metrics');
    const metrics = result.metrics || {};
    line('MAE', metrics.mae);
    line('RMSE', metrics.rmse);
    line('Correlation', metrics.correlation);
    doc.moveDown(0.6).fontSize(14).fillColor('#145a3b').text('Risk-band confusion matrix');
    line('Accuracy', `${(Number(risk.accuracy || 0) * 100).toFixed(1)}%`);
    line('Thresholds', `Low < ${risk.thresholds?.low ?? '—'}%; Medium < ${risk.thresholds?.high ?? '—'}%; High otherwise`);
    const cell = 92;
    doc.moveDown(0.4).fontSize(9).fillColor('#24352d').text(`Actual / Predicted      ${risk.labels.join('                 ')}`);
    risk.labels.forEach((label, index) => doc.text(`${label.padEnd(20)}${(risk.matrix[index] || []).join('                         ')}`));
    doc.moveDown(0.7).fontSize(14).fillColor('#145a3b').text('Per-class scores');
    doc.fontSize(9).fillColor('#24352d').text('Risk band          Support          Precision          Recall          F1');
    (risk.per_class || []).forEach((item) => doc.text(`${String(item.name).padEnd(19)}${String(item.support).padEnd(17)}${Number(item.precision).toFixed(3).padEnd(19)}${Number(item.recall).toFixed(3).padEnd(16)}${Number(item.f1).toFixed(3)}`));
    doc.moveDown(0.7).fontSize(14).fillColor('#145a3b').text(`Cross-validation predictions (${result.predictions.length})`);
    doc.fontSize(8).fillColor('#24352d').text('Row       Observed %       Predicted %       Abs. error       Actual risk       Predicted risk');
    result.predictions.forEach((item) => {
      if (doc.y > 750) doc.addPage();
      doc.text(`${item.row}           ${Number(item.actual).toFixed(3)}             ${Number(item.predicted).toFixed(3)}                ${Number(item.absolute_error).toFixed(3)}              ${item.actual_risk}               ${item.predicted_risk}`);
    });
    doc.moveDown(0.8).fontSize(8).fillColor('#66776f').text(result.note || '');
    doc.end();
  } catch (error) {
    console.error('[ml] Weka PDF export failed:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Could not generate the Weka PDF report.' });
    return res.end();
  }
});
router.post('/train/palawan', ...researcherAccess, async (req, res) => {
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/train/palawan`, {
      method: 'POST', headers: { 'X-Researcher-Id': String(req.user.sub) },
      signal: AbortSignal.timeout(600_000),
    });
    return await jsonResponse(response, res);
  } catch (error) {
    console.error('[ml] prepared Palawan training failed:', error);
    return res.status(503).json({ success: false, message: 'Model service is unavailable. The active model was not changed.' });
  }
});

router.post('/train/experiments/:id/activate', ...researcherAccess, (req, res) => {
  if (!/^[a-f\d]{32}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid experiment ID.' });
  return proxyJson(`/train/experiments/${req.params.id}/activate`, res, { fetchOptions: { method: 'POST' }, timeout: 60_000 });
});

router.get('/train/experiments/:id/dataset', ...researcherAccess, async (req, res) => {
  if (!/^[a-f\d]{32}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid experiment ID.' });
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/train/experiments/${req.params.id}/dataset`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return jsonResponse(response, res);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const extension = (response.headers.get('content-type') || '').startsWith('text/csv') ? 'csv' : 'xlsx';
    res.setHeader('Content-Disposition', `attachment; filename="weeware-training-dataset.${extension}"`);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[ml] experiment dataset download failed:', error);
    res.status(503).json({ success: false, message: 'Model service is unavailable. Please try again shortly.' });
  }
});

router.delete('/train/experiments/:id', ...researcherAccess, (req, res) => {
  if (!/^[a-f\d]{32}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid experiment ID.' });
  return proxyJson(`/train/experiments/${req.params.id}`, res, { fetchOptions: { method: 'DELETE' }, timeout: 60_000 });
});

module.exports = router;
