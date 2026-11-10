const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  gender: { type: String, default: '' },
  birthday: { type: Date, default: null },
  address: { type: String, default: '', maxlength: 255 },
  phone: { type: String, default: '', maxlength: 30 },
  language: { type: String, enum: ['en', 'tl', 'ceb', 'hil', 'krj', 'cyo'], default: 'en' },
  profilePicture: { type: String, default: '' },
  publicProfile: {
    email: { type: Boolean, default: false },
    gender: { type: Boolean, default: false },
    birthday: { type: Boolean, default: false },
    address: { type: Boolean, default: false },
    phone: { type: Boolean, default: false },
  },
  acceptedTerms: { type: Boolean, default: false },
  signupIp: { type: String, default: '' },
  signupDevice: {
    type: { type: String, default: '' },
    platform: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    language: { type: String, default: '' },
    screen: { width: Number, height: Number, pixelRatio: Number },
    hardwareConcurrency: Number,
    deviceMemory: Number,
  },
  signupLocation: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    capturedAt: Date,
  },
  accountStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
  role: { type: String, enum: ['farmer', 'researcher', 'admin', 'da'], default: 'farmer' },
  lastLocation: { lat: Number, lng: Number, updatedAt: Date },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

