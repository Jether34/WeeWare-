const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
const populate = [{ path: 'actor', select: 'fullName profilePicture' }, { path: 'post', select: 'content' }, { path: 'comment', select: 'content' }];

router.use(requireAuth);
router.get('/', async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user.sub }).populate(populate).sort({ createdAt: -1 }),
      Notification.countDocuments({ recipient: req.user.sub, isRead: false }),
    ]);
    res.json({ success: true, notifications, unreadCount });
  } catch (error) { next(error); }
});

router.patch('/read', async (req, res, next) => {
  try {
    const filter = { recipient: req.user.sub, isRead: false };
    if (req.body.id) filter._id = req.body.id;
    await Notification.updateMany(filter, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;

