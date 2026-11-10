const mongoose = require('mongoose');

const aiMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true, maxlength: 12000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const aiConversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, maxlength: 120 },
  messages: { type: [aiMessageSchema], default: [] },
}, { timestamps: true });

aiConversationSchema.index({ owner: 1, updatedAt: -1 });

module.exports = mongoose.model('AIConversation', aiConversationSchema);
