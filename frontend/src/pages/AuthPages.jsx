import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import LegalDialog from '../components/LegalDialog';
import DatePicker from '../components/DatePicker';
import StyledDropdown from '../components/StyledDropdown';

const languageOptions = [['en','English'],['tl','Tagalog'],['ceb','Cebuano'],['hil','Hiligaynon'],['krj','Kinaray-a'],['cyo','Cuyonon']].map(([value,label]) => ({ value, label, code: value.toUpperCase() }));
const latestAdultBirthDate = () => {
  const today = new Date();
  const year = today.getFullYear() - 18;
  const day = Math.min(today.getDate(), new Date(year, today.getMonth() + 1, 0).getDate());
  return `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
function EyeIcon({ visible }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/>{!visible && <path d="m4 4 16 16"/>}</svg>; }
function PasswordVisibilityButton({ visible, onClick, label }) { return <button className="password-visibility" type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick} aria-label={label} title={label}><EyeIcon visible={visible}/></button>; }

function VerificationCodeFields({ value, onChange }) {
  const inputs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] && value[index] !== ' ' ? value[index] : '');

  function distribute(start, rawValue) {
    const pasted = rawValue.replace(/\D/g, '').slice(0, 6 - start);
    if (!pasted) {
      const next = value.padEnd(6, ' ').split('');
      next[start] = '';
      onChange(next.join('').slice(0, 6));
      return;
    }
    const next = value.padEnd(6, ' ').split('');
    [...pasted].forEach((digit, offset) => { next[start + offset] = digit; });
    onChange(next.join('').slice(0, 6));
    inputs.current[Math.min(start + pasted.length, 5)]?.focus();
  }

  return <div className="verification-code-boxes" role="group" aria-label="Six-digit verification code">
    {digits.map((digit, index) => <input
      key={index}
      ref={(element) => { inputs.current[index] = element; }}
      id={index === 0 ? 'signup-code' : undefined}
      aria-label={`Verification digit ${index + 1}`}
      type="text"
      inputMode="numeric"
      autoComplete={index === 0 ? 'one-time-code' : 'off'}
      required
      maxLength={index === 0 ? 6 : 1}
      pattern="[0-9]"
      value={digit}
      onChange={(event) => distribute(index, event.target.value)}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData('text');
        if (/\d/.test(pasted)) { event.preventDefault(); distribute(index, pasted); }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Backspace' && !digit && index > 0) inputs.current[index - 1]?.focus();
        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); inputs.current[index - 1]?.focus(); }
        if (event.key === 'ArrowRight' && index < 5) { event.preventDefault(); inputs.current[index + 1]?.focus(); }
      }}
    />)}
  </div>;
}

function BrandLink() {
  return <Link to="/" className="auth-brand"><img src="/assets/weeware-vps-logo.png" alt=""/><span>WeeWare</span></Link>;
}

function AuthFrame({ children, policy, onClosePolicy }) {
  const { t } = useTranslation();
  return <main className="auth-page">
    <aside className="auth-visual"><div className="auth-visual-copy"><Link to="/" className="auth-visual-brand"><img src="/assets/weeware-vps-logo.png" alt=""/> WeeWare</Link><span className="auth-visual-kicker">{t('Puerto Princesa · Palawan')}</span><h1>{t('Local knowledge.')}<br/>{t('Better climate readiness.')}</h1><p>{t('Explore climate patterns and support careful monitoring of mango pulp weevil risk across Palawan.')}</p><div className="auth-visual-foot"><span>{t('CMIP6 climate data')}</span><i/><span>{t('LASSO regression')}</span></div></div></aside>
    <section className="auth-form-wrap"><div className="auth-form-panel">{children}</div></section>
    <LegalDialog type={policy} onClose={onClosePolicy}/>
  </main>;
}

function PolicyLinks({ open, prefix = 'By continuing, you agree to our' }) {
  const { t } = useTranslation();
  return <p className="auth-policy-copy">{t(prefix)} <button type="button" className="auth-policy-link" onClick={() => open('terms')}>{t('Terms of Service')}</button> {t('and')} <button type="button" className="auth-policy-link" onClick={() => open('privacy')}>{t('Privacy Policy')}</button>.</p>;
}

export function LoginPage() {
  const { t } = useTranslation();
  const { user, signIn } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [policy, setPolicy] = useState(null);
  const navigate = useNavigate();
  if (user) return <Navigate to="/app/prediction" replace/>;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await signIn(form); navigate('/app/prediction', { replace: true }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <AuthFrame policy={policy} onClosePolicy={() => setPolicy(null)}><div className="auth-content">
    <BrandLink/><div className="auth-heading"><span className="section-kicker">{t('WELCOME BACK')}</span><h2>{t('Sign in to WeeWare')}</h2><p>{t('Predict mango pulp weevil infestation in Puerto Princesa.')}</p></div>
    {error && <p className="error auth-error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor="login-email">{t('Email')}</label><input id="login-email" type="email" required autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></div>
      <div className="field"><label htmlFor="login-password">{t('Password')}</label><div className="auth-password"><input id="login-password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" placeholder={t('Enter your password')} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/><PasswordVisibilityButton visible={showPassword} onClick={() => setShowPassword((value) => !value)} label={showPassword ? t('Hide password') : t('Show password')}/></div></div>
      <button className="button auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <div className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></div>
    <PolicyLinks open={setPolicy}/><div className="auth-switch">{t('New to WeeWare?')} <Link to="/signup">{t('Create an account')}</Link></div>
  </div></AuthFrame>;
}

export function SignupPage() {
  const { user, signUp, verifySignup } = useAuth();
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [signupPayload, setSignupPayload] = useState(null);
  const [notice, setNotice] = useState('');
  const [policy, setPolicy] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState(() => ({ fullName: '', email: '', password: '', confirmPassword: '', gender: '', birthday: '', address: '', phone: '', language: localStorage.getItem('weeware-language') || i18n.resolvedLanguage || 'en', acceptedTerms: false }));
  if (user) return <Navigate to="/app" replace/>;
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const selectLanguage = (language) => { update('language', language); i18n.changeLanguage(language); localStorage.setItem('weeware-language', language); };
  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.password !== form.confirmPassword) { setError(t('passwordMismatch')); return; }
    if (!form.acceptedTerms) { setError(t('acceptPolicies')); return; }
    setBusy(true);
    try {
      const agent = navigator.userAgent || '';
      const signupDevice = {
        type: /tablet|ipad/i.test(agent) ? 'Tablet' : /mobile|android|iphone/i.test(agent) ? 'Mobile' : 'Desktop',
        platform: navigator.userAgentData?.platform || navigator.platform || '',
        userAgent: agent,
        language: navigator.language || '',
        screen: { width: window.screen?.width, height: window.screen?.height, pixelRatio: window.devicePixelRatio || 1 },
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
      };
      let signupLocation;
      if (navigator.geolocation) {
        const position = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
        ));
        if (position) signupLocation = position;
      }
      const payload = { ...form, signupDevice, ...(signupLocation ? { signupLocation } : {}) };
      await signUp(payload);
      setSignupPayload(payload);
      setCodeSent(true);
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function verifyCode(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await verifySignup({ email: form.email, code: verificationCode.replace(/\s/g, '') }); setSubmitted(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function resendCode() {
    if (!signupPayload) return;
    setBusy(true); setError(''); setNotice('');
    try { await signUp(signupPayload); setNotice('A new verification code has been sent.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <AuthFrame policy={policy} onClosePolicy={() => setPolicy(null)}><div className="auth-content signup-content">
    <BrandLink/>{submitted ? <div className="signup-success"><span className="success-mark">✓</span><span className="section-kicker">Email verified</span><h2>Your account is ready</h2><p>Your email has been verified. You can now sign in to WeeWare.</p><Link className="button auth-submit" to="/login">{t('goToSignIn')}</Link></div> : <>
      <div className="auth-heading"><span className="section-kicker">{t('joinCommunity')}</span><h2>{t('createAccountTitle')}</h2><p>{t('signupIntro')}</p></div>
      {error && <p className="error auth-error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {codeSent ? <form className="auth-form" onSubmit={verifyCode}><p className="auth-policy-copy">{t('codeExpires', { email: form.email })}</p><div className="field"><label htmlFor="signup-code">{t('verificationCode')}</label><VerificationCodeFields value={verificationCode} onChange={setVerificationCode}/></div><button className="button auth-submit" disabled={busy || verificationCode.replace(/\s/g, '').length !== 6}>{busy ? t('verifying') : t('verifyCreateAccount')}</button><button className="quiet-button" type="button" disabled={busy} onClick={resendCode}>{t('resendCode')}</button></form> : <form className="auth-form signup-form" onSubmit={submit}>
        <div className="field"><label htmlFor="signup-name">{t('fullName')}</label><input id="signup-name" required maxLength="100" autoComplete="name" placeholder={t('yourFullName')} value={form.fullName} onChange={(event) => update('fullName', event.target.value)}/></div>
        <div className="field"><label htmlFor="signup-email">{t('email')}</label><input id="signup-email" type="email" required autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(event) => update('email', event.target.value)}/></div>
        <div className="form-pair"><div className="field"><label htmlFor="signup-password">{t('password')}</label><div className="auth-password"><input id="signup-password" type={showPassword ? 'text' : 'password'} required minLength="8" autoComplete="new-password" placeholder={t('passwordHint')} value={form.password} onChange={(event) => update('password', event.target.value)}/><PasswordVisibilityButton visible={showPassword} onClick={() => setShowPassword((visible) => !visible)} label={showPassword ? t('hidePassword') : t('showPassword')}/></div></div><div className="field"><label htmlFor="signup-confirm">{t('confirmPassword')}</label><div className="auth-password"><input id="signup-confirm" type={showConfirmPassword ? 'text' : 'password'} required minLength="8" autoComplete="new-password" placeholder={t('confirmPasswordHint')} value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)}/><PasswordVisibilityButton visible={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)} label={showConfirmPassword ? t('hidePassword') : t('showPassword')}/></div></div></div>
        <div className="form-pair"><div className="field signup-gender-field"><label>{t('gender')} <span className="optional-label">{t('optional')}</span></label><StyledDropdown className="signup-gender-dropdown" label={t('gender')} value={form.gender} onChange={(value) => update('gender', value)} options={[{value:'',label:t('preferNotToSay')},{value:'Female',label:t('female')},{value:'Male',label:t('male')},{value:'Other',label:t('other')}]}/></div><div className="field date-picker-field signup-birthday-field"><label>{t('birthday')} <span className="optional-label">{t('optional')}</span></label><DatePicker value={form.birthday} min="1900-01-01" max={latestAdultBirthDate()} showToday={false} onChange={(value) => update('birthday', value)}/></div></div>
        <div className="field"><label htmlFor="signup-address">{t('address')} <span className="optional-label">{t('optional')}</span></label><input id="signup-address" autoComplete="street-address" placeholder={t('cityBarangay')} value={form.address} onChange={(event) => update('address', event.target.value)}/></div>
        <div className="signup-phone-language-row"><div className="field signup-phone-field"><label htmlFor="signup-phone">{t('phone')} <span className="optional-label">{t('optional')}</span></label><input id="signup-phone" type="tel" autoComplete="tel" placeholder={t('mobileNumber')} value={form.phone} onChange={(event) => update('phone', event.target.value)}/></div>
        <div className="signup-language-row"><span>{t('chooseLanguage')}</span><StyledDropdown className="signup-language-dropdown" label={t('chooseLanguage')} icon value={form.language} options={languageOptions} onChange={selectLanguage}/></div></div>
        <p className="signup-data-note">{t('signupDataNotice')}</p>
        <div className="consent-row"><input id="signup-consent" type="checkbox" required checked={form.acceptedTerms} onChange={(event) => update('acceptedTerms', event.target.checked)}/><span><label htmlFor="signup-consent">{t('agreeTo')} </label><button type="button" onClick={() => setPolicy('terms')}>{t('termsOfService')}</button> {t('and')} <button type="button" onClick={() => setPolicy('privacy')}>{t('privacyPolicy')}</button>.</span></div>
        <button className="button auth-submit" disabled={busy}>{busy ? t('submittingRequest') : t('createAccount')}</button>
      </form>}
      <div className="auth-switch">{t('alreadyHaveAccount')} <Link to="/login">{t('signIn')}</Link></div>
    </>}
  </div></AuthFrame>;
}

export function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await forgotPassword(email); setSent(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-content"><BrandLink/><div className="auth-heading"><span className="section-kicker">ACCOUNT SECURITY</span><h2>Forgot your password?</h2><p>Enter the email address associated with your WeeWare account. We’ll email a secure reset link if the account exists.</p></div>{error && <p className="error auth-error" role="alert">{error}</p>}{sent ? <p className="success" role="status">If an account matches that email, a password reset link will be sent shortly. Please check your inbox.</p> : <form className="auth-form" onSubmit={submit}><div className="field"><label htmlFor="forgot-email">Email address</label><input id="forgot-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></div><button className="button auth-submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button></form>}<div className="auth-switch"><Link to="/login">Return to sign in</Link></div></div></AuthFrame>;
}

export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const email = params.get('email') || '';
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setError('');
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try { await resetPassword({ email, token, password }); setComplete(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <AuthFrame><div className="auth-content"><BrandLink/><div className="auth-heading"><span className="section-kicker">ACCOUNT SECURITY</span><h2>Choose a new password</h2><p>Use a strong password with at least eight characters.</p></div>{error && <p className="error auth-error" role="alert">{error}</p>}{complete ? <><p className="success" role="status">Your password has been reset successfully.</p><Link className="button auth-submit" to="/login">Continue to sign in</Link></> : !email || !token ? <p className="error">This reset link is invalid. Request a new one.</p> : <form className="auth-form" onSubmit={submit}><div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" required minLength="8" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></div><div className="field"><label htmlFor="confirm-new-password">Confirm new password</label><input id="confirm-new-password" type="password" required minLength="8" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></div><button className="button auth-submit" disabled={busy}>{busy ? 'Updating…' : 'Reset password'}</button></form>}<div className="auth-switch"><Link to="/login">Return to sign in</Link></div></div></AuthFrame>;
}
