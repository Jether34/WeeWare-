const mongoose = require('mongoose');

const authChallengeSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  purpose: { type: String, enum: ['signup', 'password_reset'], required: true },
  codeHash: { type: String, default: '' },
  tokenHash: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

authChallengeSchema.index({ email: 1, purpose: 1 }, { unique: true });
module.exports = mongoose.model('AuthChallenge', authChallengeSchema);
