const mongoose = require('mongoose');
const MAX_INFESTATION_RATE_PERCENT = 100;

const predictionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: '' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  year: { type: Number, required: true },
  location: { lat: Number, lng: Number, name: String },
  weather: { rainfall: Number, temperature: Number, humidity: Number, solar: Number, wind: Number },
  weatherSources: { type: mongoose.Schema.Types.Mixed, default: {} },
  weatherMonthly: { type: [mongoose.Schema.Types.Mixed], default: [] },
  infestationRate: { type: Number, required: true, min: 0, max: MAX_INFESTATION_RATE_PERCENT },
  rawRate: Number,
  confidenceLevel: Number,
  riskCategory: { type: String, enum: ['Low', 'Medium', 'High'] },
  suggestedAction: String,
  severityScore: { type: Number, min: 1, max: 100 },
  actionKey: String,
  measurementKeys: { type: [String], default: [] },
  modelInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
  isSaved: { type: Boolean, default: false, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Prediction', predictionSchema);

