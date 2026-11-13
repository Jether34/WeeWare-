const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const User = require('../models/User');
const DirectMessage = require('../models/DirectMessage');
const GroupMessage = require('../models/GroupMessage');
const GroupFile = require('../models/GroupFile');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const env = require('../config/env');

const router = express.Router();
const publicUserFields = 'fullName profilePicture role';
const GROUP_ROLES = ['admin', 'da', 'researcher'];
const GROUP_CHUNK_BYTES = 8 * 1024 * 1024;
const GROUP_FILE_MAX_BYTES = 1024 * 1024 * 1024;
const groupUploadDir = env.groupUploadDir;
const safeMessage = (message) => ({
  _id: message._id,
  sender: message.sender,
  recipient: message.recipient,
  content: message.content || '',
  legacyUnavailable: !message.content && Boolean(message.ciphertext),
  createdAt: message.createdAt,
});

router.use(requireAuth);

async function getGroupParticipants() {
  const users = await User.find({ role: { $in: GROUP_ROLES } })
    .select(`${publicUserFields} role createdAt`)
    .sort({ role: 1, fullName: 1 })
    .lean();
  return GROUP_ROLES.map((role) => users.find((user) => user.role === role)).filter(Boolean);
}

async function requireGroupMember(req, res, next) {
  try {
    const participants = await getGroupParticipants();
    if (!participants.some((person) => String(person._id) === String(req.user.sub))) {
      return res.status(403).json({ success: false, message: 'This group is available only to the designated Admin, DA, and Researcher accounts.' });
    }
    req.groupParticipants = participants;
    next();
  } catch (error) { next(error); }
}

function groupSafeFile(file) {
  return file ? { _id: file._id, originalName: file.originalName, mimeType: file.mimeType, size: file.size } : null;
}

function groupSafeMessage(message) {
  const row = message.toObject ? message.toObject() : message;
  return {
    _id: row._id,
    sender: row.sender,
    content: row.content || '',
    legacyUnavailable: !row.content && Boolean(row.ciphertext),
    attachment: row.attachment && typeof row.attachment === 'object' ? groupSafeFile(row.attachment) : row.attachment || null,
    createdAt: row.createdAt,
  };
}

router.get('/group', requireGroupMember, async (req, res, next) => {
  try {
    const messages = await GroupMessage.find().sort({ createdAt: -1 }).limit(1000)
      .populate('sender', 'fullName profilePicture role')
      .populate('attachment', 'originalName mimeType size')
      .lean();
    res.json({ success: true, participants: req.groupParticipants, messages: messages.reverse().map(groupSafeMessage) });
  } catch (error) { next(error); }
});

router.post('/group/uploads', requireGroupMember, async (req, res, next) => {
  try {
    const size = Number(req.body?.size);
    const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
    const originalName = path.basename(rawName.replace(/\\/g, '/')).replace(/[\\x00-\\x1f\\x7f]/g, '').slice(0, 255);
    if (!Number.isSafeInteger(size) || size < 1 || size > GROUP_FILE_MAX_BYTES || !originalName) {
      return res.status(400).json({ success: false, message: 'Choose a file from 1 byte to 1 GB.' });
    }
    const uploadId = crypto.randomUUID();
    const sessionDir = path.join(groupUploadDir, 'chunks', uploadId);
    await fs.promises.mkdir(sessionDir, { recursive: true });
    const metadata = { owner: String(req.user.sub), size, originalName, mimeType: String(req.body?.mimeType || 'application/octet-stream').slice(0, 160), chunkSize: GROUP_CHUNK_BYTES, createdAt: Date.now() };
    await fs.promises.writeFile(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata), { flag: 'wx' });
    res.status(201).json({ success: true, uploadId, chunkSize: GROUP_CHUNK_BYTES, chunks: Math.ceil(size / GROUP_CHUNK_BYTES) });
  } catch (error) { next(error); }
});

router.put('/group/uploads/:uploadId/:chunkIndex', requireGroupMember, express.raw({ type: 'application/octet-stream', limit: '9mb' }), async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.uploadId)) return res.status(400).json({ success: false, message: 'Invalid upload session.' });
    const sessionDir = path.join(groupUploadDir, 'chunks', req.params.uploadId);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(sessionDir, 'metadata.json'), 'utf8'));
    if (metadata.owner !== String(req.user.sub)) return res.status(403).json({ success: false, message: 'This upload belongs to another account.' });
    const index = Number(req.params.chunkIndex);
    const totalChunks = Math.ceil(metadata.size / metadata.chunkSize);
    const expectedBytes = index === totalChunks - 1 ? metadata.size - (metadata.chunkSize * index) : metadata.chunkSize;
    if (!Number.isInteger(index) || index < 0 || index >= totalChunks || !Buffer.isBuffer(req.body) || req.body.length !== expectedBytes) {
      return res.status(400).json({ success: false, message: 'The uploaded file part is incomplete or invalid.' });
    }
    await fs.promises.writeFile(path.join(sessionDir, `${index}.part`), req.body);
    res.json({ success: true, received: index });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ success: false, message: 'Upload session expired. Start the file upload again.' });
    next(error);
  }
});

