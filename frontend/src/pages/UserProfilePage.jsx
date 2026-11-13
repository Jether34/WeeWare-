import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { assetUrl } from '../api';
import { useAuth } from '../auth';
import ForumPage from './ForumPage';

const isPublic = (value) => value === true || value === 'true' || value === 1;

export default function UserProfilePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/users/${id}`, { headers: { 'Cache-Control': 'no-cache' } }).then(({ data }) => {
      if (active) { setProfile(data.user); setError(''); }
    }).catch((err) => {
      if (active) { setProfile(null); setError(err.message); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (loading) return <main className="page user-profile-page"><p className="muted" role="status">{t('Loading profile…')}</p></main>;
  if (error || !profile) return <main className="page user-profile-page"><section className="card empty-state"><h1>{t('Profile unavailable')}</h1><p>{error || t('This profile could not be found.')}</p><Link className="button secondary" to="/app/forum">{t('Back to community')}</Link></section></main>;

  const information = [
    ['Email', profile.email, profile.publicProfile?.email],
    ['Gender', profile.gender, profile.publicProfile?.gender],
    ['Birthday', profile.birthday ? new Date(profile.birthday).toLocaleDateString() : '', profile.publicProfile?.birthday],
    ['Phone', profile.phone, profile.publicProfile?.phone],
  ].filter(([, value, visible]) => isPublic(visible) && value);
  const profileId = String(profile._id || profile.id || '');
  const currentUserId = String(currentUser?.id || currentUser?._id || '');

  return <main className="page user-profile-page">
    <header className="public-profile-heading">
      <img className="public-profile-photo" src={assetUrl(profile.profilePicture) || '/assets/weeware.png'} alt={`${profile.fullName} profile`} loading="eager" fetchPriority="high" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} />
      <h1>{profile.fullName}</h1>
      <span className="public-profile-role">{t(profile.role)}</span>
      {profile.accountStatus === 'deactivated' && <span className="pill">{t('Deactivated account')}</span>}
      {profileId && profileId !== currentUserId && profile.accountStatus !== 'deactivated' && <Link className="button public-profile-message" to={`/app/messages?user=${encodeURIComponent(profileId)}`}>{t('Message')}</Link>}
    </header>
    <section className="public-profile-information">
      <article className="card public-profile-section"><h2>{t('Personal information')}</h2>
        {information.length ? <dl>{information.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl> : <p className="muted">{t('No additional personal information has been shared.')}</p>}
      </article>
      <article className="card public-profile-section"><h2>{t('Address')}</h2>
        {isPublic(profile.publicProfile?.address) && profile.address ? <p>{profile.address}</p> : <p className="muted">{t('No address has been shared.')}</p>}
      </article>
    </section>
    <section className="public-profile-posts"><div className="section-head"><h2>{t('Posts')}</h2></div>{profile.accountStatus === 'deactivated' ? <p className="card muted">{t('Posts are unavailable for deactivated accounts.')}</p> : <ForumPage profileId={profile._id} compact />}</section>
  </main>;
}
