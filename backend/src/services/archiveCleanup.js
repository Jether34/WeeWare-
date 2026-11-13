const ArchivedConversation = require('../models/ArchivedConversation');
const DirectMessage = require('../models/DirectMessage');
const User = require('../models/User');
const { recordDeletedContent } = require('./deletedContent');

const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const archiveExpiresAt = (archivedAt = new Date()) => new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_MS);

async function migrateLegacyArchives() {
  const users = await User.collection.find({ archivedConversations: { $type: 'array', $ne: [] } }, { projection: { archivedConversations: 1 } }).toArray();
  for (const user of users) {
    const archivedAt = new Date();
    const peers = [...new Set((user.archivedConversations || []).map(String).filter((id) => id !== String(user._id)))];
    if (peers.length) await ArchivedConversation.bulkWrite(peers.map((peer) => ({
      updateOne: { filter: { owner: user._id, peer }, update: { $setOnInsert: { owner: user._id, peer, archivedAt, expiresAt: archiveExpiresAt(archivedAt) } }, upsert: true },
    })), { ordered: false });
    await User.collection.updateOne({ _id: user._id }, { $unset: { archivedConversations: '' } });
  }
  return users.length;
}

async function removeExpiredArchivedConversations() {
  const expired = await ArchivedConversation.find({ expiresAt: { $lte: new Date() } }).sort({ expiresAt: 1 }).limit(100);
  let removed = 0;
  for (const archive of expired) {
    const messages = await DirectMessage.find({ $or: [
      { sender: archive.owner, recipient: archive.peer },
      { sender: archive.peer, recipient: archive.owner },
    ] }).lean();
    if (messages.length) {
      await recordDeletedContent(messages.map((message) => ({
        contentType: 'message', sourceId: String(message._id), deletedBy: archive.owner,
        reason: 'archived_conversation_expired', snapshot: message, deletedAt: new Date(),
      })));
      await DirectMessage.deleteMany({ _id: { $in: messages.map((message) => message._id) } });
    }
    await archive.deleteOne();
    removed += messages.length;
  }
  return { expiredArchives: expired.length, deletedMessages: removed };
}

function scheduleArchiveCleanup(logger = console) {
  const run = () => removeExpiredArchivedConversations().catch((error) => logger.error('[archive-cleanup] failed:', error.message));
  run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = { ARCHIVE_RETENTION_MS, archiveExpiresAt, migrateLegacyArchives, removeExpiredArchivedConversations, scheduleArchiveCleanup };
