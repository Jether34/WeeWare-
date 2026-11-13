const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AuthChallenge = require('../models/AuthChallenge');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { sendSignupCode, sendPasswordReset, verifyEmailTransport } = require('../services/mailer');

const router = express.Router();
const emailPattern = /^\S+@\S+\.\S+$/;
const asSignupProfile = (body) => {
  return {
    fullName: String(body.fullName || body.name || '').trim(),
    passwordHash: '',
    language: 'en',
    acceptedTerms: true, role: 'farmer', accountStatus: 'approved',
  };
};
function makeSignupData(body, req) {
  const data = asSignupProfile(body);
  data.passwordHash = body.passwordHash;
  return data;
}
function verifySignupForm(body) {
  const name = String(body.fullName || body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!name || name.length > 100) return { error: 'Enter your name (up to 100 characters).' };
  if (!emailPattern.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (password.length < 8 || password.length > 128) return { error: 'Password must be at least 8 characters.' };
  if (body.confirmPassword !== undefined && password !== body.confirmPassword) return { error: 'Passwords do not match.' };
  if (body.acceptedTerms !== true && body.acceptedTerms !== 'true' && body.acceptedTerms !== '1') return { error: 'Accept the terms to create an account.' };
  return { email, password, name };
}
const safeUser = (user) => ({ id: user._id, fullName: user.fullName, email: user.email, gender: user.gender, birthday: user.birthday, address: user.address, phone: user.phone, language: user.language, profilePicture: user.profilePicture, publicProfile: user.publicProfile, role: user.role, acceptedTerms: user.acceptedTerms });
function setSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  res.cookie('weeware_token', token, { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

router.post('/signup', async (req, res, next) => {
  try {
    const checked = verifySignupForm(req.body);
    if (checked.error) return res.status(400).json({ success: false, message: checked.error });
    if (await User.exists({ email: checked.email })) return res.status(409).json({ success: false, message: 'An account already uses that email.' });
    const existing = await AuthChallenge.findOne({ email: checked.email, purpose: 'signup' });
    if (existing && Date.now() - existing.lastSentAt.getTime() < 30000) return res.status(429).json({ success: false, message: 'Please wait before requesting another verification code.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const payload = makeSignupData(req.body, req);
    payload.passwordHash = await bcrypt.hash(checked.password, 12);
    const challenge = await AuthChallenge.findOneAndUpdate({ email: checked.email, purpose: 'signup' }, {
      email: checked.email, purpose: 'signup', codeHash: await bcrypt.hash(code, 10), tokenHash: '', payload, attempts: 0, lastSentAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    try { await sendSignupCode(checked.email, code); }
    catch (error) { await challenge.deleteOne(); throw error; }
    res.status(200).json({ success: true, verificationRequired: true, message: 'A verification code has been sent to your email address.' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account already uses that email.' });
    next(error);
  }
});

router.post('/signup/verify', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!emailPattern.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the six-digit code sent to your email.' });
    const challenge = await AuthChallenge.findOne({ email, purpose: 'signup', expiresAt: { $gt: new Date() } });
    if (!challenge) return res.status(400).json({ success: false, message: 'This code has expired. Request a new one.' });
    if (challenge.attempts >= 5) { await challenge.deleteOne(); return res.status(429).json({ success: false, message: 'Too many incorrect codes. Request a new one.' }); }
    if (!(await bcrypt.compare(code, challenge.codeHash))) {
      challenge.attempts += 1; await challenge.save();
      return res.status(400).json({ success: false, message: 'The verification code is incorrect.' });
    }
    if (await User.exists({ email })) { await challenge.deleteOne(); return res.status(409).json({ success: false, message: 'An account already uses that email.' }); }
    await User.create({ ...challenge.payload, email, accountStatus: 'approved' });
    await challenge.deleteOne();
    res.status(201).json({ success: true, message: 'Your email is verified and your account is ready. You can now sign in.' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'An account already uses that email.' });
    next(error);
  }
});

router.post('/password/forgot', async (req, res, next) => {
  const generic = { success: true, message: 'If an account matches that email, a password reset link will be sent.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!emailPattern.test(email)) return res.json(generic);
    try {
      // Run the same provider-availability check before any account lookup so
      // this service-wide error cannot reveal whether an address is registered.
      await verifyEmailTransport();
    } catch (error) {
      console.error('[auth] password reset mail transport unavailable:', error.code || error.responseCode || error.message);
      return res.status(503).json({ success: false, message: 'Password reset email is temporarily unavailable. Please try again later.' });
    }
    let resetPageUrl;
    try {
      resetPageUrl = new URL('/reset-password', env.frontendUrl);
      if (!['http:', 'https:'].includes(resetPageUrl.protocol)) throw new Error('FRONTEND_URL must use HTTP or HTTPS.');
    } catch (error) {
      console.error('[auth] password reset link origin is invalid:', error.message);
      return res.status(503).json({ success: false, message: 'Password reset email is temporarily unavailable. Please try again later.' });
    }
    const user = await User.findOne({ email }).select('_id email');
    if (!user) return res.json(generic);
    const existing = await AuthChallenge.findOne({ email, purpose: 'password_reset' }).lean();
    if (existing?.lastSentAt && Date.now() - new Date(existing.lastSentAt).getTime() < 30000) return res.json(generic);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await AuthChallenge.findOneAndUpdate({ email, purpose: 'password_reset' }, {
      email, purpose: 'password_reset', codeHash: '', tokenHash, payload: null, attempts: 0, lastSentAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const link = resetPageUrl;
    link.searchParams.set('email', email); link.searchParams.set('token', token);
    try {
      await sendPasswordReset(email, link.toString());
    } catch (error) {
      // Do not leave an unusable token behind, and preserve a prior valid link
      // if this resend failed after replacing its challenge.
      try {
        if (existing) {
          const { _id, __v, createdAt, updatedAt, ...previousChallenge } = existing;
          await AuthChallenge.updateOne({ _id: existing._id, tokenHash }, { $set: previousChallenge });
        } else await AuthChallenge.findOneAndDelete({ email, purpose: 'password_reset', tokenHash });
      } catch (rollbackError) {
        console.error('[auth] password reset challenge cleanup failed:', rollbackError.code || rollbackError.message);
      }
      console.error('[auth] password reset email delivery failed:', error.code || error.responseCode || error.message);
      return res.json(generic);
    }
    res.json(generic);
  } catch (error) {
    next(error);
  }
});

router.post('/password/reset', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (!emailPattern.test(email) || token.length < 32 || password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: 'The reset link or new password is invalid.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const challenge = await AuthChallenge.findOne({ email, purpose: 'password_reset', tokenHash, expiresAt: { $gt: new Date() } });
    if (!challenge) return res.status(400).json({ success: false, message: 'This password reset link has expired or was already used. Request a new link.' });
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) { await challenge.deleteOne(); return res.status(400).json({ success: false, message: 'This password reset link is no longer valid.' }); }
    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    await challenge.deleteOne();
    res.json({ success: true, message: 'Your password has been reset. You can now sign in.' });
  } catch (error) { next(error); }
});

router.post('/login', async (req, res, next) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    if (user.accountStatus === 'deactivated') return res.status(403).json({ success: false, message: 'This account is deactivated. Contact support to restore access.' });
    setSession(res, user);
    res.json({ success: true, user: safeUser(user) });
  } catch (error) { next(error); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(401).json({ success: false, message: 'Account not found.' });
    res.json({ success: true, user: safeUser(user) });
  } catch (error) { next(error); }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('weeware_token', { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'lax' });
  res.json({ success: true });
});

module.exports = router;

