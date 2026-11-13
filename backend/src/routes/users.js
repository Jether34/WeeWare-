const bcrypt = require('bcryptjs');
const express = require('express');
const User = require('../models/User');
const DirectMessage = require('../models/DirectMessage');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('-passwordHash');
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (!q) return res.json({ success: true, users: [] });
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({ _id: { $ne: req.user.sub }, fullName: { $regex: escaped, $options: 'i' } })
      .select('fullName profilePicture')
      .limit(12);
    res.json({ success: true, users });
  } catch (error) { next(error); }
});

router.put('/me', requireAuth, upload.single('profilePicture'), async (req, res, next) => {
  try {
    const fields = ['fullName', 'gender', 'birthday', 'address', 'phone', 'language'];
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
    fields.forEach((field) => {
      if (req.body[field] !== undefined) user[field] = field === 'birthday' ? (req.body[field] || null) : req.body[field];
    });
    if (req.body.publicProfile !== undefined) {
      let preferences = req.body.publicProfile;
      if (typeof preferences === 'string') {
        try { preferences = JSON.parse(preferences); }
        catch { return res.status(400).json({ success: false, message: 'Public profile preferences are invalid.' }); }
      }
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return res.status(400).json({ success: false, message: 'Public profile preferences are invalid.' });
      for (const field of ['email', 'gender', 'birthday', 'address', 'phone']) {
        user.publicProfile[field] = preferences[field] === true || preferences[field] === 'true';
      }
    }
    if (req.file) user.profilePicture = `/uploads/${req.file.filename}`;
    await user.save();
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

router.put('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'New passwords do not match.' });
    const user = await User.findById(req.user.sub).select('+passwordHash');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.post('/me/deactivate', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.sub, { $set: { accountStatus: 'deactivated' } }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
    res.clearCookie('weeware_token');
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const Prediction = require('../models/Prediction');
    const SavedPrediction = require('../models/SavedPrediction');
    const Post = require('../models/Post');
    const Comment = require('../models/Comment');
    const Notification = require('../models/Notification');
    const GroupMessage = require('../models/GroupMessage');
    const GroupFile = require('../models/GroupFile');
    const [ownGroupMessages, ownGroupFiles] = await Promise.all([
      GroupMessage.find({ sender: req.user.sub }).select('attachment').lean(),
      GroupFile.find({ owner: req.user.sub }).select('storageName').lean(),
    ]);
    const groupFileIds = [...new Set([...ownGroupMessages.map((message) => String(message.attachment || '')).filter(Boolean), ...ownGroupFiles.map((file) => String(file._id))])];
    const messageFiles = await GroupFile.find({ _id: { $in: groupFileIds } }).select('storageName').lean();
    await Promise.all([
      Prediction.deleteMany({ user: req.user.sub }),
      SavedPrediction.deleteMany({ user: req.user.sub }),
      Post.deleteMany({ author: req.user.sub }),
      Comment.deleteMany({ author: req.user.sub }),
      Notification.deleteMany({ $or: [{ recipient: req.user.sub }, { actor: req.user.sub }] }),
      DirectMessage.deleteMany({ $or: [{ sender: req.user.sub }, { recipient: req.user.sub }] }),
      Post.updateMany({ likes: req.user.sub }, { $pull: { likes: req.user.sub } }),
      Comment.updateMany({ likes: req.user.sub }, { $pull: { likes: req.user.sub } }),
      User.updateMany({ archivedConversations: req.user.sub }, { $pull: { archivedConversations: req.user.sub } }),
      GroupMessage.deleteMany({ sender: req.user.sub }),
      GroupFile.deleteMany({ _id: { $in: groupFileIds } }),
    ]);
    await Promise.all(messageFiles.map((file) => fs.promises.unlink(path.join(env.groupUploadDir, file.storageName)).catch((error) => { if (error.code !== 'ENOENT') throw error; })));
    await User.findByIdAndDelete(req.user.sub);
    res.clearCookie('weeware_token');
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Choose a valid user profile.' });
    const user = await User.findById(req.params.id).select('fullName email profilePicture role createdAt gender birthday address phone publicProfile');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const preferences = user.publicProfile || {};
    const isPublic = (value) => value === true || value === 'true' || value === 1;
    const profile = {
      _id: user._id,
      fullName: user.fullName,
      profilePicture: user.profilePicture,
      role: user.role,
      createdAt: user.createdAt,
      publicProfile: {
        email: isPublic(preferences.email),
        gender: isPublic(preferences.gender),
        birthday: isPublic(preferences.birthday),
        address: isPublic(preferences.address),
        phone: isPublic(preferences.phone),
      },
    };
    for (const field of ['email', 'gender', 'birthday', 'address', 'phone']) {
      if (profile.publicProfile[field] && user[field] !== undefined && user[field] !== null && String(user[field]).trim()) profile[field] = user[field];
    }
    res.json({ success: true, user: profile });
  } catch (error) { next(error); }
});

module.exports = router;

