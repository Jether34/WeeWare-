const express = require('express');
const env = require('../config/env');
const { trackedFetch } = require('../services/traffic');
const router = express.Router();

async function proxy(path, res) {
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}${path}`, { signal: AbortSignal.timeout(30_000) });
    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();
    let body;
    try {
      body = contentType.includes('application/json') ? JSON.parse(responseText) : null;
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object') {
      console.error(`[climate] ML service returned non-JSON response (${response.status}): ${responseText.slice(0, 300)}`);
      return res.status(response.ok ? 502 : response.status).json({
        success: false,
        message: response.ok ? 'Climate service returned an invalid response.' : 'Climate data extraction is temporarily unavailable. Please try again shortly.'
      });
    }
    res.status(response.status).json(body);
  } catch (error) {
    console.error('[climate] Climate service request failed:', error);
    res.status(503).json({ success: false, message: 'Climate service is unavailable. Please try again shortly.' });
  }
}

router.get('/years', (_req, res) => proxy('/climate/years', res));
router.get('/year/:year', (req, res) => proxy(`/climate/year/${encodeURIComponent(req.params.year)}`, res));
router.get('/window', (req, res) => {
  const query = new URLSearchParams();
  ['start_date', 'end_date', 'lat', 'lng'].forEach((key) => { if (req.query[key] != null) query.set(key, req.query[key]); });
  proxy(`/climate/window?${query.toString()}`, res);
});

module.exports = router;

