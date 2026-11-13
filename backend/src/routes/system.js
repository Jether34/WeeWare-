const express = require('express');
const os = require('os');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const DirectMessage = require('../models/DirectMessage');
const Notification = require('../models/Notification');
const { recordDeletedContent } = require('../services/deletedContent');
const SavedPrediction = require('../models/SavedPrediction');
const Prediction = require('../models/Prediction');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const ModerationRequest = require('../models/ModerationRequest');
const env = require('../config/env');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { snapshot, trackedFetch } = require('../services/traffic');
const upload = require('../middleware/upload');

const router = express.Router();
const adminOnly = [requireAuth, requireRoles('admin')];
const daAccess = [requireAuth, requireRoles('da', 'admin')];

router.get('/admin/overview', ...adminOnly, async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const [users, newUsers, predictions, posts, comments, risk] = await Promise.all([
      User.countDocuments(), User.countDocuments({ createdAt: { $gte: since } }), Prediction.countDocuments(), Post.countDocuments({ deletedAt: null }), Comment.countDocuments({ deletedAt: null }),
      Prediction.aggregate([{ $group: { _id: '$riskCategory', count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, metrics: { users, newUsers30d: newUsers, predictions, posts, comments, risk: Object.fromEntries(risk.map((item) => [item._id || 'Unclassified', item.count])) }, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

router.get('/admin/users', ...adminOnly, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
    const q = String(req.query.q || '').trim().slice(0, 80);
    const filter = q ? { $or: [{ fullName: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] } : {};
    const [users, total] = await Promise.all([
      User.find(filter).select('fullName email gender birthday address phone role accountStatus acceptedTerms createdAt profilePicture language signupIp signupDevice signupLocation').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, users, page, limit, total });
  } catch (error) { next(error); }
});

router.post('/admin/users', ...adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, password, role = 'farmer' } = req.body || {};
    if (!fullName || !/^\S+@\S+\.\S+$/.test(String(email || '')) || String(password || '').length < 8) return res.status(400).json({ success: false, message: 'Name, valid email, and password of at least 8 characters are required.' });
    if (!['farmer', 'researcher', 'admin', 'da'].includes(role)) return res.status(400).json({ success: false, message: 'Choose farmer, researcher, admin, or da.' });
    const user = await User.create({ fullName, email: String(email).toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role, acceptedTerms: true, accountStatus: 'approved' });
    res.status(201).json({ success: true, user: user.toObject({ transform: (_doc, ret) => { delete ret.passwordHash; return ret; } }) });
  } catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account already uses that email.' }); next(error); }
});

router.patch('/admin/users/:id', ...adminOnly, upload.single('profilePicture'), async (req, res, next) => {
  try {
    const updates = {};
    if (typeof req.body.fullName === 'string' && req.body.fullName.trim()) updates.fullName = req.body.fullName.trim();
    if (typeof req.body.email === 'string' && /^\S+@\S+\.\S+$/.test(req.body.email)) updates.email = req.body.email.toLowerCase();
    for (const field of ['gender', 'address', 'phone', 'language']) if (typeof req.body[field] === 'string') updates[field] = req.body[field];
    if (req.body.birthday !== undefined) updates.birthday = req.body.birthday ? new Date(req.body.birthday) : null;
    if (typeof req.body.profilePicture === 'string') updates.profilePicture = req.body.profilePicture;
    if (req.body.acceptedTerms !== undefined) updates.acceptedTerms = req.body.acceptedTerms === true || req.body.acceptedTerms === 'true';
    if (req.file) updates.profilePicture = `/uploads/${req.file.filename}`;
    if (req.body.role !== undefined) {
      if (!['farmer', 'researcher', 'admin', 'da'].includes(req.body.role)) return res.status(400).json({ success: false, message: 'Invalid role.' });
      if (req.params.id === req.user.sub && req.body.role !== 'admin') return res.status(400).json({ success: false, message: 'You cannot remove your own administrator role.' });
      const currentRole = await User.findById(req.params.id).select('role');
      if (currentRole?.role === 'admin' && req.body.role !== 'admin' && await User.countDocuments({ role: 'admin' }) <= 1) return res.status(400).json({ success: false, message: 'Promote another administrator before changing the last administrator account.' });
      updates.role = req.body.role;
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      updates.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select('fullName email gender birthday address phone role accountStatus acceptedTerms createdAt profilePicture language signupIp signupDevice signupLocation');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (updates.role) req.app.get('io')?.emit('admin:user-role', { userId: String(user._id), role: user.role });
    res.json({ success: true, user });
  } catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account already uses that email.' }); next(error); }
});

router.delete('/admin/users/:id', ...adminOnly, async (req, res, next) => {
  try {
    if (req.params.id === req.user.sub) return res.status(400).json({ success: false, message: 'You cannot delete your own administrator account.' });
    const user = await User.findById(req.params.id).select('_id role');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.role === 'admin' && await User.countDocuments({ role: 'admin' }) <= 1) return res.status(400).json({ success: false, message: 'Promote another administrator before deleting the last administrator account.' });
    const [authoredPosts, directMessages] = await Promise.all([
      Post.find({ author: user._id }).lean(),
      DirectMessage.find({ $or: [{ sender: user._id }, { recipient: user._id }] }).lean(),
    ]);
    const postIds = authoredPosts.map((post) => post._id);
    const affectedComments = await Comment.find({ $or: [{ author: user._id }, { post: { $in: postIds } }] }).lean();
    await recordDeletedContent([
      ...directMessages.map((message) => ({ contentType: 'message', sourceId: String(message._id), deletedBy: req.user.sub, reason: 'admin_account_deleted', snapshot: message })),
      ...authoredPosts.map((post) => ({ contentType: 'post', sourceId: String(post._id), deletedBy: req.user.sub, reason: 'admin_account_deleted', snapshot: post })),
      ...affectedComments.map((comment) => ({ contentType: 'comment', sourceId: String(comment._id), deletedBy: req.user.sub, reason: 'admin_account_deleted', snapshot: comment })),
    ]);
    await Promise.all([
      DirectMessage.deleteMany({ $or: [{ sender: user._id }, { recipient: user._id }] }),
      Notification.deleteMany({ $or: [{ recipient: user._id }, { actor: user._id }] }),
      SavedPrediction.deleteMany({ user: user._id }),
      Prediction.deleteMany({ user: user._id }),
      Comment.deleteMany({ $or: [{ author: user._id }, { post: { $in: postIds } }] }),
      ModerationRequest.deleteMany({ $or: [{ requester: user._id }, { post: { $in: postIds } }] }),
      Post.deleteMany({ author: user._id }),
      Post.updateMany({ likes: user._id }, { $pull: { likes: user._id } }),
      Comment.updateMany({ likes: user._id }, { $pull: { likes: user._id } }),
      User.deleteOne({ _id: user._id }),
    ]);
    res.json({ success: true, deletedUserId: String(user._id) });
  } catch (error) { next(error); }
});

router.get('/admin/conversations', ...adminOnly, async (_req, res, next) => {
  try {
    const groups = await DirectMessage.aggregate([
      { $project: { a: { $toString: '$sender' }, b: { $toString: '$recipient' }, createdAt: 1 } },
      { $project: { pair: { $cond: [{ $lt: ['$a', '$b'] }, ['$a', '$b'], ['$b', '$a']] }, createdAt: 1 } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$pair', count: { $sum: 1 }, latestAt: { $first: '$createdAt' } } },
      { $sort: { latestAt: -1 } }, { $limit: 500 },
    ]);
    const ids = [...new Set(groups.flatMap((row) => row._id))];
    const users = await User.find({ _id: { $in: ids } }).select('fullName email role').lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    res.json({ success: true, conversations: groups.map((row) => ({ participants: row._id.map((id) => userMap.get(id)).filter(Boolean), messageCount: row.count, latestAt: row.latestAt })) });
  } catch (error) { next(error); }
});

router.get('/admin/conversations/:firstId/:secondId/messages', ...adminOnly, async (req, res, next) => {
  try {
    const { firstId, secondId } = req.params;
    if (!mongoose.isValidObjectId(firstId) || !mongoose.isValidObjectId(secondId) || firstId === secondId) return res.status(400).json({ success: false, message: 'Choose two valid conversation participants.' });
    const [first, second] = await Promise.all([User.findById(firstId).select('fullName role'), User.findById(secondId).select('fullName role')]);
    if (!first || !second) return res.status(404).json({ success: false, message: 'Conversation participant not found.' });
    const messages = await DirectMessage.find({ $or: [{ sender: firstId, recipient: secondId }, { sender: secondId, recipient: firstId }] }).sort({ createdAt: 1 }).limit(5000).lean();
    res.json({ success: true, participants: [first, second], messages: messages.map((message) => ({ _id: message._id, sender: message.sender, recipient: message.recipient, content: message.content || '', legacyUnavailable: !message.content && Boolean(message.ciphertext), createdAt: message.createdAt })) });
  } catch (error) { next(error); }
});

router.get('/admin/schema', ...adminOnly, (_req, res) => res.json({ success: true, collections: [
  { name: 'users', model: 'User', fields: ['fullName', 'email', 'role', 'accountStatus'], relations: [] },
  { name: 'predictions', model: 'Prediction', fields: ['owner', 'location', 'startDate', 'endDate', 'weatherInputs', 'infestationRate', 'riskCategory'], relations: ['owner → users'] },
  { name: 'savedpredictions', model: 'SavedPrediction', fields: ['user', 'prediction', 'title'], relations: ['user → users', 'prediction → predictions'] },
  { name: 'posts', model: 'Post', fields: ['author', 'content', 'media', 'publishStatus', 'createdAt'], relations: ['author → users'] },
  { name: 'comments', model: 'Comment', fields: ['author', 'post', 'parent', 'content', 'deletionStatus'], relations: ['author → users', 'post → posts', 'parent → comments'] },
  { name: 'moderationrequests', model: 'ModerationRequest', fields: ['kind', 'post', 'comment', 'requester', 'status', 'decidedBy', 'decidedAt'], relations: ['post → posts', 'comment → comments', 'requester → users', 'decidedBy → users'] },
  { name: 'directmessages', model: 'DirectMessage', fields: ['sender', 'recipient', 'content', 'createdAt'], relations: ['sender → users', 'recipient → users'] },
  { name: 'archivedconversations', model: 'ArchivedConversation', fields: ['owner', 'peer', 'archivedAt', 'expiresAt'], relations: ['owner to users', 'peer to users'] },
  { name: 'deletedcontent', model: 'DeletedContent', fields: ['contentType', 'sourceId', 'deletedBy', 'reason', 'snapshot', 'deletedAt'], relations: ['deletedBy to users'] },
  { name: 'notifications', model: 'Notification', fields: ['recipient', 'actor', 'type', 'post', 'comment', 'isRead'], relations: ['recipient → users', 'actor → users'] },
] }));

router.patch('/admin/users/:id/role', ...adminOnly, async (req, res, next) => {
  try {
    const role = String(req.body.role || '');
    if (!['farmer', 'researcher', 'admin', 'da'].includes(role)) return res.status(400).json({ success: false, message: 'Choose farmer, researcher, admin, or da.' });
    if (req.params.id === req.user.sub && role !== 'admin') return res.status(400).json({ success: false, message: 'You cannot remove your own administrator role.' });
    const current = await User.findById(req.params.id).select('role');
    if (current?.role === 'admin' && role !== 'admin' && await User.countDocuments({ role: 'admin' }) <= 1) return res.status(400).json({ success: false, message: 'Promote another administrator before changing the last administrator account.' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true, runValidators: true }).select('fullName email role createdAt profilePicture language');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    req.app.get('io')?.emit('admin:user-role', { userId: String(user._id), role: user.role });
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

router.get('/admin/config', ...adminOnly, async (_req, res) => {
  const mongo = new URL(env.mongoUri);
  res.json({ success: true, config: {
    environment: env.nodeEnv,
    apiPort: env.port,
    database: `${mongo.hostname}:${mongo.port || '27017'}/${mongo.pathname.replace(/^\//, '')}`,
    databaseState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    modelService: env.mlServiceUrl,
    allowedWebOrigins: env.clientOrigin.split(',').map((origin) => origin.trim()),
    uploadLimitBytes: env.maxUploadBytes,
    hostPlatform: `${os.platform()} ${os.arch()}`,
    model: 'LASSO regression with CMIP6 climate inputs',
  } });
});

router.get('/admin/traffic', ...adminOnly, (_req, res) => res.json({ success: true, traffic: snapshot() }));

router.get('/admin/health', ...adminOnly, async (_req, res) => {
  let ml = { status: 'unavailable', detail: '' };
  try {
    const response = await trackedFetch(`${env.mlServiceUrl}/health`, { signal: AbortSignal.timeout(4000) });
    ml = { status: response.ok ? 'online' : 'degraded', detail: response.ok ? await response.json() : `HTTP ${response.status}` };
  } catch (error) { ml.detail = error.message; }
  res.json({ success: true, services: {
    frontend: { status: 'online', detail: 'Serving this dashboard' },
    api: { status: 'online', detail: `Node.js · ${process.version} · ${Math.round(process.uptime())}s uptime` },
    database: { status: mongoose.connection.readyState === 1 ? 'online' : 'offline', detail: mongoose.connection.readyState === 1 ? 'MongoDB connection active' : 'MongoDB connection unavailable' },
    model: ml,
  }, performance: { uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage(), hostMemory: { total: os.totalmem(), free: os.freemem(), cpuCount: os.cpus().length }, eventLoopUtilization: Number((require('node:perf_hooks').performance.eventLoopUtilization().utilization * 100).toFixed(1)) }, traffic: snapshot(), checkedAt: new Date().toISOString() });
});

router.get('/da/overview', ...daAccess, async (_req, res, next) => {
  try {
    const [predictions, risks, latest] = await Promise.all([
      Prediction.countDocuments(),
      Prediction.aggregate([{ $group: { _id: '$riskCategory', count: { $sum: 1 }, averageRate: { $avg: '$infestationRate' } } }]),
      Prediction.find().select('title startDate endDate location infestationRate riskCategory suggestedAction createdAt').sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const locations = await Prediction.distinct('location.name');
    res.json({ success: true, metrics: { predictions, locations: locations.filter(Boolean).length, risks: Object.fromEntries(risks.map((row) => [row._id || 'Unclassified', { count: row.count, averageRate: Number((row.averageRate || 0).toFixed(2)) }])) }, latest });
  } catch (error) { next(error); }
});

module.exports = router;
