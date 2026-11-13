const PDFDocument = require('pdfkit');

function drawTable(doc, { x, y, width, headers, rows, widths, rowHeight = 20, fontSize = 8 }) {
  const proportions = widths || headers.map(() => 1);
  const scale = width / proportions.reduce((sum, value) => sum + value, 0);
  const columnWidths = proportions.map((value) => value * scale);
  const drawRow = (values, top, header = false) => {
    let left = x;
    values.forEach((value, index) => {
      const cellWidth = columnWidths[index];
      doc.rect(left, top, cellWidth, rowHeight).fillAndStroke(header ? '#17643d' : '#ffffff', header ? '#17643d' : '#dce8df');
      doc.fillColor(header ? '#ffffff' : '#24352d').fontSize(header ? fontSize : fontSize - 0.2).font(header ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(String(value ?? ''), left + 4, top + 5, { width: Math.max(8, cellWidth - 8), height: rowHeight - 7, lineBreak: false, ellipsis: true });
      left += cellWidth;
    });
  };
  if (headers.length) drawRow(headers, y, true);
  rows.forEach((row, index) => drawRow(row, y + rowHeight * (index + (headers.length ? 1 : 0)), false));
  return y + rowHeight * (rows.length + (headers.length ? 1 : 0));
}

function drawScatter3d(doc, result, x, y, width, height) {
  const rows = result.predictions;
  const maximumRate = Math.max(1, ...rows.flatMap((row) => [Number(row.actual) || 0, Number(row.predicted) || 0])) * 1.12;
  const maximumError = Math.max(0.001, ...rows.map((row) => Number(row.absolute_error) || 0));
  const origin = { x: x + 28, y: y + height - 28 };
  const observedAxis = { x: width * 0.55, y: 0 };
  const predictedAxis = { x: width * 0.23, y: -height * 0.28 };
  const errorAxis = { x: 0, y: -height * 0.53 };
  const project = (observed, predicted, error) => ({
    x: origin.x + observedAxis.x * observed / maximumRate + predictedAxis.x * predicted / maximumRate,
    y: origin.y + observedAxis.y * observed / maximumRate + predictedAxis.y * predicted / maximumRate + errorAxis.y * error / maximumError,
  });
  const observedEnd = { x: origin.x + observedAxis.x, y: origin.y };
  const predictedEnd = { x: origin.x + predictedAxis.x, y: origin.y + predictedAxis.y };
  const farCorner = { x: observedEnd.x + predictedAxis.x, y: observedEnd.y + predictedAxis.y };
  const errorEnd = { x: origin.x, y: origin.y + errorAxis.y };
  doc.save().lineWidth(0.8).strokeColor('#8da196');
  [[origin, observedEnd], [origin, predictedEnd], [observedEnd, farCorner], [predictedEnd, farCorner], [origin, errorEnd]].forEach(([start, end]) => doc.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke());
  doc.strokeColor('#cfdbd2').lineWidth(0.45);
  [0.5, 1].forEach((fraction) => {
    const start = { x: origin.x + observedAxis.x * fraction, y: origin.y };
    const end = { x: start.x + predictedAxis.x, y: start.y + predictedAxis.y };
    doc.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke();
  });
  const idealEnd = project(maximumRate / 2, maximumRate / 2, 0);
  doc.dash(3, { space: 2 }).strokeColor('#bd8a45').lineWidth(1.2).moveTo(origin.x, origin.y).lineTo(idealEnd.x, idealEnd.y).stroke().undash();
  const colors = { Low: '#268654', Medium: '#df9b31', High: '#ce5f52' };
  rows.forEach((row) => {
    const point = project(Number(row.actual) || 0, Number(row.predicted) || 0, Number(row.absolute_error) || 0);
    doc.circle(point.x, point.y, 2.7).fillColor(colors[row.actual_risk] || '#17643d').fill();
  });
  doc.fillColor('#51645a').font('Helvetica').fontSize(7);
  doc.text(`Observed rate (%) 0-${maximumRate.toFixed(1)}`, observedEnd.x - 92, observedEnd.y + 8, { width: 120 });
  doc.text('Predicted rate (%)', predictedEnd.x - 2, predictedEnd.y - 14, { width: 105 });
  doc.text(`Absolute error (0-${maximumError.toFixed(2)} pp)`, errorEnd.x - 4, errorEnd.y - 16, { width: 125 });
  const legendX = x + width - 124;
  const legendY = y + 20;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#234c38').text('Legend', legendX, legendY);
  [['Low risk (actual)', colors.Low], ['Medium risk (actual)', colors.Medium], ['High risk (actual)', colors.High]].forEach(([label, color], index) => {
    const rowY = legendY + 16 + index * 15;
    doc.circle(legendX + 4, rowY + 4, 3).fillColor(color).fill();
    doc.font('Helvetica').fontSize(7).fillColor('#41564a').text(label, legendX + 13, rowY, { width: 110 });
  });
  const idealY = legendY + 66;
  doc.dash(3, { space: 2 }).strokeColor('#bd8a45').moveTo(legendX, idealY + 4).lineTo(legendX + 15, idealY + 4).stroke().undash();
  doc.font('Helvetica').fontSize(7).fillColor('#41564a').text('Perfect match (error = 0)', legendX + 19, idealY, { width: 112 });
  doc.fontSize(6.5).fillColor('#708077').text('Vertical position encodes absolute error; point color is the actual risk band.', legendX, idealY + 18, { width: 122, lineGap: 2 });
  doc.restore();
}

function createWekaPdf(req, res) {
  const result = req.body || {};
  const risk = result.risk_evaluation;
  if (!Array.isArray(result.predictions) || !risk || !Array.isArray(risk.labels) || !Array.isArray(risk.matrix)) {
    return res.status(400).json({ success: false, message: 'A completed Weka evaluation is required.' });
  }
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="weka-analysis-report.pdf"');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    doc.on('error', (error) => { console.error('[ml] Weka PDF generation failed:', error); if (!res.headersSent) res.status(500).end(); else res.destroy(error); });
    doc.pipe(res);
    const pageWidth = 842;
    const margin = 36;
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#145a3b').text('Weka evaluation report', margin, 28);
    doc.font('Helvetica').fontSize(8).fillColor('#708077').text('WEKA RESEARCH WORKSPACE  |  CROSS-VALIDATION SUMMARY', margin, 53);
    const metadataRows = [
      ['Dataset', result.filename || '—', 'Algorithm', result.algorithm_label || result.algorithm || '—'],
      ['Validation', `${result.validation || 'Random-fold cross-validation'} · ${result.folds || '—'} folds`, 'Rows / features', `${result.rows || result.predictions.length} rows · ${(result.features || []).join(', ')}`],
    ];
    drawTable(doc, { x: margin, y: 72, width: pageWidth - margin * 2, headers: ['Property', 'Value', 'Property', 'Value'], rows: metadataRows, widths: [1.15, 3.05, 1.15, 3.05], rowHeight: 21, fontSize: 8 });

    const metrics = result.metrics || {};
    const accuracy = `${(Number(risk.accuracy || 0) * 100).toFixed(1)}%`;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#234c38').text('Evaluation metrics', margin, 143);
    drawTable(doc, { x: margin, y: 159, width: pageWidth - margin * 2, headers: ['Mean absolute error (pp)', 'Root mean squared error (pp)', 'Correlation', 'Risk-band accuracy'], rows: [[Number(metrics.mae || 0).toFixed(3), Number(metrics.rmse || 0).toFixed(3), Number(metrics.correlation || 0).toFixed(3), accuracy]], widths: [1, 1, 1, 1], rowHeight: 24, fontSize: 8 });

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#234c38').text('Observed vs. predicted infestation rate: 3D view', margin, 203);
    drawScatter3d(doc, result, margin, 216, 510, 204);
    doc.font('Helvetica').fontSize(7).fillColor('#708077').text('Axes show observed rate, cross-validated predicted rate, and absolute prediction error.', margin, 421);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#234c38').text('Risk-band confusion matrix', margin, 444);
    const thresholds = risk.thresholds || {};
    doc.font('Helvetica').fontSize(7).fillColor('#708077').text(`Actual bands are rows; predicted bands are columns. Low < ${thresholds.low ?? '—'}%; Medium < ${thresholds.high ?? '—'}%; High otherwise.`, margin, 458);
    const matrixRows = risk.labels.map((label, index) => [label, ...(risk.matrix[index] || [])]);
    drawTable(doc, { x: margin, y: 472, width: 285, headers: ['Actual / Predicted', ...risk.labels], rows: matrixRows, widths: [1.75, 0.7, 0.7, 0.7], rowHeight: 20, fontSize: 7.5 });
    const classRows = (risk.per_class || []).map((item) => [item.name, item.support, Number(item.precision).toFixed(3), Number(item.recall).toFixed(3), Number(item.f1).toFixed(3)]);
    drawTable(doc, { x: 340, y: 472, width: pageWidth - margin - 340, headers: ['Risk band', 'Support', 'Precision', 'Recall', 'F1'], rows: classRows, widths: [1.25, 0.8, 1, 1, 0.8], rowHeight: 20, fontSize: 7.5 });
    doc.font('Helvetica').fontSize(6.5).fillColor('#708077').text(result.note || '', margin, 562, { width: pageWidth - margin * 2, height: 20, ellipsis: true });

    const drawPredictionHeader = (continued = false) => {
      if (continued) doc.addPage({ size: 'A4', layout: 'landscape', margin });
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#145a3b').text('Cross-validation prediction table', margin, 28);
      doc.font('Helvetica').fontSize(8).fillColor('#708077').text(`${result.filename || 'Dataset'} · ${result.algorithm_label || result.algorithm || 'Weka'} · ${result.predictions.length} held-out rows`, margin, 51);
      return drawTable(doc, { x: margin, y: 70, width: pageWidth - margin * 2, headers: ['CV row', 'Observed rate (%)', 'Predicted rate (%)', 'Absolute error (pp)', 'Actual risk', 'Predicted risk'], rows: [], widths: [0.65, 1.35, 1.35, 1.35, 1.15, 1.15], rowHeight: 20, fontSize: 8 });
    };
    doc.addPage({ size: 'A4', layout: 'landscape', margin });
    let tableY = drawPredictionHeader();
    const rowHeight = 18;
    result.predictions.forEach((item) => {
      if (tableY + rowHeight > 555) tableY = drawPredictionHeader(true);
      tableY = drawTable(doc, {
        x: margin, y: tableY, width: pageWidth - margin * 2,
        headers: [], rows: [[item.row, Number(item.actual).toFixed(3), Number(item.predicted).toFixed(3), Number(item.absolute_error).toFixed(3), item.actual_risk, item.predicted_risk]],
        widths: [0.65, 1.35, 1.35, 1.35, 1.15, 1.15], rowHeight, fontSize: 8,
      });
    });
    doc.end();
  } catch (error) {
    console.error('[ml] Weka PDF export failed:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Could not generate the Weka PDF report.' });
    return res.end();
  }
}

module.exports = createWekaPdf;
