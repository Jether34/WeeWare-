const express = require('express');
const mongoose = require('mongoose');
const AIConversation = require('../models/AIConversation');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { generateAssistantReply, formatPersonalPredictionReply, formatMangoWeevilAnswer } = require('../services/aiAssistant');
const { buildAssistantContext } = require('../services/aiContext');

const router = express.Router();
router.use(requireAuth, requireRoles('farmer', 'researcher', 'da', 'admin'));

function emitConversation(req, conversation) {
  req.app.get('io')?.to(`user:${req.user.sub}`).emit('ai:conversation-updated', conversation);
}

router.get('/', async (req, res, next) => {
  try {
    const conversations = await AIConversation.find({ owner: req.user.sub }).sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ success: true, conversations });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const title = String(req.body?.title || 'New conversation').trim().slice(0, 120) || 'New conversation';
    const conversation = await AIConversation.create({ owner: req.user.sub, title });
    emitConversation(req, conversation.toObject());
    res.status(201).json({ success: true, conversation });
  } catch (error) { next(error); }
});

router.post('/:id/messages', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid conversation.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ success: false, message: 'Enter a message first.' });
    if (text.length > 12000) return res.status(413).json({ success: false, message: 'Messages must be 12,000 characters or fewer.' });
    const conversation = await AIConversation.findOne({ _id: req.params.id, owner: req.user.sub });
    if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    const history = conversation.messages.map(({ role, text: messageText }) => ({ role, text: messageText }));
    conversation.messages.push({ role: 'user', text });
    if (conversation.messages.length === 1) {
      conversation.title = text.slice(0, 48);
    }
    const { context, language, predictionRecords, predictionCount } = await buildAssistantContext({ userId: req.user.sub, role: req.user.role, message: text, history, conversationId: conversation._id });
    const recordAnswer = formatPersonalPredictionReply(text, history, predictionRecords, predictionCount, language);
    const agricultureAnswer = formatMangoWeevilAnswer(text, language);
    const reply = recordAnswer || agricultureAnswer || await generateAssistantReply(text, history, context, language);
    conversation.messages.push({ role: 'assistant', text: reply });
    await conversation.save();
    const result = conversation.toObject();
    emitConversation(req, result);
    res.json({ success: true, conversation: result });
  } catch (error) { next(error); }
});

module.exports = router;
