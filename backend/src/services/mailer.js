const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter;
let verificationPromise;
let verificationExpiresAt = 0;
let verificationError = null;
function getTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.smtpFrom) {
    const error = new Error('Email delivery is not configured.');
    error.status = 503;
    throw error;
  }
  if (!transporter) transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return transporter;
}

async function verifyEmailTransport() {
  if (Date.now() < verificationExpiresAt) {
    if (verificationError) throw verificationError;
    return;
  }
  if (!verificationPromise) {
    verificationPromise = getTransporter().verify()
      .then(() => {
        verificationError = null;
        verificationExpiresAt = Date.now() + 30000;
      })
      .catch((error) => {
        verificationError = error;
        verificationExpiresAt = Date.now() + 5000;
        throw error;
      })
      .finally(() => { verificationPromise = null; });
  }
  await verificationPromise;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function emailFrame({ title, preheader, body, actionLabel, actionUrl, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;background:#f2f6f3;font-family:Arial,Helvetica,sans-serif;color:#173b2d"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f6f3;padding:36px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #dce8df;border-radius:14px;overflow:hidden"><tr><td style="padding:24px 32px;background:#155d41;color:#fff;font-size:22px;font-weight:700">WeeWare</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#173b2d">${escapeHtml(title)}</h1>${body}${actionUrl ? `<p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;background:#176b49;color:#fff;text-decoration:none;font-weight:700;border-radius:8px">${escapeHtml(actionLabel)}</a></p>` : ''}<p style="margin:28px 0 0;color:#718178;font-size:13px;line-height:1.6">${escapeHtml(footer)}</p></td></tr><tr><td style="padding:17px 32px;background:#f8faf8;color:#829087;font-size:12px">WeeWare · Palawan, Philippines</td></tr></table></td></tr></table></body></html>`;
}

async function sendSignupCode(email, code) {
  const html = emailFrame({ title: 'Verify your email address', preheader: 'Your WeeWare verification code', body: `<p style="font-size:15px;line-height:1.7;color:#46574d">Enter this verification code to complete your WeeWare account registration:</p><p style="margin:24px 0;padding:16px;text-align:center;background:#f1f7f2;border:1px solid #deeadf;border-radius:10px;font-size:30px;font-weight:700;letter-spacing:8px;color:#155d41">${escapeHtml(code)}</p><p style="font-size:14px;color:#59685f">This code expires in 10 minutes. If you did not request an account, you can ignore this message.</p>`, footer: 'For your security, do not share this verification code with anyone.' });
  await getTransporter().sendMail({ from: { name: env.smtpFromName, address: env.smtpFrom }, to: email, subject: 'Verify your WeeWare email address', text: `Your WeeWare verification code is ${code}. It expires in 10 minutes.`, html });
}

async function sendReactivationCode(email, code) {
  const html = emailFrame({ title: 'Reactivate your WeeWare account', preheader: 'Your WeeWare reactivation code', body: `<p style="font-size:15px;line-height:1.7;color:#46574d">Enter this verification code to reactivate your WeeWare account:</p><p style="margin:24px 0;padding:16px;text-align:center;background:#f1f7f2;border:1px solid #deeadf;border-radius:10px;font-size:30px;font-weight:700;letter-spacing:8px;color:#155d41">${escapeHtml(code)}</p><p style="font-size:14px;color:#59685f">This code expires in 10 minutes. If you did not request reactivation, you can ignore this message.</p>`, footer: 'For your security, do not share this verification code with anyone.' });
  await getTransporter().sendMail({ from: { name: env.smtpFromName, address: env.smtpFrom }, to: email, subject: 'Your WeeWare reactivation code', text: `Your WeeWare reactivation code is ${code}. It expires in 10 minutes.`, html });
}

async function sendPasswordReset(email, url) {
  const html = emailFrame({ title: 'Reset your password', preheader: 'A secure link to reset your WeeWare password', body: '<p style="font-size:15px;line-height:1.7;color:#46574d">We received a request to reset the password for your WeeWare account. Use the secure button below to choose a new password.</p><p style="font-size:14px;color:#59685f">This link expires in 30 minutes and can be used once. If you did not request a reset, no action is required.</p>', actionLabel: 'Reset password', actionUrl: url, footer: 'For your protection, this link is intended only for the account owner. Do not forward it.' });
  await getTransporter().sendMail({ from: { name: env.smtpFromName, address: env.smtpFrom }, to: email, subject: 'WeeWare password reset request', text: `Reset your WeeWare password using this link: ${url} . The link expires in 30 minutes. If you did not request this, ignore this email.`, html });
}

module.exports = { sendSignupCode, sendReactivationCode, sendPasswordReset, verifyEmailTransport };