router.post('/group/uploads/:uploadId/complete', requireGroupMember, async (req, res, next) => {
  let finalPath;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.uploadId)) return res.status(400).json({ success: false, message: 'Invalid upload session.' });
    const sessionDir = path.join(groupUploadDir, 'chunks', req.params.uploadId);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(sessionDir, 'metadata.json'), 'utf8'));
    if (metadata.owner !== String(req.user.sub)) return res.status(403).json({ success: false, message: 'This upload belongs to another account.' });
    const totalChunks = Math.ceil(metadata.size / metadata.chunkSize);
    for (let index = 0; index < totalChunks; index += 1) {
      const part = path.join(sessionDir, `${index}.part`);
      const expected = index === totalChunks - 1 ? metadata.size - (metadata.chunkSize * index) : metadata.chunkSize;
      if ((await fs.promises.stat(part).catch(() => null))?.size !== expected) return res.status(409).json({ success: false, message: `File part ${index + 1} has not finished uploading.` });
    }
    const storedName = `${crypto.randomUUID()}.bin`;
    const filesDir = path.join(groupUploadDir, 'files');
    await fs.promises.mkdir(filesDir, { recursive: true });
    finalPath = path.join(filesDir, storedName);
    for (let index = 0; index < totalChunks; index += 1) {
      await pipeline(fs.createReadStream(path.join(sessionDir, `${index}.part`)), fs.createWriteStream(finalPath, { flags: index ? 'a' : 'wx' }));
    }
    const savedFile = await GroupFile.create({ owner: req.user.sub, storageName: storedName, originalName: metadata.originalName, mimeType: metadata.mimeType, size: metadata.size });
    await fs.promises.rm(sessionDir, { recursive: true, force: true });
    res.status(201).json({ success: true, file: groupSafeFile(savedFile) });
  } catch (error) {
    if (finalPath) await fs.promises.rm(finalPath, { force: true }).catch(() => {});
    if (error.code === 'ENOENT') return res.status(404).json({ success: false, message: 'Upload session expired. Start the file upload again.' });
    next(error);
  }
});

router.delete('/group/uploads/:uploadId', requireGroupMember, async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.uploadId)) return res.status(400).json({ success: false, message: 'Invalid upload session.' });
    const sessionDir = path.join(groupUploadDir, 'chunks', req.params.uploadId);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(sessionDir, 'metadata.json'), 'utf8'));
    if (metadata.owner !== String(req.user.sub)) return res.status(403).json({ success: false, message: 'This upload belongs to another account.' });
    await fs.promises.rm(sessionDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error) { if (error.code === 'ENOENT') return res.json({ success: true }); next(error); }
});

router.get('/group/files/:fileId', requireGroupMember, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fileId)) return res.status(404).end();
    const file = await GroupFile.findOne({ _id: req.params.fileId, message: { $ne: null } }).lean();
    if (!file) return res.status(404).end();
    const filename = encodeURIComponent(file.originalName).replace(/['()]/g, escape);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${filename}`, 'Content-Length': String(file.size), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.sendFile(path.join(groupUploadDir, 'files', file.storageName));
  } catch (error) { next(error); }
});

router.post('/group', requireGroupMember, async (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const { attachmentId } = req.body || {};
    if (content.length > 4000) return res.status(400).json({ success: false, message: 'Messages are limited to 4,000 characters.' });
    let file = null;
    if (attachmentId) {
      if (!mongoose.isValidObjectId(attachmentId)) return res.status(400).json({ success: false, message: 'Invalid group attachment.' });
      file = await GroupFile.findOne({ _id: attachmentId, owner: req.user.sub, message: null });
      if (!file) return res.status(404).json({ success: false, message: 'The uploaded file is unavailable or already attached to a message.' });
    }
    if (!content && !file) return res.status(400).json({ success: false, message: 'Write a message or attach a file.' });
    const message = await GroupMessage.create({ sender: req.user.sub, content, attachment: file?._id || null });
    if (file) { file.message = message._id; await file.save(); }
    await message.populate([{ path: 'sender', select: 'fullName profilePicture role' }, { path: 'attachment', select: 'originalName mimeType size' }]);
    const payload = groupSafeMessage(message);
    const io = req.app.get('io');
    req.groupParticipants.forEach((participant) => io?.to(`user:${participant._id}`).emit('message:group:new', payload));
    res.status(201).json({ success: true, message: payload });
  } catch (error) { next(error); }
});

router.get('/pinned', async (req, res, next) => {
  try {
    const accounts = await User.find({ role: { $in: ['admin', 'da', 'researcher'] } }).select(`${publicUserFields} role`).sort({ role: 1, fullName: 1 });
    res.json({ success: true, accounts: {
      admin: accounts.find((user) => user.role === 'admin') || null,
      da: accounts.find((user) => user.role === 'da') || null,
      researcher: accounts.find((user) => user.role === 'researcher') || null,
    } });
  } catch (error) { next(error); }
});

