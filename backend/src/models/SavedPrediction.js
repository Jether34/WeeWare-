const mongoose = require('mongoose');

const savedPredictionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  prediction: { type: mongoose.Schema.Types.ObjectId, ref: 'Prediction', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', maxlength: 2000 },
}, { timestamps: true });

module.exports = mongoose.model('SavedPrediction', savedPredictionSchema);

