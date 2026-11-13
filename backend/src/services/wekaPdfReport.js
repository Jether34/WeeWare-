const PDFDocument = require('pdfkit');

const PAGE_WIDTH = 842;
const MARGIN = 38;
const GREEN = '#17643d';
const DARK = '#1d392c';
const MUTED = '#607268';

function number(value, digits = 3) {
  if (value == null) return 'N/A';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : 'Not available';
}

function drawTable(doc, { x, y, width, headers, rows, widths, rowHeight = 20, fontSize = 8 }) {
  const proportions = widths || headers.map(() => 1);
  const scale = width / proportions.reduce((sum, value) => sum + value, 0);
  const columnWidths = proportions.map((value) => value * scale);
  const drawRow = (values, top, header = false) => {
    let left = x;
    values.forEach((value, index) => {
      const cellWidth = columnWidths[index];
      doc.rect(left, top, cellWidth, rowHeight).fillAndStroke(header ? GREEN : '#ffffff', header ? GREEN : '#dce8df');
      doc.fillColor(header ? '#ffffff' : DARK).fontSize(header ? fontSize : fontSize - 0.2).font(header ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(String(value ?? 'Not available'), left + 4, top + 4, { width: Math.max(8, cellWidth - 8), height: rowHeight - 6, lineBreak: !header, ellipsis: header });
      left += cellWidth;
    });
  };
  if (headers.length) drawRow(headers, y, true);
  rows.forEach((row, index) => drawRow(row, y + rowHeight * (index + (headers.length ? 1 : 0))));
  return y + rowHeight * (rows.length + (headers.length ? 1 : 0));
}

function sectionTitle(doc, text, xOrY, y = null) {
  const x = y === null ? MARGIN : xOrY;
  const top = y === null ? xOrY : y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#234c38').text(text, x, top);
}

function paragraph(doc, text, x, y, width, options = {}) {
  const fontSize = options.fontSize || 8.5;
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(options.color || DARK);
  const height = doc.heightOfString(text, { width, lineGap: options.lineGap ?? 2 });
  doc.text(text, x, y, { width, lineGap: options.lineGap ?? 2 });
  return y + height;
}

function pageHeader(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#145a3b').text(title, MARGIN, 26);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(subtitle, MARGIN, 50);
}

function drawConfusionTables(doc, result) {
  const risk = result.risk_evaluation;
  const matrixRows = risk.labels.map((label, index) => [label, ...(risk.matrix[index] || [])]);
  const classRows = (risk.per_class || []).map((item) => [item.name, item.support, item.predicted_count ?? 0, number(item.precision), number(item.recall), number(item.f1)]);
  drawTable(doc, { x: MARGIN, y: 499, width: 290, headers: ['Actual / predicted', ...risk.labels], rows: matrixRows, widths: [1.8, 0.65, 0.65, 0.65], rowHeight: 18, fontSize: 7.2 });
  classRows.push(['Macro average', 'â€”', 'â€”', number(risk.macro_precision), number(risk.macro_recall), number(risk.macro_f1)]);
  classRows.push(['Weighted average', risk.total, 'â€”', number(risk.weighted_precision), number(risk.weighted_recall), number(risk.weighted_f1)]);
  drawTable(doc, { x: 344, y: 499, width: PAGE_WIDTH - MARGIN - 344, headers: ['Risk class', 'Actual n', 'Pred n', 'Precision', 'Recall', 'F1'], rows: classRows, widths: [1.1, 0.55, 0.55, 0.78, 0.68, 0.55], rowHeight: 13, fontSize: 6.8 });
}

function createWekaPdfReport(req, res) {
  const result = req.body || {};
  const risk = result.risk_evaluation;
  const chartBase64 = result.scatter_3d_png_base64;
  if (!Array.isArray(result.predictions) || !risk || !Array.isArray(risk.labels) || !Array.isArray(risk.matrix)) {
    return res.status(400).json({ success: false, message: 'Run a Weka evaluation before exporting its report.' });
  }
  if (typeof chartBase64 !== 'string' || !chartBase64.startsWith('iVBOR')) {
    return res.status(400).json({ success: false, message: 'Run Weka again to generate the 3D chart for this report.' });
  }

  try {
    const chart = Buffer.from(chartBase64, 'base64');
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!chart.subarray(0, 8).equals(pngSignature)) return res.status(400).json({ success: false, message: 'The Weka 3D chart is not a valid PNG image. Run Weka again.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="weka-analysis-report.pdf"');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN });
    doc.on('error', (error) => { console.error('[ml] Weka PDF generation failed:', error); if (!res.headersSent) res.status(500).end(); else res.destroy(error); });
    doc.pipe(res);

    const data = result.data_summary || {};
    const model = result.production_model || {};
    const metrics = result.metrics || {};
    const rows = result.predictions.length;
    const accuracyText = risk.accuracy == null ? 'N/A' : `${(Number(risk.accuracy) * 100).toFixed(1)}%`;
    const features = result.features || [];

    // Page 1: results and a plain-language guide to every headline metric.
    pageHeader(doc, 'Weka and LASSO analysis report', 'Plain-language summary | Weka cross-validation is separate from the active production LASSO model');
    const metadataRows = [
      ['Weka dataset', result.filename || 'Not available', 'Algorithm', result.algorithm_label || result.algorithm || 'Not available'],
      ['Source worksheet', data.worksheet || 'CSV / not applicable', 'Weka version', `${result.engine || 'Weka'} ${result.version || ''}`.trim()],
      ['Validation', `${result.validation || 'Random-fold cross-validation'}; ${result.folds || '—'} folds`, 'Records / years', `${result.rows || rows} records; ${data.year_start ?? '—'}-${data.year_end ?? '—'}`],
    ];
    drawTable(doc, { x: MARGIN, y: 66, width: PAGE_WIDTH - MARGIN * 2, headers: ['Item', 'Details', 'Item', 'Details'], rows: metadataRows, widths: [1.05, 3.1, 1.05, 3.1], rowHeight: 19, fontSize: 7.6 });

    sectionTitle(doc, 'Final Weka results', 151);
    drawTable(doc, {
      x: MARGIN, y: 168, width: PAGE_WIDTH - MARGIN * 2,
      headers: ['Accuracy', 'Macro precision', 'Macro recall', 'Macro F1-score'],
      rows: [[accuracyText, number(risk.macro_precision), number(risk.macro_recall), number(risk.macro_f1)]],
      widths: [1, 1, 1, 1], rowHeight: 25, fontSize: 8,
    });

    sectionTitle(doc, 'What these measures mean', 228);
    const metricDefinitions = [
      ['Accuracy', 'Correct predictions / all held-out records. Compare with the majority-class baseline when the data are imbalanced.'],
      ['Precision', 'TP / (TP + FP): among records predicted as a risk class, the share that truly belongs to it. Macro precision gives each represented class equal weight.'],
      ['Recall', 'TP / (TP + FN): among records truly in a class, the share found by the classifier. Low recall means more missed records.'],
      ['F1-score', '2 × (precision × recall) / (precision + recall). The harmonic mean balances both; scores range from 0 to 1.'],
    ];
    drawTable(doc, { x: MARGIN, y: 245, width: PAGE_WIDTH - MARGIN * 2, headers: ['Term', 'Plain-language definition'], rows: metricDefinitions, widths: [1.1, 7], rowHeight: 27, fontSize: 7.7 });

    sectionTitle(doc, 'Findings and interpretation', 386);
    const correlation = Number(metrics.correlation);
    const correlationFinding = Number.isFinite(correlation)
      ? (correlation < -0.1 ? 'Predictions moved opposite to observed values in this small cross-validation sample.' : correlation < 0.1 ? 'Predictions showed little linear alignment with observed values in this sample.' : 'Predictions generally moved in the same direction as observed values in this sample.')
      : 'Correlation was not available for this run.';
    const baselineAccuracy = risk.majority_class_accuracy == null ? 'N/A' : `${(Number(risk.majority_class_accuracy) * 100).toFixed(1)}% (${risk.majority_class || 'largest class'})`;
    const findings = `Weka Random Forest evaluated ${rows} held-out risk-class predictions from ${result.filename || 'the selected dataset'} using ${result.folds || 'the selected number of'} folds. Classification accuracy was ${accuracyText} (${risk.correct ?? Math.round(Number(risk.accuracy || 0) * rows)} of ${risk.total ?? rows} records), compared with a ${baselineAccuracy} majority-class baseline; macro precision, recall, and F1 were ${number(risk.macro_precision)}, ${number(risk.macro_recall)}, and ${number(risk.macro_f1)}. Separately, the selected ${result.algorithm_label || 'Weka regression model'} estimated continuous rates with MAE ${number(metrics.mae)} and RMSE ${number(metrics.rmse)} percentage points. ${correlationFinding} With a small dataset, each record has a large effect; random folds do not test transfer to a new location or future year.`;
    paragraph(doc, findings, MARGIN, 404, PAGE_WIDTH - MARGIN * 2, { fontSize: 8.5, lineGap: 3 });
    paragraph(doc, `The confusion matrix and 3D chart on the next page show where predictions matched or missed. The class is derived only from numeric infestation_rate cutoffs (${risk.thresholds?.low ?? 'â€”'} and ${risk.thresholds?.high ?? 'â€”'}). This dataset has no separate labels for fruit damage, pest presence, or other infestation characteristics. A class with no held-out examples is N/A. The active LASSO model is evaluated separately.`, MARGIN, 476, PAGE_WIDTH - MARGIN * 2, { fontSize: 8.5, lineGap: 3 });

    // Page 2: real 3D Matplotlib scatter, legend, matrix, and class scores.
    doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
    pageHeader(doc, '3D Weka visualization and confusion matrix', `Dataset: ${result.filename || 'Not available'} | Point color is the actual risk band; see the embedded legend`);
    doc.image(chart, MARGIN + 5, 62, { fit: [PAGE_WIDTH - MARGIN * 2 - 10, 380] });
    paragraph(doc, 'Each dot is one held-out record. The three axes are observed rate, predicted rate, and absolute error. The dashed line marks a perfect rate match; points farther above the floor have larger errors.', MARGIN, 443, PAGE_WIDTH - MARGIN * 2, { fontSize: 7.5 });
    sectionTitle(doc, 'Risk-band confusion matrix', 465);
    const thresholds = risk.thresholds || {};
    paragraph(doc, `Rows are the actual band; columns are the predicted band. Diagonal counts are correct. Off-diagonal counts show a band mismatch. Cutoffs used: Low < ${thresholds.low ?? '—'}%; Medium < ${thresholds.high ?? '—'}%; High otherwise.`, MARGIN, 480, PAGE_WIDTH - MARGIN * 2, { fontSize: 7.2 });
    drawConfusionTables(doc, result);

    // Page 3: data description, production LASSO metrics, likely error sources, and actions.
    doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
    pageHeader(doc, 'Data, production LASSO, and recommendations', 'Weka results describe this analysis run; LASSO results describe the currently active production model');
    sectionTitle(doc, 'What data were evaluated?', 68);
    const scope = data.has_location_column
      ? `${data.location_count ?? 'Unknown'} recorded locations; this file has a location column.`
      : 'No location column; each row cannot be tied to a separate farm or municipality.';
    const profileRows = [
      ['Rows', result.rows || rows, 'Years', `${data.year_start ?? '—'}-${data.year_end ?? '—'}`],
      ['Location coverage', scope, 'Observed target range', `${number(data.target_min)}-${number(data.target_max)}%`],
      ['Weka inputs', features.join(', '), 'Validation unit', 'Randomly held-out rows; not held-out locations'],
    ];
    drawTable(doc, { x: MARGIN, y: 82, width: PAGE_WIDTH - MARGIN * 2, headers: ['Data item', 'Description', 'Data item', 'Description'], rows: profileRows, widths: [1.25, 3, 1.3, 3], rowHeight: 20, fontSize: 7.3 });

    const ranges = data.feature_ranges || {};
    const coefficients = model.coefficients || {};
    const featureDefinitions = {
      year: ['Calendar year; Weka can learn a time pattern', 'year'],
      rainfall: ['Annual rainfall total (mm/year)', 'rainfall'],
      temperature: ['Annual temperature average (degrees C)', 'temperature'],
      humidity: ['Annual relative humidity average (%)', 'humidity'],
      solar: ['Average daily solar radiation (MJ/m2/day)', 'solar'],
      wind: ['Annual wind-speed average (m/s)', 'wind'],
    };
    const featureRows = features.map((feature) => {
      const [meaning, key] = featureDefinitions[feature] || [feature, feature];
      const range = ranges[key];
      const effect = feature === 'year' ? 'Not used by LASSO' : coefficients[key] == null ? 'Not available' : `${Number(coefficients[key]) > 0 ? '+' : ''}${number(coefficients[key], 4)} standardized weight`;
      return [feature, meaning, range ? `${number(range.min)} to ${number(range.max)}` : 'Not available', effect];
    });
    sectionTitle(doc, 'Input ranges and LASSO weight direction', 174);
    drawTable(doc, { x: MARGIN, y: 190, width: PAGE_WIDTH - MARGIN * 2, headers: ['Input', 'Meaning / unit', 'Range in Weka data', 'Active LASSO weight'], rows: featureRows, widths: [1.05, 3, 1.55, 1.95], rowHeight: 18, fontSize: 7.1 });
    paragraph(doc, 'LASSO weights describe the direction and strength learned from the current training sample after scaling features. A positive weight raises the model estimate as that input rises; a negative weight lowers it. A zero weight was shrunk out. These associations do not prove that weather caused infestation.', MARGIN, 328, PAGE_WIDTH - MARGIN * 2, { fontSize: 7.4 });

    const validation = model.validation || {};
    const baselineMae = Number(validation.baseline_mae);
    const lassoMae = Number(validation.mae);
    const baselineRmse = Number(validation.baseline_rmse);
    const lassoRmse = Number(validation.rmse);
    const maeDifference = Number.isFinite(lassoMae) && Number.isFinite(baselineMae) ? lassoMae - baselineMae : NaN;
    const rmseDifference = Number.isFinite(lassoRmse) && Number.isFinite(baselineRmse) ? lassoRmse - baselineRmse : NaN;
    const maePercent = Number.isFinite(maeDifference) && baselineMae > 0 ? (maeDifference / baselineMae) * 100 : NaN;
    sectionTitle(doc, 'Active production LASSO: final validation scores', 370);
    const lassoRows = [
      ['Training MAE', number(model.training_mae), 'Training RMSE', number(model.training_rmse)],
      ['LOYO validation MAE', number(validation.mae), 'Mean-baseline MAE', number(validation.baseline_mae)],
      ['LOYO validation RMSE', number(validation.rmse), 'Mean-baseline RMSE', number(validation.baseline_rmse)],
    ];
    drawTable(doc, { x: MARGIN, y: 386, width: PAGE_WIDTH - MARGIN * 2, headers: ['Measure', 'LASSO', 'Measure', 'Baseline'], rows: lassoRows, widths: [2, 1.25, 2, 1.25], rowHeight: 18, fontSize: 7.3 });
    const lassoFinding = Number.isFinite(maeDifference)
      ? (maeDifference > 0 ? `In leave-one-year-out validation, LASSO MAE is ${number(maeDifference)} percentage points (${number(maePercent, 1)}%) higher than the mean baseline. The current validation does not show an improvement over simply predicting the training average.` : `In leave-one-year-out validation, LASSO MAE is ${number(Math.abs(maeDifference))} percentage points lower than the mean baseline. This is an improvement on this backtest, not a guarantee of future accuracy.`)
      : 'LASSO validation or baseline metrics were not supplied with this report.';
    paragraph(doc, `Active model source: ${model.source_filename || 'not available'}; ${model.samples ?? 'unknown'} training rows; ${model.training_period || 'training period not available'}; alpha ${model.alpha ?? 'not available'}. ${lassoFinding} Regression has no single accuracy percentage: use held-out MAE/RMSE.`, MARGIN, 465, PAGE_WIDTH - MARGIN * 2, { fontSize: 7.5 });

    // Page 4: define specialist terms, qualify findings, and list practical next steps.
    doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
    pageHeader(doc, 'How to read the results and what to do next', 'Definitions and practical limits for readers who are new to model evaluation');
    sectionTitle(doc, 'Additional terms used in this report', 68);
    const glossary = [
      ['Cross-validation fold', 'One portion of the records held aside for testing while the model learns from the remaining portions. Five folds repeat this process five times.'],
      ['LOYO validation', 'Leave-one-year-out: train on all but one year and test on the omitted year, repeating across years. It checks year-to-year performance, but not transfer to a new location.'],
      ['Mean baseline', 'A simple reference that predicts the training-set average every time. LASSO should beat this baseline on held-out data before it is considered useful.'],
      ['Precision / recall / F1', 'Precision: how often a predicted class is right. Recall: how many records of that actual class were found. F1 combines precision and recall; 0 is poor and 1 is perfect.'],
      ['Support', 'Number of held-out records belonging to a class. Very small support makes its scores unstable.'],
      ['Percentage point', 'The arithmetic difference between two percentages; for example, 5% minus 3% equals 2 percentage points.'],
    ];
    drawTable(doc, { x: MARGIN, y: 84, width: PAGE_WIDTH - MARGIN * 2, headers: ['Term', 'Plain-language meaning'], rows: glossary, widths: [1.7, 6.7], rowHeight: 24, fontSize: 7.5 });
    const colGap = 24;
    const colWidth = (PAGE_WIDTH - MARGIN * 2 - colGap) / 2;
    sectionTitle(doc, 'Possible sources of error and effects', MARGIN, 270);
    paragraph(doc, 'There are only a few annual records, so one unusual year can change the score substantially. Random folds can place neighboring years in both training and test data, making Weka results look more transferable than they are. No location column means the report cannot check whether a model works on a new farm. Incorrect units, spreadsheet formulas, target labels, missing readings, or annual averages can also shift estimates. Large errors may change a risk band near a cutoff; inspect the observed-versus-predicted plot and field records before acting.', MARGIN, 289, colWidth, { fontSize: 8, lineGap: 2 });
    sectionTitle(doc, 'Recommendations', MARGIN + colWidth + colGap, 270);
    paragraph(doc, 'Treat outputs as research estimates, not farm diagnoses or calibrated probabilities. Confirm how infestation rates and weather variables were measured, including units and missing values. Collect independent observations matched to location and year. Evaluate with whole-year and whole-location holdouts, report sample counts beside every class score, and compare LASSO with the mean baseline. Since this run’s LASSO MAE is higher than baseline, improve and validate the data/model before operational use; review predictions with local field experts.', MARGIN + colWidth + colGap, 289, colWidth, { fontSize: 8, lineGap: 2 });

    // Prediction appendix: repeat the tabular headings on every landscape page.
    const drawPredictionHeader = (continued = false) => {
      if (continued) doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
      pageHeader(doc, 'Appendix: held-out Weka predictions', `${result.filename || 'Selected dataset'} | ${result.algorithm_label || result.algorithm || 'Weka'} | ${rows} records`);
      return drawTable(doc, { x: MARGIN, y: 69, width: PAGE_WIDTH - MARGIN * 2, headers: ['CV row', 'Observed (%)', 'Predicted (%)', 'Absolute error (pp)', 'Actual band', 'Predicted band'], rows: [], widths: [0.65, 1.2, 1.2, 1.3, 1.15, 1.3], rowHeight: 20, fontSize: 7.6 });
    };
    doc.addPage({ size: 'A4', layout: 'landscape', margin: MARGIN });
    let tableY = drawPredictionHeader();
    for (const item of result.predictions) {
      if (tableY + 17 > 558) tableY = drawPredictionHeader(true);
      tableY = drawTable(doc, { x: MARGIN, y: tableY, width: PAGE_WIDTH - MARGIN * 2, headers: [], rows: [[item.row, number(item.actual), number(item.predicted), number(item.absolute_error), item.actual_risk, item.predicted_risk]], widths: [0.65, 1.2, 1.2, 1.3, 1.15, 1.3], rowHeight: 17, fontSize: 7.7 });
    }

    doc.end();
  } catch (error) {
    console.error('[ml] Weka PDF export failed:', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Could not generate the detailed Weka PDF report.' });
    return res.end();
  }
}

module.exports = createWekaPdfReport;
