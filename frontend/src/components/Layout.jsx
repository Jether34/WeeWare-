import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import api from '../api';
import { io } from 'socket.io-client';

const nav = [
  ['/app/prediction', 'prediction', '◉'], ['/app/history', 'history', '◷'], ['/app/saved', 'saved', '☆'], ['/app/forum', 'forum', '◎'], ['/app/messages', 'messages', '✉'], ['/app/settings', 'settings', '⚙'],
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notificationWrapRef = useRef(null);
  const navigate = useNavigate();
  const visibleNav = [...nav.filter(([to]) => to !== '/app/settings'), ['/app/ai', 'AI assistant', '✦'], ...(user?.role === 'researcher' ? [['/app/system-iteration', 'System iteration', '⌁']] : []), ...(user?.role === 'admin' ? [['/app/admin', 'adminDashboard', '▦']] : []), ...(user?.role === 'da' ? [['/app/da', 'daDashboard', '▥']] : []), nav.find(([to]) => to === '/app/settings')];
  useEffect(() => {
    api.get('/notifications').then(({ data }) => setUnread(data.unreadCount || 0)).catch(() => {});
    const socket = io('/', { path: '/socket.io', withCredentials: true });
    socket.on('notification:new', () => {
      api.get('/notifications').then(({ data }) => { setNotifications(data.notifications || []); setUnread(data.unreadCount || 0); }).catch(() => setUnread((value) => value + 1));
    });
    return () => socket.disconnect();
  }, []);
  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const closeOnOutsideInteraction = (event) => {
      if (!notificationWrapRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setNotificationsOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);
  const toggleNotifications = () => {
    if (notificationsOpen) { setNotificationsOpen(false); return; }
    setNotificationsOpen(true);
    setNotificationsLoading(true);
    api.get('/notifications').then(({ data }) => {
      setNotifications(data.notifications || []);
      setUnread(data.unreadCount || 0);
    }).catch(() => {}).finally(() => setNotificationsLoading(false));
  };
  const markAllRead = async () => { try { await api.patch('/notifications/read', {}); setNotifications((rows) => rows.map((item) => ({ ...item, isRead: true }))); setUnread(0); } catch {} };
  const openNotification = async (item) => {
    try { await api.patch('/notifications/read', { id: item._id }); } catch {}
    setNotifications((rows) => rows.map((row) => row._id === item._id ? { ...row, isRead: true } : row));
    setUnread((count) => Math.max(0, count - (item.isRead ? 0 : 1)));
    setNotificationsOpen(false);
    if (item.post?._id) navigate(`/app/forum?post=${item.post._id}${item.comment?._id ? `&comment=${item.comment._id}` : ''}`);
    else navigate('/app/forum');
  };
  const notificationText = (type) => t(({ like: 'liked your post', comment_like: 'liked your comment', reply: 'replied to your comment', comment: 'commented on your post', post_approved: 'approved your post', post_rejected: 'did not approve your post', post_delete_approved: 'approved your post deletion request', post_delete_rejected: 'rejected your post deletion request', comment_delete_approved: 'approved your comment deletion request', comment_delete_rejected: 'rejected your comment deletion request', post_removed: 'removed your post', comment_removed: 'removed your comment' }[type] || 'interacted with your post'));
  return <div className="app-shell">
    <header className="topbar">
      <NavLink to="/app/prediction" className="brand"><img src="/assets/weeware-vps-logo.png" alt="" /><span>WeeWare</span></NavLink>
      <div className="top-actions">
        <div className="notification-wrap" ref={notificationWrapRef}><button className={`notification-button ${notificationsOpen ? 'is-open' : ''}`} aria-expanded={notificationsOpen} onClick={toggleNotifications} aria-label={t('Notifications')} title={t('Notifications')}><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c-8.1 0-14 6.2-14 14.6v8.1c0 3.1-1.2 5.7-3.5 7.7-.9.8-.3 2.3.9 2.3h33.2c1.2 0 1.8-1.5.9-2.3-2.3-2-3.5-4.6-3.5-7.7v-8.1C38 10.2 32.1 4 24 4Zm-5.4 36.2a5.6 5.6 0 0 0 10.8 0H18.6Z" /></svg>{unread > 0 && <b className="notification-count">{unread > 99 ? '99+' : unread}</b>}</button>{notificationsOpen && <section className="notification-menu"><div className="section-head"><strong>{t('Notifications')}</strong><button className="quiet-button" onClick={markAllRead}>{t('Mark all read')}</button></div>{notificationsLoading && notifications.length === 0 ? <p className="muted" role="status">{t('Loading notifications…')}</p> : notifications.length ? notifications.map((item) => <button type="button" className={`notification-row ${item.isRead ? '' : 'unread'}`} key={item._id} onClick={() => openNotification(item)}><strong>{item.actor?.fullName || t('A community member')}</strong> {notificationText(item.type)}<small>{new Date(item.createdAt).toLocaleString()}</small></button>) : <p className="muted">{t('No notifications yet.')}</p>}</section>}</div>
        <button className="user-chip" onClick={() => navigate('/app/settings')} aria-label={t('Edit profile')} title={t('Edit profile')}><span>{user?.fullName?.split(' ')[0]}</span></button>
        <button className="quiet-button" onClick={async () => { try { await signOut(); } finally { navigate('/', { replace: true }); } }}>{t('signOut')}</button>
      </div>
    </header>
    <div className="app-frame"><aside className="sidebar">{visibleNav.map(([to, key, icon]) => <NavLink key={to} to={to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><span className="side-icon">{icon}</span><span>{t(key, { defaultValue: key === 'messages' ? t('Messages') : key === 'adminDashboard' ? t('Admin dashboard') : key === 'daDashboard' ? t('DA dashboard') : key })}</span></NavLink>)}<div className="sidebar-foot">{t('Palawan Island')}<br />{t('Philippines')}</div></aside><main className="main-content"><Outlet /></main></div>
    <nav className="mobile-bottom-nav" aria-label={t('Main navigation')}>
      <NavLink to="/app/prediction" end aria-label={t('prediction')} title={t('prediction')} className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" /></svg></NavLink>
      <NavLink to="/app/ai" aria-label={t('AI assistant')} title={t('AI assistant')} className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8zM5 2l.7 2.3L8 5l-2.3.7L5 8l-.7-2.3L2 5l2.3-.7z" /></svg></NavLink>
      <NavLink to="/app/forum" aria-label={t('forum')} title={t('forum')} className={({ isActive }) => `mobile-bottom-create ${isActive ? 'active' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19zM16 5.3a3 3 0 0 1 0 5.8M17 13h.7a3.8 3.8 0 0 1 3.8 3.8V19h-4" /></svg></NavLink>
      <NavLink to="/app/messages" aria-label={t('messages')} title={t('messages')} className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-3A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 10h8M8 13h5" /></svg></NavLink>
      <NavLink to="/app/settings" aria-label={t('settings')} title={t('settings')} className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4l.7 2.3a8 8 0 0 1 1.7.9l2.3-.7 2 3.5-1.7 1.7a8 8 0 0 1 0 2l1.7 1.7-2 3.5-2.3-.7a8 8 0 0 1-1.7.9L14 20h-4l-.7-2.3a8 8 0 0 1-1.7-.9l-2.3.7-2-3.5L5 12.3a8 8 0 0 1 0-2L3.3 8.6l2-3.5 2.3.7a8 8 0 0 1 1.7-.9L10 2Z" /><circle cx="12" cy="11.3" r="2.7" /></svg></NavLink>
    </nav>
  </div>;
}
