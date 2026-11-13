import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api, { assetUrl } from '../api';
import { useAuth } from '../auth';
import DatePicker from '../components/DatePicker';
import StyledDropdown from '../components/StyledDropdown';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyProfile = { fullName: '', email: '', gender: '', birthday: '', address: '', phone: '', profilePicture: '', publicProfile: { email: false, gender: false, birthday: false, address: false, phone: false } };

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(emptyProfile);
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' });
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [passwordBusy, setPasswordBusy] = useState(false);
  const [accountDialog, setAccountDialog] = useState(null); const [accountBusy, setAccountBusy] = useState(false);

  async function signOutToLanding() {
    try { await signOut(); }
    finally { navigate('/', { replace: true }); }
  }

  useEffect(() => {
    if (user) setProfile({ ...emptyProfile, ...user, publicProfile: { ...emptyProfile.publicProfile, ...(user.publicProfile || {}) }, birthday: user.birthday ? new Date(user.birthday).toISOString().slice(0, 10) : '' });
  }, [user]);
  useEffect(() => {
    if (!file) { setFilePreview(''); return undefined; }
    const url = URL.createObjectURL(file); setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const updateProfile = (key, value) => setProfile((old) => ({ ...old, [key]: value }));
  const updatePassword = (key, value) => setPasswords((old) => ({ ...old, [key]: value }));

  async function saveProfile(event) {
    event.preventDefault(); setBusy(true); setNotice(''); setError('');
    try {
      const fields = Object.fromEntries(['fullName', 'gender', 'birthday', 'address', 'phone'].map((key) => [key, profile[key] || '']));
      const payload = { ...fields, publicProfile: { ...emptyProfile.publicProfile, ...(profile.publicProfile || {}) } };
      let requestBody = payload;
      let config;
      if (file) {
        requestBody = new FormData();
        Object.entries(fields).forEach(([key, value]) => requestBody.append(key, value));
        requestBody.append('publicProfile', JSON.stringify(payload.publicProfile));
        requestBody.append('profilePicture', file);
        // Let the browser add the multipart boundary.
        config = {};
      }
      const { data } = await api.put('/users/me', requestBody, config);
      setUser({ ...data.user, id: data.user.id || data.user._id }); setNotice(t('Profile saved.')); setFile(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function changePassword(event) {
    event.preventDefault(); setPasswordBusy(true); setNotice(''); setError('');
    try {
      await api.put('/users/me/password', passwords);
      setPasswords({ newPassword: '', confirmPassword: '' });
      setNotice(t('Password changed.'));
    }
    catch (err) { setError(err.message); }
    finally { setPasswordBusy(false); }
  }
  async function deleteAccount() {
    setAccountBusy(true); setError('');
    try { await api.delete('/users/me'); await signOut(); navigate('/', { replace: true }); }
    catch (err) { setError(err.message); return false; }
    finally { setAccountBusy(false); }
  }
  async function deactivateAccount() {
    setAccountBusy(true); setError('');
    try { await api.post('/users/me/deactivate'); await signOut(); navigate('/', { replace: true }); }
    catch (err) { setError(err.message); return false; }
    finally { setAccountBusy(false); }
  }

  return <div className="page settings-page">
    <header className="settings-heading"><div><h1 className="page-title">{t('Profile settings')}</h1><p className="page-subtitle">{t('Manage your profile, password, and account.')}</p></div>{(notice || error) && <p className={error ? 'error settings-feedback' : 'success settings-feedback'} role="status">{error || notice}</p>}</header>
    <div className="settings-grid">
      <form className="card settings-card profile-settings-card" onSubmit={saveProfile}>
        <div className="settings-card-heading"><div><h2>{t('Edit profile')}</h2><p>{t('Update the information shown to other members.')}</p></div></div>
        <div className="settings-photo-row"><img src={filePreview || assetUrl(profile.profilePicture) || '/assets/weeware.png'} alt={t('Profile photo')}/><label className="field"><span>{t('Profile photo')}</span><input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] || null)}/></label></div>
        <div className="settings-fields-grid">
          <div className="field"><label>{t('Full name')}</label><input required maxLength="100" value={profile.fullName} onChange={(event) => updateProfile('fullName', event.target.value)}/></div>
          <div className="field"><label>{t('Email address')}</label><input type="email" readOnly value={profile.email}/></div>
          <div className="field settings-gender-field"><label>{t('Gender')}</label><StyledDropdown className="settings-gender-dropdown" value={profile.gender || 'Prefer not to say'} options={['Prefer not to say', 'Female', 'Male', 'Other'].map((value) => ({ value, label: t(value) }))} onChange={(value) => updateProfile('gender', value === 'Prefer not to say' ? '' : value)} label={t('Gender')}/></div>
          <div className="field date-picker-field"><label>{t('Birthday')}</label><DatePicker value={profile.birthday} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} showToday={false} onChange={(birthday) => updateProfile('birthday', birthday)}/></div>
          <div className="field"><label>{t('Phone')}</label><input value={profile.phone} onChange={(event) => updateProfile('phone', event.target.value)}/></div>
          <div className="field settings-address-field"><label>{t('Address')}</label><input value={profile.address} onChange={(event) => updateProfile('address', event.target.value)}/></div>
        </div>
        <fieldset className="profile-visibility"><legend>{t('Public profile')}</legend><p>{t('Choose which personal details other WeeWare members can see.')}</p>
          {['email', 'gender', 'birthday', 'address', 'phone'].map((field) => <label key={field}><input type="checkbox" checked={Boolean(profile.publicProfile?.[field])} onChange={(event) => setProfile((old) => ({ ...old, publicProfile: { ...old.publicProfile, [field]: event.target.checked } }))}/><span>{t(`Show ${field} on my public profile`)}</span></label>)}
        </fieldset>
        <button className="button save-profile-button" disabled={busy}>{busy ? t('Saving…') : t('Save profile')}</button>
      </form>

      <form className="card settings-card password-settings-card" onSubmit={changePassword}>
        <div className="settings-card-heading"><div><h2>{t('Change password')}</h2><p>{t('Choose a strong password you have not used before.')}</p></div></div>
        <div className="field"><label>{t('New password')}</label><input type="password" autoComplete="new-password" required minLength="8" value={passwords.newPassword} onChange={(event) => updatePassword('newPassword', event.target.value)}/></div>
        <div className="field"><label>{t('Confirm new password')}</label><input type="password" autoComplete="new-password" required minLength="8" value={passwords.confirmPassword} onChange={(event) => updatePassword('confirmPassword', event.target.value)}/></div>
        <button className="button secondary" disabled={passwordBusy}>{passwordBusy ? t('Updating…') : t('Update password')}</button>
      </form>

      <section className="card settings-card delete-settings-card"><div><h2>{t('Account controls')}</h2><p>{t('Deactivate to block sign-in, or permanently delete your profile and WeeWare activity. Deletion cannot be undone.')}</p></div><div className="row"><button className="button secondary" onClick={() => setAccountDialog('deactivate')}>{t('Deactivate account')}</button><button className="button danger" onClick={() => setAccountDialog('delete')}>{t('Delete my account')}</button></div></section>
    </div>
    <button type="button" className="button secondary mobile-settings-signout" onClick={signOutToLanding}>{t('signOut')}</button>
    <ConfirmDialog open={Boolean(accountDialog)} title={accountDialog === 'delete' ? t('Delete your account?') : t('Deactivate your account?')} variant="danger" confirmLabel={accountDialog === 'delete' ? t('Delete account') : t('Deactivate account')} cancelLabel={t('Cancel')} onConfirm={accountDialog === 'delete' ? deleteAccount : deactivateAccount} onClose={() => setAccountDialog(null)} busy={accountBusy}>
      {accountDialog === 'delete' ? <><p>{t('This permanently deletes your profile, predictions, saved reports, messages, posts, and comments.')}</p><p>{t('This action cannot be undone.')}</p></> : <><p>{t('Your account will be signed out and hidden from community posts. Other people will not be able to message you.')}</p><p>{t('To reactivate, sign in with your email and password, then enter the verification code sent to your email.')}</p></>}
    </ConfirmDialog>
  </div>;
}
