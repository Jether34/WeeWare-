const PDFDocument = require('pdfkit');

const GREEN = '#17643d';
const DARK = '#18372a';
const MUTED = '#66786d';
const PALE = '#eff6f1';

function fmt(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : 'Not available';
}

function drawTable(doc, x, y, widths, rows, options = {}) {
  const headers = options.headers || [];
  const rowHeight = options.rowHeight || 23;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const render = (values, top, header = false) => {
    let left = x;
    values.forEach((value, index) => {
      const width = widths[index];
      doc.rect(left, top, width, rowHeight).fillAndStroke(header ? GREEN : '#ffffff', '#dce8df');
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 8.5).fillColor(header ? '#ffffff' : DARK);
      doc.text(String(value ?? 'Not available'), left + 6, top + 6, { width: width - 12, height: rowHeight - 9, lineBreak: false, ellipsis: true });
      left += width;
    });
  };
  if (headers.length) render(headers, y, true);
  rows.forEach((row, index) => render(row, y + rowHeight * (index + (headers.length ? 1 : 0))));
  return y + rowHeight * (rows.length + (headers.length ? 1 : 0));
}

function heading(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(20).fillColor(GREEN).text(title, 42, 34);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(subtitle, 42, 61, { width: 510 });
  doc.moveTo(42, 82).lineTo(553, 82).lineWidth(1).stroke('#dce8df');
}

function section(doc, title, y) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text(title, 42, y);
}

function note(doc, text, x, y, width, size = 8.5) {
  doc.font('Helvetica').fontSize(size).fillColor(MUTED).text(text, x, y, { width, lineGap: 3 });
  return doc.y;
}

function weatherRows(weather) {
  const labels = { rainfall: ['Rainfall', 'mm / year'], temperature: ['Temperature', '°C'], humidity: ['Relative humidity', '%'], solar: ['Solar radiation', 'MJ/m²/day'], wind: ['Wind speed', 'm/s'] };
  return Object.entries(labels).map(([key, [label, unit]]) => [label, fmt(weather?.[key]), unit]);
}

function drawMonthlyChart(doc, months, y) {
  const values = (months || []).slice(-12).map((month) => ({
    label: month.label || `${month.year || ''}-${String(month.month || '').padStart(2, '0')}`,
    rainfall: Number(month.values?.rainfall ?? month.rainfall),
    temperature: Number(month.values?.temperature ?? month.temperature),
  })).filter((month) => Number.isFinite(month.rainfall) || Number.isFinite(month.temperature));
  if (!values.length) {
    note(doc, 'Monthly climate readings were not retained for this prediction. The annual summary above is the available weather input.', 42, y + 8, 510);
    return;
  }
  const x = 58; const width = 477; const top = y + 25; const height = 126;
  doc.rect(x, top, width, height).fillAndStroke('#fbfdfb', '#dce8df');
  const maxRain = Math.max(1, ...values.map((item) => item.rainfall || 0));
  const temperatures = values.map((item) => item.temperature).filter(Number.isFinite);
  const minTemp = Math.min(...temperatures, 0); const maxTemp = Math.max(...temperatures, minTemp + 1);
  const xPoint = (index) => x + 18 + index * ((width - 36) / Math.max(1, values.length - 1));
  values.forEach((item, index) => {
    if (Number.isFinite(item.rainfall)) {
      const barH = (item.rainfall / maxRain) * 76;
      doc.rect(xPoint(index) - 5, top + 94 - barH, 10, barH).fill('#73b9ce');
    }
    doc.fontSize(6).fillColor(MUTED).text(item.label.slice(-2), xPoint(index) - 8, top + 101, { width: 16, align: 'center' });
  });
  const tempPoints = values.map((item, index) => Number.isFinite(item.temperature) ? [xPoint(index), top + 80 - ((item.temperature - minTemp) / (maxTemp - minTemp)) * 58] : null).filter(Boolean);
  if (tempPoints.length > 1) {
    doc.moveTo(tempPoints[0][0], tempPoints[0][1]);
    tempPoints.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
    doc.lineWidth(2).stroke('#dc8a45');
    tempPoints.forEach(([px, py]) => doc.circle(px, py, 2.2).fill('#dc8a45'));
  }
  doc.fontSize(7.5).fillColor(DARK).text('Monthly rainfall', 72, top + 8);
  doc.rect(58, top + 9, 8, 6).fill('#73b9ce');
  doc.fontSize(7.5).fillColor(DARK).text('Monthly temperature', 180, top + 8);
  doc.moveTo(165, top + 12).lineTo(176, top + 12).lineWidth(2).stroke('#dc8a45');
  note(doc, 'Bars use the left scale relative to the wettest month; the orange line uses the right scale for temperature. Month labels are shown in order. Values are climate-model inputs, not monthly infestation forecasts.', 42, top + height + 9, 510, 8);
}

