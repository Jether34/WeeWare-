const mongoose = require('mongoose');
const mediaSchema = new mongoose.Schema({ url: String, type: { type: String, enum: ['image', 'video'] }, mime: String, size: Number }, { _id: false });
const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, required: true, trim: true, maxlength: 5000 },
  media: [mediaSchema],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  publishStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });
module.exports = mongoose.model('Post', postSchema);

