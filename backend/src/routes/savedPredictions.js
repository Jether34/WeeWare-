const express = require('express');
const SavedPrediction = require('../models/SavedPrediction');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const rows = await SavedPrediction.find({ user: req.user.sub }).populate('prediction').sort({ createdAt: -1 });
    res.json({ success: true, savedPredictions: rows });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const saved = await SavedPrediction.findOneAndDelete({ _id: req.params.id, user: req.user.sub });
    if (!saved) return res.status(404).json({ success: false, message: 'Saved report not found.' });
    await require('../models/Prediction').updateOne({ _id: saved.prediction, user: req.user.sub }, { $set: { isSaved: false } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;