function createPredictionPdfReport(item, res) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="weeware-prediction-${item.year}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
  doc.on('error', (error) => { console.error('[prediction] PDF generation failed:', error); if (!res.headersSent) res.status(500).end(); else res.destroy(error); });
  doc.pipe(res);
  const location = item.location?.name || 'Pinned Palawan location';
  const start = item.startDate?.toISOString?.().slice(0, 10) || 'Not available';
  const end = item.endDate?.toISOString?.().slice(0, 10) || 'Not available';
  const thresholds = item.modelInfo?.riskThresholds || { low: 33, high: 66 };
  const outputMin = Number(item.modelInfo?.outputMin ?? 0);
  const outputMax = Number(item.modelInfo?.outputMax ?? 100);
  const rate = Number(item.infestationRate) || 0;
  const span = Math.max(1, outputMax - outputMin);
  const lowX = 58 + 475 * Math.max(0, Math.min(1, (Number(thresholds.low) - outputMin) / span));
  const highX = 58 + 475 * Math.max(0, Math.min(1, (Number(thresholds.high) - outputMin) / span));
  const valueX = 58 + 475 * Math.max(0, Math.min(1, (rate - outputMin) / span));

  heading(doc, 'WeeWare prediction report', 'Annual model estimate with input data, interpretation, and model-validation context');
  section(doc, 'Prediction summary', 100);
  const metaEnd = drawTable(doc, 42, 121, [110, 155, 95, 151], [
    ['Location', location, 'Forecast window', `${start} to ${end}`],
    ['Generated', item.createdAt?.toISOString?.().slice(0, 10) || 'Not available', 'Model', item.modelInfo?.type || 'LASSO Regression'],
    ['Model training period', item.modelInfo?.trainingPeriod || 'Not available', 'Training records', item.modelInfo?.samples ?? 'Not available'],
  ], { headers: ['Field', 'Details', 'Field', 'Details'], rowHeight: 25 });
  doc.roundedRect(42, metaEnd + 16, 511, 83, 10).fill(PALE);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Estimated infestation rate', 58, metaEnd + 28);
  doc.font('Helvetica-Bold').fontSize(24).fillColor(DARK).text(`${fmt(rate)}%`, 58, metaEnd + 43);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(item.riskCategory === 'High' ? '#a43b32' : item.riskCategory === 'Medium' ? '#a56b13' : GREEN).text(`${item.riskCategory || 'Unclassified'} risk`, 188, metaEnd + 51);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Model estimate; not a farm-level count or diagnosis.', 188, metaEnd + 70);

  let y = metaEnd + 117;
  section(doc, 'How to read the rate and risk band', y);
  const barY = y + 24; const barX = 58; const barW = 475;
  doc.roundedRect(barX, barY, barW, 17, 5).fill('#e8eee9');
  if (lowX > barX) doc.rect(barX, barY, lowX - barX, 17).fill('#64a97b');
  if (highX > lowX) doc.rect(lowX, barY, highX - lowX, 17).fill('#e7bd60');
  if (barX + barW > highX) doc.rect(highX, barY, barX + barW - highX, 17).fill('#d47b70');
  doc.circle(valueX, barY + 8.5, 5).fill(DARK);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`${outputMin}%`, barX, barY + 23);
  doc.text(`Low < ${fmt(thresholds.low)}%`, barX + 3, barY + 42, { width: lowX - barX - 6, align: 'center' });
  doc.text(`Medium ${fmt(thresholds.low)}–<${fmt(thresholds.high)}%`, lowX + 3, barY + 42, { width: highX - lowX - 6, align: 'center' });
  doc.text(`High ≥ ${fmt(thresholds.high)}%`, highX + 3, barY + 42, { width: barX + barW - highX - 6, align: 'center' });
  doc.text(`${outputMax}%`, barX + barW - 22, barY + 23);
  y = barY + 73;
  y = note(doc, `The rate is the model's estimated infestation percentage, bounded to ${outputMin}–${outputMax}%. Risk labels are assigned from the configured cutoffs above. They are categories of the numeric estimate, not separate observations of fruit or insects.`, 42, y, 511) + 12;

  section(doc, 'Annual weather values used by the model', y);
  const weatherEnd = drawTable(doc, 42, y + 20, [195, 160, 156], weatherRows(item.weather), { headers: ['Input', 'Value', 'Unit'], rowHeight: 22 });
  y = weatherEnd + 15;
  section(doc, 'Climate reading sources', y);
  const sources = Object.entries(item.weatherSources || {}).map(([key, value]) => [key, typeof value === 'object' ? (value.source || value.name || JSON.stringify(value)) : String(value)]);
  if (sources.length) drawTable(doc, 42, y + 20, [175, 336], sources.slice(0, 6), { headers: ['Weather input', 'Source'], rowHeight: 21 });
  else note(doc, `Climate data were assembled from ${item.modelInfo?.sourceDays ?? 'the available'} daily source records. Source details were not retained for this prediction.`, 42, y + 20, 511);

  doc.addPage();
  heading(doc, 'Climate pattern and model performance', 'The panels below separate weather inputs from historical model validation');
  section(doc, 'Monthly climate inputs', 101);
  drawMonthlyChart(doc, item.weatherMonthly, 115);
  const chartBottom = 115 + 25 + 126 + 34;
  section(doc, 'Historical validation of the active model', chartBottom);
  const validation = item.modelInfo?.validation || {};
  const validationRows = [
    ['Leave-one-year-out MAE', `${fmt(validation.mae)} percentage points`, 'Mean-baseline MAE', `${fmt(validation.baseline_mae)} percentage points`],
    ['Leave-one-year-out RMSE', `${fmt(validation.rmse)} percentage points`, 'Mean-baseline RMSE', `${fmt(validation.baseline_rmse)} percentage points`],
    ['Training MAE', `${fmt(item.modelInfo?.trainingMae)} percentage points`, 'Training RMSE', `${fmt(item.modelInfo?.trainingRmse)} percentage points`],
  ];
  const validationEnd = drawTable(doc, 42, chartBottom + 21, [133, 122, 133, 123], validationRows, { headers: ['Measure', 'LASSO model', 'Reference', 'Reference value'], rowHeight: 25 });
  let explanationY = validationEnd + 13;
  explanationY = note(doc, 'MAE (mean absolute error) is the average size of the prediction errors. RMSE (root mean squared error) also measures typical error but penalizes large misses more. Both are in percentage points; lower is better. The baseline predicts a training-set average. These are historical backtest results for the model overall, not accuracy or certainty for this individual forecast.', 42, explanationY, 511, 8.5) + 12;
  section(doc, 'Findings, limitations, and recommended use', explanationY);
  explanationY += 20;
  explanationY = note(doc, `The model uses climate predictors and historical infestation-rate records. It does not directly detect mango pulp weevils, fruit damage, or the number of affected trees. A large error in the historical validation means forecast values may differ from field observations. The estimate can also be affected by missing or imprecise weather readings, changes in orchard management, pest pressure, and differences between the training locations and the selected location.`, 42, explanationY, 511, 8.5) + 12;
  explanationY = note(doc, `Suggested action: ${item.suggestedAction || 'Use the estimate to guide monitoring and confirm conditions through field inspection.'}`, 42, explanationY, 511, 8.5) + 12;
  note(doc, `Model notes: ${item.modelInfo?.confidenceNote || 'No calibrated confidence interval is available.'} WeeWare does not calculate a calibrated probability interval for this prediction. Treat the output as a planning aid and verify it with local field observations.`, 42, explanationY, 511, 8.5);

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`WeeWare · Prediction report · ${index + 1} of ${range.count}`, 42, 780, { width: 511, align: 'center', lineBreak: false });
  }
  doc.end();
}

module.exports = createPredictionPdfReport;