router.get('/threads', async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.sub);
    const threads = await DirectMessage.aggregate([
      { $match: { $or: [{ sender: userId }, { recipient: userId }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { $cond: [{ $eq: ['$sender', userId] }, '$recipient', '$sender'] }, latest: { $first: '$$ROOT' } } },
      { $sort: { 'latest.createdAt': -1 } },
    ]);
    const ids = threads.map((thread) => thread._id);
    const users = await User.find({ _id: { $in: ids } }).select(publicUserFields);
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const owner = await User.findById(req.user.sub).select('archivedConversations').lean();
    const archived = new Set((owner?.archivedConversations || []).map(String));
    res.json({ success: true, threads: threads.map((thread) => ({ user: byId.get(String(thread._id)), latest: safeMessage(thread.latest), archived: archived.has(String(thread._id)) })).filter((thread) => thread.user) });
  } catch (error) { next(error); }
});

router.post('/:userId/archive', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || req.params.userId === req.user.sub) return res.status(400).json({ success: false, message: 'Choose another valid WeeWare user.' });
    const archive = req.body?.archived !== false;
    await User.updateOne({ _id: req.user.sub }, archive ? { $addToSet: { archivedConversations: req.params.userId } } : { $pull: { archivedConversations: req.params.userId } });
    res.json({ success: true, archived: archive });
  } catch (error) { next(error); }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || req.params.userId === req.user.sub) return res.status(400).json({ success: false, message: 'Choose another valid WeeWare user.' });
    await DirectMessage.deleteMany({ $or: [{ sender: req.user.sub, recipient: req.params.userId }, { sender: req.params.userId, recipient: req.user.sub }] });
    await User.updateOne({ _id: req.user.sub }, { $pull: { archivedConversations: req.params.userId } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.get('/recipients', requireAdmin, async (req, res, next) => {
  try {
    const recipients = await User.find({ _id: { $ne: req.user.sub } }).select('fullName profilePicture role').sort({ fullName: 1 }).lean();
    res.json({ success: true, recipients });
  } catch (error) { next(error); }
});

router.post('/broadcast', requireAdmin, async (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 4000) return res.status(400).json({ success: false, message: 'Enter a message of up to 4,000 characters.' });
    const recipients = await User.find({ _id: { $ne: req.user.sub } }).select('_id');
    if (recipients.length > 1000) return res.status(413).json({ success: false, message: 'Broadcast is limited to 1,000 recipients at a time.' });
    const saved = await DirectMessage.insertMany(recipients.map((recipient) => ({ sender: req.user.sub, recipient: recipient._id, content })));
    const io = req.app.get('io');
    const output = saved.map((message) => {
      const payload = safeMessage(message);
      io?.to(`user:${message.recipient}`).emit('message:new', payload);
      io?.to('role:admin').emit('admin:conversation-new', { senderId: String(message.sender), recipientId: String(message.recipient) });
      return payload;
    });
    res.status(201).json({ success: true, sentCount: output.length, skippedNoKey: 0, messages: output });
  } catch (error) { next(error); }
});

router.get('/:userId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || req.params.userId === req.user.sub) return res.status(400).json({ success: false, message: 'Choose another valid WeeWare user.' });
    const peer = await User.findById(req.params.userId).select(publicUserFields);
    if (!peer) return res.status(404).json({ success: false, message: 'User not found.' });
    const messages = await DirectMessage.find({ $or: [
      { sender: req.user.sub, recipient: peer._id },
      { sender: peer._id, recipient: req.user.sub },
    ] }).sort({ createdAt: 1 }).limit(500);
    res.json({ success: true, user: peer, messages: messages.map(safeMessage) });
  } catch (error) { next(error); }
});

router.post('/:userId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || req.params.userId === req.user.sub) return res.status(400).json({ success: false, message: 'Choose another valid WeeWare user.' });
    const recipient = await User.findById(req.params.userId).select('_id');
    if (!recipient) return res.status(404).json({ success: false, message: 'User not found.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 4000) return res.status(400).json({ success: false, message: 'Enter a message of up to 4,000 characters.' });
    const message = await DirectMessage.create({ sender: req.user.sub, recipient: recipient._id, content });
    const populated = await message.populate([{ path: 'sender', select: publicUserFields }, { path: 'recipient', select: publicUserFields }]);
    const payload = safeMessage(populated);
    const io = req.app.get('io');
    io?.to(`user:${recipient._id}`).emit('message:new', payload);
    io?.to(`user:${req.user.sub}`).emit('message:new', payload);
    io?.to('role:admin').emit('admin:conversation-new', { senderId: String(message.sender), recipientId: String(message.recipient) });
    res.status(201).json({ success: true, message: payload });
  } catch (error) { next(error); }
});

module.exports = router;
