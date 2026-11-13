import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import api, { assetUrl } from '../api';
import DatePicker from '../components/DatePicker';
import { useTranslation } from 'react-i18next';

const tabs = [['overview', 'Overview'], ['users', 'Users'], ['moderation', 'Forum review'], ['topology', 'Live topology'], ['traffic', 'Traffic monitor'], ['conversations', 'Conversations'], ['schema', 'Database schema'], ['config', 'System configuration']];
const roles = ['farmer', 'researcher', 'da', 'admin'];
const statusClass = (status) => status === 'online' ? 'admin-status online' : status === 'degraded' ? 'admin-status degraded' : 'admin-status offline';
const shortTime = (value) => value ? new Date(value).toLocaleString() : 'No traffic yet';
const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;

function Metric({ label, value, detail }) { return <article className="admin-metric"><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail}</small></article>; }

function ReviewPreview({ label, post, requester, comment, createdAt }) {
  const media = post?.media || [];
  return <article className="review-preview-card">
    <header className="review-preview-header">
      <img src={assetUrl(requester?.profilePicture || post?.author?.profilePicture) || '/assets/weeware.png'} alt="" />
      <div><strong>{requester?.fullName || post?.author?.fullName || 'Community member'}</strong><small>{label} · {shortTime(createdAt || post?.createdAt)}</small></div>
    </header>
    {post && <section className="review-target-post"><div className="review-target-label">{comment ? 'Original post' : 'Post preview'}</div><p>{post.content || 'No text in this post.'}</p>{media.length > 0 && <div className="review-preview-media">{media.map((item, index) => item.type === 'video' ? <video key={`${item.url}-${index}`} controls preload="metadata" src={assetUrl(item.url)} /> : <img key={`${item.url}-${index}`} src={assetUrl(item.url)} alt="Post attachment" loading="lazy" />)}</div>}</section>}
    {comment && <section className="review-target-comment"><div className="review-target-label">Comment requested for deletion · {comment.author?.fullName || 'Community member'}</div><p>{comment.content || 'Comment content unavailable.'}</p></section>}
    {!post && !comment && <p className="review-preview-content">Preview unavailable.</p>}
  </article>;
}

