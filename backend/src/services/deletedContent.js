const DeletedContent = require('../models/DeletedContent');

async function recordDeletedContent(records = []) {
  if (!records.length) return { upsertedCount: 0 };
  return DeletedContent.bulkWrite(records.map((record) => ({
    updateOne: {
      filter: { contentType: record.contentType, sourceId: record.sourceId, reason: record.reason },
      update: { $setOnInsert: { ...record, deletedAt: record.deletedAt || new Date() } },
      upsert: true,
    },
  })), { ordered: false });
}

module.exports = { recordDeletedContent };