function Topology({ health, onMonitor }) {
  const flows = health?.traffic?.flows || {};
  const recent = health?.traffic?.recent || [];
  const edges = [
    { key: 'Web client->WeeWare API', label: 'Web client → API', x1: 260, y1: 170, x2: 390, y2: 170, lx: 325, ly: 140 },
    { key: 'WeeWare API->MongoDB', label: 'API → MongoDB', x1: 600, y1: 145, x2: 730, y2: 105, lx: 665, ly: 101 },
    { key: 'WeeWare API->Climate / LASSO service', label: 'API → CMIP6 / LASSO', x1: 600, y1: 195, x2: 730, y2: 275, lx: 665, ly: 252 },
  ];
  return <>
    <div className="topology-legend"><span><i className="traffic-live-dot" /> Live request and service events</span><span>Counts since API startup · payloads are not recorded</span></div>
    <div className="topology-canvas"><svg viewBox="0 0 1000 380" role="img" aria-label="Live topology from web client to API, database, and climate model">
      <defs><marker id="traffic-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 9 4.5 0 9Z" fill="#7ca68a" /></marker></defs>
      {edges.map((edge) => { const flow = flows[edge.key] || {}; const live = recent.some((event) => event.source + '->' + event.destination === edge.key && Date.now() - new Date(event.at).getTime() < 6000); return <g key={edge.key} className={live ? 'topology-edge live' : 'topology-edge'}><path d={`M${edge.x1} ${edge.y1} L${edge.x2} ${edge.y2}`} markerEnd="url(#traffic-arrow)"/><text x={edge.lx} y={edge.ly} textAnchor="middle">{edge.label}</text><text className="topology-count" x={edge.lx} y={edge.ly + 18} textAnchor="middle">{flow.count || 0} events · avg {flow.averageDurationMs || 0} ms</text></g>; })}
      <g className="topology-node" transform="translate(35 125)"><rect width="225" height="90" rx="15"/><text x="112" y="37" textAnchor="middle">Web frontend</text><text className="node-detail" x="112" y="61" textAnchor="middle">React · user browser</text></g>
      <g className="topology-node api-node" transform="translate(390 125)"><rect width="210" height="90" rx="15"/><text x="105" y="37" textAnchor="middle">WeeWare API</text><text className="node-detail" x="105" y="61" textAnchor="middle">Node.js · Express</text></g>
      <g className="topology-node" transform="translate(730 55)"><rect width="225" height="90" rx="15"/><text x="112" y="37" textAnchor="middle">MongoDB</text><text className="node-detail" x="112" y="61" textAnchor="middle">Persistent application data</text></g>
      <g className="topology-node ml-node" transform="translate(730 230)"><rect width="225" height="90" rx="15"/><text x="112" y="37" textAnchor="middle">Climate / LASSO</text><text className="node-detail" x="112" y="61" textAnchor="middle">Python · CMIP6 service</text></g>
    </svg></div>
    <p className="muted">See the <button type="button" className="text-link" onClick={onMonitor}>traffic monitor</button> for recorded request and service events.</p>
  </>;
}

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('overview');
  const [metrics, setMetrics] = useState(null); const [health, setHealth] = useState(null); const [config, setConfig] = useState(null);
  const [users, setUsers] = useState([]); const [conversations, setConversations] = useState([]); const [schema, setSchema] = useState([]);
  const [moderationPosts, setModerationPosts] = useState([]); const [deletionRequests, setDeletionRequests] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0); const [userPage, setUserPage] = useState(1); const [query, setQuery] = useState(''); const [trafficQuery, setTrafficQuery] = useState(''); const [moderationQuery, setModerationQuery] = useState(''); const [conversationQuery, setConversationQuery] = useState('');
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'farmer' });
  const [editingUser, setEditingUser] = useState(null); const [editPhoto, setEditPhoto] = useState(null);
  const [expandedConversation, setExpandedConversation] = useState(''); const [conversationMessages, setConversationMessages] = useState({}); const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationSearchLoading, setConversationSearchLoading] = useState(false);
  const conversationMessagesRef = useRef(conversationMessages); conversationMessagesRef.current = conversationMessages;
  const conversationSearchRun = useRef(0);
  const expandedConversationRef = useRef(expandedConversation); expandedConversationRef.current = expandedConversation;
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations;
  const reloadConversationRef = useRef(null);

  const loadUsers = useCallback(async (q = '', page = 1) => {
    try { const { data } = await api.get('/system/admin/users', { params: { q, page, limit: 100 } }); setUsers(data.users || []); setTotalUsers(data.total || 0); setUserPage(data.page || page); }
    catch (e) { setError(e.message); }
  }, []);
  const loadHealth = useCallback(async () => { try { const { data } = await api.get('/system/admin/health'); setHealth(data); } catch (e) { setError(e.message); } }, []);
  const loadBase = useCallback(async () => { try { const [overview, systemConfig] = await Promise.all([api.get('/system/admin/overview'), api.get('/system/admin/config')]); setMetrics(overview.data.metrics); setConfig(systemConfig.data.config); setError(''); } catch (e) { setError(e.message); } }, []);
  const loadAdminViews = useCallback(async () => { try { const [chatData, schemaData] = await Promise.all([api.get('/system/admin/conversations'), api.get('/system/admin/schema')]); setConversations(chatData.data.conversations || []); setSchema(schemaData.data.collections || []); } catch (e) { setError(e.message); } }, []);
  const loadModeration = useCallback(async () => { try { const { data } = await api.get('/moderation/admin/queue'); setModerationPosts(data.posts || []); setDeletionRequests(data.deletions || []); } catch (e) { setError(e.message); } }, []);

  useEffect(() => {
    const needle = conversationQuery.trim();
    if (needle.length < 2 || !conversations.length) { setConversationSearchLoading(false); return; }
    const run = ++conversationSearchRun.current;
    let active = true;
    const timer = setTimeout(async () => {
      setConversationSearchLoading(true);
      try {
        const missing = conversations.filter((conversation) => {
          const key = conversation.participants.map((person) => String(person._id)).sort().join(':');
          return !conversationMessagesRef.current[key];
        });
        for (let index = 0; index < missing.length; index += 4) {
          const batch = missing.slice(index, index + 4);
          const results = await Promise.all(batch.map(async (conversation) => {
            const ids = conversation.participants.map((person) => String(person._id));
            const key = [...ids].sort().join(':');
            try {
              const { data } = await api.get(`/system/admin/conversations/${ids[0]}/${ids[1]}/messages`);
              const readable = (data.messages || []).map((item) => ({ ...item, plaintext: item.content || (item.legacyUnavailable ? 'Older message unavailable in the current messaging format.' : '') }));
              return [key, readable];
            } catch { return [key, []]; }
          }));
          if (!active || conversationSearchRun.current !== run) return;
          setConversationMessages((current) => {
            const next = { ...current };
            results.forEach(([key, rows]) => { next[key] = rows; });
            conversationMessagesRef.current = next;
            return next;
          });
        }
      } catch (e) { if (active && conversationSearchRun.current === run) setError(e.message); }
      finally { if (active && conversationSearchRun.current === run) setConversationSearchLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [conversationQuery, conversations]);

  useEffect(() => {
    loadBase(); loadUsers(); loadHealth(); loadAdminViews(); loadModeration();
    const timer = setInterval(loadHealth, 3000);
    const moderationTimer = setInterval(loadModeration, 5000);
    const socket = io('/', { path: '/socket.io', withCredentials: true });
    socket.on('admin:traffic', ({ event, flow, totalEvents }) => {
      setHealth((old) => {
        if (!old) return old;
        const key = `${event.source}->${event.destination}`;
        const traffic = old.traffic || {};
        return { ...old, traffic: { ...traffic, totalEvents, flows: { ...traffic.flows, [key]: flow }, recent: [event, ...(traffic.recent || []).filter((item) => item.id !== event.id)].slice(0, 1000) } };
      });
    });
    socket.on('moderation:pending', loadModeration);
    socket.on('admin:conversation-new', ({ senderId, recipientId }) => {
      loadAdminViews();
      const key = [String(senderId), String(recipientId)].sort().join(':');
      if (expandedConversationRef.current === key) {
        const thread = conversationsRef.current.find((row) => row.participants.map((participant) => String(participant._id)).sort().join(':') === key);
        if (thread) reloadConversationRef.current?.(thread);
      }
    });
    return () => { clearInterval(timer); clearInterval(moderationTimer); socket.disconnect(); };
  }, [loadBase, loadHealth, loadUsers, loadAdminViews, loadModeration]);

  async function decidePublication(post, status) { try { await api.patch(`/moderation/admin/posts/${post._id}/publication`, { status }); setModerationPosts((rows) => rows.filter((row) => row._id !== post._id)); setMessage(`Post ${status}. The author was notified.`); } catch (e) { setError(e.message); } }
  async function decideDeletion(request, status) { try { await api.patch(`/moderation/admin/deletions/${request._id}`, { status }); setDeletionRequests((rows) => rows.filter((row) => row._id !== request._id)); setMessage(`Deletion request ${status}. The requester was notified.`); } catch (e) { setError(e.message); } }
  async function adminRemove(kind, item) { const id = kind === 'post' ? item._id : item.comment?._id; if (!id || !window.confirm(`Remove this ${kind} immediately? Its author will be notified.`)) return; try { await api.delete(`/moderation/admin/content/${kind}/${id}`); await loadModeration(); setMessage(`${kind === 'post' ? 'Post' : 'Comment'} removed. The author was notified.`); } catch (e) { setError(e.message); } }

  async function updateRole(user, role) { try { const { data } = await api.patch(`/system/admin/users/${user._id}/role`, { role }); setUsers((rows) => rows.map((row) => row._id === user._id ? { ...row, role: data.user.role } : row)); setMessage(`${user.fullName} is now ${role}.`); } catch (e) { setError(e.message); } }
  async function addUser(event) { event.preventDefault(); try { const { data } = await api.post('/system/admin/users', newUser); setUsers((rows) => [data.user, ...rows]); setTotalUsers((n) => n + 1); setNewUser({ fullName: '', email: '', password: '', role: 'farmer' }); setMessage('User account created.'); } catch (e) { setError(e.message); } }
  function editUser(user) { setEditingUser({ ...user, birthday: user.birthday ? new Date(user.birthday).toISOString().slice(0, 10) : '', password: '' }); setEditPhoto(null); setError(''); }
  async function saveUserEdit(event) {
    event.preventDefault();
    try {
      const body = new FormData();
      ['fullName', 'email', 'gender', 'birthday', 'address', 'phone', 'language', 'role'].forEach((key) => body.append(key, editingUser[key] ?? ''));
      body.append('acceptedTerms', String(Boolean(editingUser.acceptedTerms)));
      if (editingUser.password) body.append('password', editingUser.password);
      if (editPhoto) body.append('profilePicture', editPhoto);
      const { data } = await api.patch(`/system/admin/users/${editingUser._id}`, body);
      setUsers((rows) => rows.map((row) => row._id === editingUser._id ? { ...row, ...data.user } : row)); setEditingUser(null); setMessage('User information updated.');
    } catch (e) { setError(e.message); }
  }
  async function deleteUser(user) { if (!window.confirm(`Delete ${user.fullName} and their account record?`)) return; try { await api.delete(`/system/admin/users/${user._id}`); setUsers((rows) => rows.filter((row) => row._id !== user._id)); setTotalUsers((n) => Math.max(0, n - 1)); setMessage('User account deleted.'); } catch (e) { setError(e.message); } }
  async function loadTraffic() { try { const { data } = await api.get('/system/admin/traffic'); setHealth((old) => ({ ...(old || {}), traffic: data.traffic })); } catch (e) { setError(e.message); } }
  async function reloadConversation(conversation) {
    const ids = conversation.participants.map((participant) => String(participant._id));
    const key = [...ids].sort().join(':');
    setConversationBusy(true); setError('');
    try {
      const { data } = await api.get(`/system/admin/conversations/${ids[0]}/${ids[1]}/messages`);
      const readable = (data.messages || []).map((item) => ({ ...item, plaintext: item.content || (item.legacyUnavailable ? 'Older message unavailable in the current messaging format.' : '') }));
      setConversationMessages((current) => ({ ...current, [key]: readable }));
    } catch (e) { setError(e.message); }
    finally { setConversationBusy(false); }
  }
  reloadConversationRef.current = reloadConversation;
  async function openConversation(conversation) {
    const key = conversation.participants.map((participant) => String(participant._id)).sort().join(':');
    if (expandedConversation === key) return;
    setExpandedConversation(key);
    await reloadConversation(conversation);
  }
  const trafficRows = (health?.traffic?.recent || []).filter((event) => `${event.source} ${event.destination} ${event.label} ${event.status}`.toLowerCase().includes(trafficQuery.toLowerCase()));
  const moderationNeedle = moderationQuery.trim().toLowerCase();
  const visibleModerationPosts = moderationPosts.filter((post) => `${post.author?.fullName || ''} ${post.author?.email || ''} ${post.content || ''}`.toLowerCase().includes(moderationNeedle));
  const visibleDeletionRequests = deletionRequests.filter((request) => `${request.requester?.fullName || ''} ${request.requester?.email || ''} ${request.post?.author?.fullName || ''} ${request.post?.content || ''} ${request.comment?.content || ''} ${request.kind || ''}`.toLowerCase().includes(moderationNeedle));
  const conversationNeedle = conversationQuery.trim().toLowerCase();
  const visibleConversations = conversations.filter((conversation) => `${conversation.participants.map((person) => `${person.fullName || ''} ${person.email || ''} ${person.role || ''}`).join(' ')} ${conversation.messageCount || ''} ${conversation.latestAt || ''} ${conversationMessages[conversation.participants.map((person) => String(person._id)).sort().join(':')]?.map((item) => item.plaintext || '').join(' ') || ''}`.toLowerCase().includes(conversationNeedle));
  const performance = health?.performance;

  return <div className="page admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{t('WEEWARE CONTROL CENTER')}</span><h1>{t('Admin dashboard')}</h1><p>{t('Accounts, services, and activity.')}</p></div><span className="admin-role-chip">{t('Administrator')}</span></header>
    <nav className="admin-tabs" aria-label={t('Admin dashboard sections')}>{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); if (key === 'traffic') loadTraffic(); if (key === 'conversations' || key === 'schema') loadAdminViews(); }}>{t(label)}</button>)}</nav>
    {error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}
    {tab === 'moderation' && <>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Posts awaiting publication approval</h2><p>{visibleModerationPosts.length} of {moderationPosts.length} post(s) waiting for review. Approved posts enter the randomly ordered community feed.</p></div><div className="admin-review-tools"><input className="admin-user-search" type="search" value={moderationQuery} onChange={(event) => setModerationQuery(event.target.value)} placeholder="Search posts and requests" aria-label="Search forum review queue"/><button className="quiet-button" onClick={loadModeration}>Refresh</button></div></div>
        {visibleModerationPosts.length ? visibleModerationPosts.map((post) => <article className="moderation-card" key={post._id}><div><ReviewPreview label="Post awaiting approval" post={post} requester={post.author} /></div><div className="row"><button className="button" onClick={() => decidePublication(post, 'approved')}>Approve post</button><button className="button danger" onClick={() => decidePublication(post, 'rejected')}>Reject</button><button className="quiet-button danger-text" onClick={() => adminRemove('post', post)}>Remove</button></div></article>) : <p className="muted">{moderationPosts.length ? 'No matching posts.' : 'No posts awaiting publication.'}</p>}
      </section>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Deletion requests</h2><p>{visibleDeletionRequests.length} of {deletionRequests.length} user request(s) awaiting a decision.</p></div></div>
        {visibleDeletionRequests.length ? visibleDeletionRequests.map((request) => { const isPost = request.kind === 'post_deletion'; return <article className="moderation-card" key={request._id}><div><ReviewPreview label={isPost ? 'Post deletion request' : 'Comment deletion request'} post={request.post} requester={request.requester} comment={isPost ? null : request.comment} createdAt={request.createdAt} /></div><div className="row"><button className="button" onClick={() => decideDeletion(request, 'approved')}>Approve deletion</button><button className="button secondary" onClick={() => decideDeletion(request, 'rejected')}>Reject request</button><button className="quiet-button danger-text" onClick={() => adminRemove(isPost ? 'post' : 'comment', request)}>Remove now</button></div></article>; }) : <p className="muted">{deletionRequests.length ? 'No matching requests.' : 'No deletion requests.'}</p>}
      </section>
    </>}
    {tab === 'overview' && <>
      <div className="admin-metrics-grid"><Metric label="Registered users" value={metrics?.users} detail={`${metrics?.newUsers30d ?? 0} joined in the last 30 days`} /><Metric label="Annual predictions" value={metrics?.predictions} detail="Saved system predictions" /><Metric label="Community posts" value={metrics?.posts} detail={`${metrics?.comments ?? 0} active comments`} /><Metric label="Traffic events" value={health?.traffic?.totalEvents} detail="Since this API process started" /></div>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Community review queue</h2><p>{moderationPosts.length} posts awaiting publication · {deletionRequests.length} post or comment deletion requests</p></div><button className="quiet-button" onClick={() => { loadModeration(); setTab('moderation'); }}>Open review queue</button></div>
        {moderationPosts.slice(0, 3).map((post) => <ReviewPreview key={`post-${post._id}`} label="Post approval request" post={post} requester={post.author} />)}
        {deletionRequests.filter((request) => request.kind === 'comment_deletion').slice(0, 3).map((request) => <ReviewPreview key={`comment-deletion-${request._id}`} label="Comment deletion request" post={request.post} requester={request.requester} comment={request.comment} createdAt={request.createdAt} />)}
        {deletionRequests.filter((request) => request.kind === 'post_deletion').slice(0, 2).map((request) => <ReviewPreview key={`post-deletion-${request._id}`} label="Post deletion request" post={request.post} requester={request.requester} createdAt={request.createdAt} />)}
        {!moderationPosts.length && !deletionRequests.length && <p className="muted">There are no pending forum actions.</p>}
      </section>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Live system performance</h2><p>Updates every 3 seconds</p></div><span className="live-label"><i className="traffic-live-dot" />LIVE</span></div><div className="admin-metrics-grid"><Metric label="API uptime" value={`${performance?.uptimeSeconds ?? 0}s`} detail="Current API process" /><Metric label="API memory" value={mb(performance?.memory?.rss)} detail={`Heap ${mb(performance?.memory?.heapUsed)} / ${mb(performance?.memory?.heapTotal)}`} /><Metric label="Host memory" value={`${mb((performance?.hostMemory?.total || 0) - (performance?.hostMemory?.free || 0))} used`} detail={`${mb(performance?.hostMemory?.free)} free`} /><Metric label="Event loop use" value={`${performance?.eventLoopUtilization ?? 0}%`} detail={`${performance?.hostMemory?.cpuCount || 0} CPU cores`} /></div></section>
      <div className="admin-dashboard-grid"><section className="admin-panel"><div className="admin-panel-head"><div><h2>Service status</h2><p>Live connection checks</p></div><button className="quiet-button" onClick={loadHealth}>Refresh</button></div><div className="service-status-list">{Object.entries(health?.services || {}).map(([key, value]) => <div className="service-status-row" key={key}><span className={statusClass(value.status)}>{value.status}</span><div><strong>{key === 'model' ? 'Climate / LASSO service' : key[0].toUpperCase() + key.slice(1)}</strong><small>{typeof value.detail === 'string' ? value.detail : JSON.stringify(value.detail)}</small></div></div>)}</div></section><section className="admin-panel"><div className="admin-panel-head"><div><h2>Prediction risk mix</h2><p>All saved model outputs</p></div></div><div className="risk-summary">{Object.entries(metrics?.risk || {}).map(([key, value]) => <div key={key}><span className={`pill ${key === 'High' ? 'risk-high' : key === 'Medium' ? 'risk-medium' : 'risk-low'}`}>{key}</span><strong>{value}</strong></div>)}{!Object.keys(metrics?.risk || {}).length && <p className="muted">No predictions recorded.</p>}</div></section></div>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>System topology</h2><p>Live frontend, API, database, and model traffic</p></div><button className="quiet-button" onClick={() => setTab('topology')}>Open topology</button></div><Topology health={health} onMonitor={() => setTab('traffic')} /></section>
    </>}
    {tab === 'users' && <>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Create user</h2><p>Create a role-based account directly.</p></div></div><form className="grid grid-2" onSubmit={addUser}><div className="field"><label>Name</label><input required value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} /></div><div className="field"><label>Email</label><input required type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div><div className="field"><label>Temporary password</label><input required minLength="8" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></div><div className="field"><label>Role</label><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>{roles.map((role) => <option key={role}>{role}</option>)}</select></div><button className="button">Create account</button></form></section>
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>All users</h2><p>{totalUsers} accounts · edit, change role, or delete accounts</p></div><input className="admin-user-search" value={query} onChange={(event) => { setQuery(event.target.value); setUserPage(1); loadUsers(event.target.value, 1); }} placeholder="Search name or email" /></div><div className="admin-table-wrap"><table className="admin-users-table"><thead><tr><th>User</th><th>Email</th><th>Joined</th><th>Role</th><th>Manage</th></tr></thead><tbody>{users.map((user) => <tr key={user._id}><td><strong>{user.fullName}</strong></td><td>{user.email}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><select value={user.role} onChange={(event) => updateRole(user, event.target.value)} aria-label={`Set ${user.fullName} role`}>{roles.map((role) => <option key={role}>{role}</option>)}</select></td><td><button className="quiet-button" onClick={() => editUser(user)}>Edit</button> <button className="quiet-button danger-text" onClick={() => deleteUser(user)}>Delete</button></td></tr>)}</tbody></table>{!users.length && <p className="muted">No matching users.</p>}</div><div className="user-pagination"><span>Showing {totalUsers ? ((userPage - 1) * 100 + 1) : 0}–{Math.min(userPage * 100, totalUsers)} of {totalUsers}</span><div><button className="button secondary" disabled={userPage <= 1} onClick={() => loadUsers(query, userPage - 1)}>Previous</button><button className="button secondary" disabled={userPage * 100 >= totalUsers} onClick={() => loadUsers(query, userPage + 1)}>Next</button></div></div></section>
    </>}
    {tab === 'topology' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Live system topology</h2><p>Traffic updates stream from the API and MongoDB driver.</p></div><span className="live-label"><i className="traffic-live-dot" />LIVE</span></div><Topology health={health} onMonitor={() => setTab('traffic')} /></section>}
    {tab === 'traffic' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Traffic monitor</h2><p>{health?.traffic?.totalEvents || 0} total events since API startup · latest 1,000 retained · request payloads are not stored</p></div><button className="quiet-button" onClick={loadTraffic}>Refresh</button></div><input className="admin-user-search" value={trafficQuery} onChange={(e) => setTrafficQuery(e.target.value)} placeholder="Filter route, service, status"/><div className="traffic-table-wrap"><div className="traffic-events">{trafficRows.map((event) => <div className="traffic-event" key={event.id}><time>{shortTime(event.at)}</time><span>{event.source}</span><b>→</b><span>{event.destination}</span><code>{event.label}</code><small>{event.durationMs} ms</small><i className={event.status === 'ok' ? 'event-ok' : 'event-error'}>{event.status}</i></div>)}{trafficRows.length === 0 && <p className="muted">No matching traffic events.</p>}</div></div></section>}
    {tab === 'conversations' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>All conversations</h2><p>Search matches participant details and conversation text.</p></div><div className="admin-review-tools"><input className="admin-user-search" type="search" value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder="Search people or conversation text" aria-label="Search conversations"/><button className="quiet-button" onClick={loadAdminViews}>Refresh</button></div></div>{conversationSearchLoading && <p className="muted" role="status">Searching conversations on this device…</p>}<div className="admin-table-wrap"><table className="admin-users-table"><thead><tr><th>Participants</th><th>Messages</th><th>Last activity</th><th>Messages</th></tr></thead><tbody>{visibleConversations.map((conversation, index) => { const ids = conversation.participants.map((participant) => String(participant._id)); const key = [...ids].sort().join(':'); const isOpen = expandedConversation === key; return <Fragment key={`${key}-${index}`}><tr><td>{conversation.participants.map((u) => `${u.fullName} (${u.role})`).join(' ↔ ')}</td><td>{conversation.messageCount}</td><td>{shortTime(conversation.latestAt)}</td><td><button className="quiet-button" onClick={() => openConversation(conversation)}>Read conversation</button></td></tr>{isOpen && <tr><td colSpan="4">{conversationBusy ? <p className="muted">Loading messages on this admin device…</p> : <div className="admin-chat-log">{(conversationMessages[key] || []).map((item) => { const sender = conversation.participants.find((participant) => String(participant._id) === String(item.sender)); return <article className="admin-chat-row" key={item._id}><strong>{sender?.fullName || 'User'}</strong><p>{item.plaintext}</p><small>{shortTime(item.createdAt)}</small></article>; })}{!conversationMessages[key] && <p className="muted">Loading conversation…</p>}</div>}</td></tr>}</Fragment>; })}</tbody></table>{!visibleConversations.length && <p className="muted">{conversations.length ? conversationSearchLoading ? 'Loading matching messages…' : 'No matching conversations.' : 'No conversations yet.'}</p>}</div></section>}
    {tab === 'schema' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>Database schema</h2><p>Application collections, principal fields, and references.</p></div><button className="quiet-button" onClick={loadAdminViews}>Refresh</button></div><div className="grid grid-2">{schema.map((collection) => <article className="config-item" key={collection.name}><strong>{collection.name}</strong><small>Model: {collection.model}</small><span><b>Fields:</b> {collection.fields.join(' · ')}</span><span><b>Relations:</b> {collection.relations.join(' · ') || 'None'}</span></article>)}</div></section>}
    {tab === 'config' && <section className="admin-panel"><div className="admin-panel-head"><div><h2>System configuration</h2><p>Effective runtime settings. Secret values are intentionally omitted.</p></div></div><div className="config-grid">{Object.entries(config || {}).map(([key, value]) => <div className="config-item" key={key}><span>{key.replace(/[A-Z]/g, ' $&').replace(/^./, (c) => c.toUpperCase())}</span>{Array.isArray(value) ? value.map((item) => <code key={item}>{item}</code>) : <strong>{String(value)}</strong>}</div>)}</div></section>}
    {editingUser && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingUser(null); }}><section className="admin-user-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title"><div className="admin-panel-head"><div><h2 id="edit-user-title">Edit user information</h2><p>Update profile, account access, or reset this user’s password.</p></div><button type="button" className="quiet-button" onClick={() => setEditingUser(null)}>Close</button></div><section className="signup-metadata"><h3>Signup and device details</h3><div><span>Signup time</span><strong>{editingUser.createdAt ? new Date(editingUser.createdAt).toLocaleString() : 'Unavailable'}</strong></div><div><span>IP address</span><strong>{editingUser.signupIp || 'Unavailable for existing account'}</strong></div><div><span>Device</span><strong>{[editingUser.signupDevice?.type, editingUser.signupDevice?.platform].filter(Boolean).join(' · ') || 'Unavailable for existing account'}</strong></div><div><span>Screen and device specs</span><strong>{editingUser.signupDevice?.screen?.width ? `${editingUser.signupDevice.screen.width} × ${editingUser.signupDevice.screen.height || '?'} px · ${editingUser.signupDevice.screen.pixelRatio || 1}× pixel ratio` : 'Unavailable'}{editingUser.signupDevice?.hardwareConcurrency ? ` · ${editingUser.signupDevice.hardwareConcurrency} CPU threads` : ''}{editingUser.signupDevice?.deviceMemory ? ` · ${editingUser.signupDevice.deviceMemory} GB memory` : ''}</strong></div><div><span>Signup coordinates</span><strong>{editingUser.signupLocation ? <><a href={`https://www.google.com/maps?q=${editingUser.signupLocation.latitude},${editingUser.signupLocation.longitude}`} target="_blank" rel="noreferrer">{Number(editingUser.signupLocation.latitude).toFixed(6)}, {Number(editingUser.signupLocation.longitude).toFixed(6)}</a>{editingUser.signupLocation.accuracy ? ` · ±${Math.round(editingUser.signupLocation.accuracy)} m` : ''}</> : 'Not shared or unavailable'}</strong></div><div className="signup-device-agent"><span>Browser details</span><strong>{editingUser.signupDevice?.userAgent || 'Unavailable for existing account'}</strong></div></section><form className="grid grid-2" onSubmit={saveUserEdit}><div className="field"><label>Full name</label><input required value={editingUser.fullName || ''} onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}/></div><div className="field"><label>Email</label><input required type="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}/></div><div className="field"><label>Gender</label><input value={editingUser.gender || ''} onChange={(e) => setEditingUser({ ...editingUser, gender: e.target.value })}/></div><div className="field date-picker-field"><label>Birthday</label><DatePicker value={editingUser.birthday || ''} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} showToday={false} onChange={(birthday) => setEditingUser({ ...editingUser, birthday })}/></div><div className="field"><label>Phone</label><input value={editingUser.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}/></div><div className="field"><label>Language</label><select value={editingUser.language || 'en'} onChange={(e) => setEditingUser({ ...editingUser, language: e.target.value })}>{[['en','English'],['tl','Tagalog'],['ceb','Cebuano'],['hil','Hiligaynon'],['krj','Kinaray-a'],['cyo','Kuyonon']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field admin-edit-wide"><label>Address</label><input value={editingUser.address || ''} onChange={(e) => setEditingUser({ ...editingUser, address: e.target.value })}/></div><div className="field"><label>Role</label><select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}>{roles.map((role) => <option key={role}>{role}</option>)}</select></div><div className="field"><label>Profile picture</label><input type="file" accept="image/*" onChange={(e) => setEditPhoto(e.target.files?.[0] || null)}/><small>Current: {editingUser.profilePicture ? 'Uploaded' : 'No profile picture'}</small></div><div className="field"><label>Reset password (optional)</label><input type="password" minLength="8" autoComplete="new-password" value={editingUser.password} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}/></div><label className="row admin-edit-wide"><input type="checkbox" checked={Boolean(editingUser.acceptedTerms)} onChange={(e) => setEditingUser({ ...editingUser, acceptedTerms: e.target.checked })}/> Terms accepted</label><div className="row admin-edit-wide"><button type="button" className="button secondary" onClick={() => setEditingUser(null)}>Cancel</button><button className="button">Save all changes</button></div></form></section></div>}
  </div>;
}
