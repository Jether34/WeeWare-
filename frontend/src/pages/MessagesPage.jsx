import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { assetUrl } from '../api';
import { useAuth } from '../auth';

function idOf(value) {
  // Mongo ObjectIds expose an `.id` Buffer internally; never stringify that
  // property when the value itself is the id. API documents normally provide
  // `_id`, while authenticated profile responses provide `id` as a string.
  const candidate = value?._id ?? (typeof value?.id === 'string' ? value.id : value);
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate?.toHexString === 'function') return candidate.toHexString();
  return '';
}

const roleAvatar = (account) => ['da', 'researcher'].includes(account?.role) ? '/assets/weeware-vps-logo.png' : (assetUrl(account?.profilePicture) || '/assets/weeware.png');
const fileExtension = (filename) => {
  const extension = String(filename || '').split('.').pop();
  return extension && extension !== filename ? extension.slice(0, 5).toUpperCase() : 'FILE';
};
const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return 'File';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export default function MessagesPage() {
  const { user: currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('user') || '';
  const [threads, setThreads] = useState([]);
  const [pinnedAccounts, setPinnedAccounts] = useState({ admin: null, da: null, researcher: null });
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [matches, setMatches] = useState([]);
  const [draft, setDraft] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState([]);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupFile, setGroupFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messageEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const groupFileInputRef = useRef(null);
  const messagesPageRef = useRef(null);
  const pinnedAccountsRef = useRef(pinnedAccounts);
  pinnedAccountsRef.current = pinnedAccounts;
  const ownId = idOf(currentUser?.id || currentUser?._id);
  const isAdmin = currentUser?.role === 'admin';
  const socketContext = useRef({});
  socketContext.current = { ownId, selectedId, groupMode, loadThreads: null };

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener?.('change', update);
    if (!media.addEventListener) media.addListener?.(update);
    return () => {
      media.removeEventListener?.('change', update);
      if (!media.removeEventListener) media.removeListener?.(update);
    };
  }, []);

  const loadThreads = useCallback(async () => {
    const [threadResult, pinnedResult] = await Promise.allSettled([api.get('/messages/threads'), api.get('/messages/pinned')]);
    const nextThreads = threadResult.status === 'fulfilled' ? threadResult.value.data.threads || [] : null;
    const nextPinned = pinnedResult.status === 'fulfilled' ? pinnedResult.value.data.accounts : null;
    if (nextThreads) setThreads(nextThreads);
    if (nextPinned) setPinnedAccounts({ admin: null, da: null, researcher: null, ...nextPinned });
    const avatarUrls = [...(nextThreads || []).map((thread) => thread.user?.profilePicture), ...Object.values(nextPinned || {}).map((account) => account?.profilePicture)]
      .map((path) => path && assetUrl(path)).filter(Boolean);
    [...new Set(avatarUrls)].forEach((src) => { const image = new Image(); image.decoding = 'async'; image.src = src; });
    if (threadResult.status === 'rejected' && pinnedResult.status === 'rejected') setError(threadResult.reason?.message || pinnedResult.reason?.message || 'Could not load messages.');
    else if (pinnedResult.status === 'rejected') setError(pinnedResult.reason?.message || 'Could not load pinned accounts.');
    else if (threadResult.status === 'rejected') setError(threadResult.reason?.message || 'Could not load conversation history.');
  }, []);

  // Socket handlers need current conversation state, but the socket itself must
  // live for the page lifetime. Recreating it on every selection/key update
  // closes in-flight WebSocket upgrades and creates a rapid reconnect loop.
  socketContext.current.loadThreads = loadThreads;

  useEffect(() => { loadThreads().catch((err) => setError(err.message)); }, [loadThreads]);

  useEffect(() => {
    const socket = io('/', { path: '/socket.io', withCredentials: true });
    socket.on('message:new', (message) => {
      const { ownId: currentOwnId, selectedId: currentSelectedId, loadThreads: refreshThreads } = socketContext.current;
      const senderId = idOf(message.sender);
      const recipientId = idOf(message.recipient);
      const otherId = senderId === currentOwnId ? recipientId : senderId;
      if (otherId === currentSelectedId) {
        setMessages((rows) => rows.some((row) => idOf(row._id) === idOf(message._id)) ? rows : [...rows, message]);
      }
      refreshThreads?.();
    });
    socket.on('message:group:new', (message) => {
      const { groupMode: isGroupOpen } = socketContext.current;
      if (!isGroupOpen) return;
      setGroupMessages((rows) => rows.some((row) => idOf(row._id) === idOf(message._id)) ? rows : [...rows, message]);
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!groupMode) return undefined;
    let active = true;
    setConversationLoading(true); setError(''); setGroupMessages([]);
    api.get('/messages/group').then(({ data }) => {
      if (active) { setGroupParticipants(data.participants || []); setGroupMessages(data.messages || []); }
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [groupMode]);

  useEffect(() => {
    if (selectedId && (!/^[a-f\d]{24}$/i.test(selectedId) || selectedId === ownId)) {
      setError(''); setPeer(null); setMessages([]); setParams({}, { replace: true }); return;
    }
    if (!selectedId) { setPeer(null); setMessages([]); setConversationLoading(false); return; }
    let active = true;
    setConversationLoading(true);
    setMessages([]);
    // Resolve the selected account immediately so a pinned contact opens a
    // conversation even while this browser is still preparing its E2EE key.
    const pinnedPeer = Object.values(pinnedAccountsRef.current).find((account) => idOf(account) === selectedId);
    if (pinnedPeer) setPeer(pinnedPeer);
    api.get(`/messages/${selectedId}`).then(({ data }) => {
      if (!active) return;
      setPeer(data.user);
      if (active) setMessages(data.messages || []);
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [selectedId, ownId, setParams]);

  useEffect(() => {
    if (!selectedId || !peer || broadcastMode || !window.matchMedia('(max-width: 760px)').matches) return undefined;
    const frame = requestAnimationFrame(() => messageInputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, peer, broadcastMode]);

  useEffect(() => {
    if (!groupMode || !window.matchMedia('(max-width: 760px)').matches) return undefined;
    const frame = requestAnimationFrame(() => messageInputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [groupMode]);

  useEffect(() => {
    const page = messagesPageRef.current;
    const shell = page?.closest('.app-shell');
    const viewport = window.visualViewport;
    if (!shell || !window.matchMedia('(max-width: 760px)').matches) return undefined;
    const syncViewportHeight = () => {
      shell.style.setProperty('--messages-viewport-height', `${viewport?.height || window.innerHeight}px`);
    };
    syncViewportHeight();
    viewport?.addEventListener('resize', syncViewportHeight);
    viewport?.addEventListener('scroll', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    return () => {
      viewport?.removeEventListener('resize', syncViewportHeight);
      viewport?.removeEventListener('scroll', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
      shell.style.removeProperty('--messages-viewport-height');
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) { setMatches([]); return; }
      try { const { data } = await api.get('/users/search', { params: { q: search.trim() } }); setMatches(data.users || []); }
      catch (err) { setError(err.message); }
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);

  const openThread = useCallback((person) => {
    const targetId = idOf(person);
    setGroupMode(false); setBroadcastMode(false); setError(''); setMatches([]); setSearch('');
    if (!targetId) { setError('This account is not available for messaging.'); return; }
    if (targetId === selectedId) {
      // A repeated click on the active chat must not clear messages when the
      // URL is unchanged (React Router would not rerun the loading effect).
      setPeer((current) => current || person);
      if (!peer || idOf(peer) !== targetId) {
        setConversationLoading(true);
        api.get(`/messages/${targetId}`).then(({ data }) => {
          setPeer(data.user);
          setMessages(data.messages || []);
        })
          .catch((err) => setError(err.message)).finally(() => setConversationLoading(false));
      }
      return;
    }
    setPeer(person); setMessages([]); setConversationLoading(true); setParams({ user: targetId });
  }, [selectedId, setParams, peer]);

  async function openPinnedAccount(key, label) {
    let account = pinnedAccounts[key];
    if (!account) {
      setError('');
      try {
        const { data } = await api.get('/messages/pinned');
        account = data.accounts?.[key] || null;
        if (data.accounts) setPinnedAccounts({ admin: null, da: null, researcher: null, ...data.accounts });
      } catch (err) {
        setError(err.message || `Could not load the ${label} account.`);
        return;
      }
    }
    if (!account) { setError(`${label} account is not available for messaging right now.`); return; }
    openThread(account);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !peer || busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/messages/${idOf(peer)}`, { content: text });
      const message = data.message;
      setMessages((rows) => rows.some((row) => idOf(row._id) === idOf(message._id)) ? rows : [...rows, message]);
      setDraft((current) => current === text ? '' : current);
      loadThreads();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function archiveThread(thread) {
    try { await api.post(`/messages/${idOf(thread.user)}/archive`, { archived: !thread.archived }); await loadThreads(); }
    catch (err) { setError(err.message); }
  }
  async function deleteThread(thread) {
    if (!window.confirm(`Delete this conversation with ${thread.user.fullName}? This removes the messages for both people.`)) return;
    try { await api.delete(`/messages/${idOf(thread.user)}`); setThreads((rows) => rows.filter((row) => idOf(row.user) !== idOf(thread.user))); if (selectedId === idOf(thread.user)) { setPeer(null); setMessages([]); setParams({}, { replace: true }); } }
    catch (err) { setError(err.message); }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const content = broadcastDraft.trim();
    if (!content || busy) return;
    setBusy(true); setError(''); setBroadcastResult(null);
    try {
      const { data } = await api.post('/messages/broadcast', { content });
      setBroadcastDraft(''); setBroadcastResult({ sent: data.sentCount, skipped: data.skippedNoKey });
      await loadThreads();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function sendGroupMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !groupFile) || busy) return;
    setBusy(true); setError(''); setUploadProgress(0);
    try {
      let attachment = null;
      if (groupFile) {
        const { data: upload } = await api.post('/messages/group/uploads', { name: groupFile.name, size: groupFile.size, mimeType: groupFile.type || 'application/octet-stream' });
        for (let index = 0; index < upload.chunks; index += 1) {
          const start = index * upload.chunkSize;
          const chunk = groupFile.slice(start, Math.min(groupFile.size, start + upload.chunkSize));
          await api.put(`/messages/group/uploads/${upload.uploadId}/${index}`, chunk, { headers: { 'Content-Type': 'application/octet-stream' }, timeout: 120000 });
          setUploadProgress(Math.round(((index + 1) / upload.chunks) * 90));
        }
        const { data: completed } = await api.post(`/messages/group/uploads/${upload.uploadId}/complete`, {}, { timeout: 120000 });
        attachment = completed.file;
        setUploadProgress(96);
      }
      const { data } = await api.post('/messages/group', { content: text, attachmentId: attachment?._id || null });
      const message = data.message;
      setGroupMessages((rows) => rows.some((row) => idOf(row._id) === idOf(message._id)) ? rows : [...rows, message]);
      setDraft(''); setGroupFile(null); setUploadProgress(100);
      if (groupFileInputRef.current) groupFileInputRef.current.value = '';
      requestAnimationFrame(() => messageInputRef.current?.focus({ preventScroll: true }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setUploadProgress(0); }
  }

  function startBroadcast() {
    setGroupMode(false); setBroadcastMode(true); setPeer(null); setMessages([]); setError(''); setBroadcastResult(null); setParams({}, { replace: true });
  }

  function startGroup() {
    setBroadcastMode(false); setGroupMode(true); setPeer(null); setMessages([]); setDraft(''); setGroupFile(null); setError(''); setParams({}, { replace: true });
  }

  const orderedMessages = useMemo(() => [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [messages]);
  const orderedGroupMessages = useMemo(() => [...groupMessages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [groupMessages]);
  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [orderedMessages, orderedGroupMessages]);
  // Setting peer immediately on tap also flips the mobile inbox into the
  // conversation view while the URL and message request are being updated.
  const hasSelection = Boolean(selectedId || peer || broadcastMode || groupMode);
  const hasPinnedGroupAccess = Boolean(pinnedAccounts[currentUser?.role] && idOf(pinnedAccounts[currentUser.role]) === ownId);
  const visiblePinnedAccounts = isAdmin
    ? [['researcher','Researcher','WeeWare researcher'],['da','DA','Department of Agriculture']]
    : currentUser?.role === 'da'
      ? [['admin','Admin','WeeWare administrator'],['researcher','Researcher','WeeWare researcher']]
      : [['admin','Admin','WeeWare administrator'],['da','DA','Department of Agriculture']];
  const shownPinnedAccounts = visiblePinnedAccounts.filter(([key, label]) => {
    const account = pinnedAccounts[key];
    const thread = threads.find((row) => idOf(row.user) === idOf(account));
    const inMode = thread ? Boolean(thread.archived) === showArchived : !showArchived;
    return inMode && (!search.trim() || `${account?.fullName || label} ${label}`.toLowerCase().includes(search.trim().toLowerCase()));
  });
  return <div ref={messagesPageRef} className={`page messages-page ${hasSelection ? 'mobile-chat-open' : ''}`}>
    <section className={`card direct-messages ${hasSelection ? 'has-selection' : ''}`}>
      <aside className="conversation-sidebar" style={isMobileViewport ? { display: hasSelection ? 'none' : 'flex' } : undefined}>
        <div className="messenger-inbox-heading"><h1>Chats</h1></div>
        <label className="field messenger-search"><span className="sr-only">Find people</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Messenger" /></label>
        {isAdmin && <button type="button" className="broadcast-entry" onClick={startBroadcast}><span className="broadcast-entry-icon">↗</span><span><strong>Message all users</strong><small>Send a broadcast message</small></span></button>}

        <div className="pinned-heading">Pinned accounts</div>
        {hasPinnedGroupAccess && <button type="button" className={`conversation-button pinned-account pinned-role-group ${groupMode ? 'selected' : ''}`} onClick={startGroup}><span className="group-avatar-stack"><img src="/assets/weeware-vps-logo.png" alt=""/><img src="/assets/weeware-vps-logo.png" alt=""/><img src="/assets/weeware-vps-logo.png" alt=""/></span><span><strong>Admin · DA · Researcher</strong><small>Shared group conversation</small></span></button>}
        <div className="conversation-list pinned-conversations">{shownPinnedAccounts.map(([key, label, subtitle]) => {
          const account = pinnedAccounts[key];
          const thread = threads.find((row) => idOf(row.user) === idOf(account));
          return account ? <div key={key} className="message-thread-row pinned-thread-row"><button type="button" onClick={() => openThread(account)} className={`conversation-button pinned-account ${selectedId === idOf(account) ? 'selected' : ''}`}><img src={roleAvatar(account)} loading="eager" decoding="async" fetchPriority="high" width="38" height="38" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} alt=""/><span><strong>{account.fullName || label}</strong><small>{thread?.archived ? `Archived · deletes ${new Date(thread.expiresAt).toLocaleDateString()}` : subtitle}</small></span></button>{thread && <div className="message-thread-actions"><button type="button" onClick={() => archiveThread(thread)}>{thread.archived ? 'Restore' : 'Archive'}</button><button type="button" onClick={() => deleteThread(thread)}>Delete</button></div>}</div> : <button key={key} type="button" onClick={() => openPinnedAccount(key, label)} className="conversation-button pinned-account unavailable"><img src="/assets/weeware-vps-logo.png" loading="eager" decoding="async" width="38" height="38" alt=""/><span><strong>{label}</strong><small>{key === 'da' ? 'No DA account is configured · tap to retry' : `${subtitle} · tap to load account`}</small></span></button>;
        })}</div>
        <div className="pinned-heading conversation-section-heading"><span>{showArchived ? 'Archived messages' : 'All messages'}</span><button type="button" className="quiet-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? 'Show inbox' : 'Show archived'}</button></div>
        <div className="conversation-list conversation-history-list">
          {threads.filter((thread) => {
            const pinned = visiblePinnedAccounts.map(([key]) => pinnedAccounts[key]).filter(Boolean);
            const matchesSearch = !search.trim() || thread.user?.fullName?.toLowerCase().includes(search.trim().toLowerCase());
            return (!pinned.some((account) => idOf(account) === idOf(thread.user)) || showArchived) && matchesSearch && Boolean(thread.archived) === showArchived;
          }).map((thread) => <div className="message-thread-row" key={idOf(thread.user)}><button onClick={() => { setBroadcastMode(false); openThread(thread.user); }} className={`conversation-button ${selectedId === idOf(thread.user) ? 'selected' : ''}`}><img src={roleAvatar(thread.user)} loading="eager" decoding="async" fetchPriority="high" width="38" height="38" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} alt=""/><span><strong>{thread.user.fullName}</strong><small>{thread.archived ? `Archived · deletes ${new Date(thread.expiresAt).toLocaleDateString()}` : 'Message'}</small></span></button><div className="message-thread-actions"><button type="button" onClick={() => archiveThread(thread)}>{thread.archived ? 'Restore' : 'Archive'}</button><button type="button" onClick={() => deleteThread(thread)}>Delete</button></div></div>)}
          {matches.filter((person) => !threads.some((thread) => idOf(thread.user) === idOf(person)) && !visiblePinnedAccounts.some(([key]) => idOf(pinnedAccounts[key]) === idOf(person))).map((person) => <button key={idOf(person)} onClick={() => openThread(person)} className="conversation-button"><img src={assetUrl(person.profilePicture) || '/assets/weeware.png'} loading="eager" decoding="async" fetchPriority="high" width="38" height="38" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} alt=""/><span><strong>{person.fullName}</strong><small>Start a conversation</small></span></button>)}
          {threads.filter((thread) => !search.trim() || thread.user?.fullName?.toLowerCase().includes(search.trim().toLowerCase())).length === 0 && matches.length === 0 && shownPinnedAccounts.length === 0 && <p className="muted conversation-empty">{search ? 'No matching conversations or users.' : 'Search for a member to start a conversation.'}</p>}
        </div>
      </aside>
      <section className="conversation-panel" style={isMobileViewport ? { display: hasSelection ? 'flex' : 'none' } : undefined}>
        {error && <p className="error message-error">{error}</p>}
        {groupMode ? <>
          <header className="conversation-header group-conversation-header">
            <button type="button" className="mobile-chat-back" aria-label="Back to chats" onClick={() => { setGroupMode(false); setGroupFile(null); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button>
            <span className="group-avatar-stack header-group-avatars">{groupParticipants.map((person) => <img key={idOf(person)} src={roleAvatar(person)} alt=""/>)}{groupParticipants.length === 0 && <img src="/assets/weeware-vps-logo.png" alt=""/>}</span>
            <div><strong>Admin ? DA ? Researcher</strong><small>Shared group ? 3 accounts</small></div>
          </header>
          <div className="conversation-messages group-conversation-messages">
            {conversationLoading && <p className="muted empty-conversation" role="status">Loading group messages?</p>}
            {!conversationLoading && orderedGroupMessages.map((message) => { const mine = idOf(message.sender) === ownId; const fileName = message.attachment?.originalName || 'Shared file'; return <div className={`chat-row ${mine ? 'mine' : ''}`} key={idOf(message._id)}>{!mine && <small className="group-message-sender">{message.sender?.fullName || message.sender?.role || 'Member'}</small>}<article className={`chat-bubble ${mine ? 'mine' : ''}`}>{(message.content || message.plaintext) && <p>{message.content || message.plaintext}</p>}{!message.content && !message.plaintext && message.legacyUnavailable && <p>This older message was sent before the messaging update and is unavailable.</p>}{message.attachment && <a className="group-message-file" href={`/api/messages/group/files/${message.attachment._id}`} download={fileName} aria-label={`Download ${fileName}`}><span className="group-file-icon" aria-hidden="true">{fileExtension(fileName)}</span><span className="group-file-details"><strong title={fileName}>{fileName}</strong><small>{formatFileSize(message.attachment.size)} · {message.attachment.mimeType || 'File attachment'}</small></span><span className="group-file-download">Download<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 18v3h14v-3"/></svg></span></a>}<small>{new Date(message.createdAt).toLocaleString()}</small></article></div>; })}
            {!conversationLoading && orderedGroupMessages.length === 0 && <p className="muted empty-conversation">No group messages yet. Send a message or share a file.</p>}
            <div ref={messageEndRef} />
          </div>
          <form className="message-compose group-message-compose" onSubmit={sendGroupMessage}>
            <div className="group-compose-input"><input ref={messageInputRef} enterKeyHint="send" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a group message..." maxLength={4000} disabled={busy}/>{groupFile && <div className="group-file-pending"><span>{groupFile.name} ? {(groupFile.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" aria-label="Remove file" onClick={() => { setGroupFile(null); if (groupFileInputRef.current) groupFileInputRef.current.value = ''; }}>?</button></div>}{busy && groupFile && <progress className="group-upload-progress" max="100" value={uploadProgress}/>}</div>
            <label className="group-file-picker" title="Attach any file up to 1 GB"><input ref={groupFileInputRef} type="file" onChange={(event) => setGroupFile(event.target.files?.[0] || null)} disabled={busy}/><span aria-hidden="true">?</span><span className="sr-only">Attach file up to 1 GB</span></label>
            <button type="submit" className="button send-comment-button message-send-button" aria-label={busy ? 'Sending group message' : 'Send group message'} disabled={busy || (!draft.trim() && !groupFile)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/></svg></button>
          </form>
          <small className="group-file-limit">Any file format - maximum file size 1 GB</small>
        </> : broadcastMode ? <><header className="conversation-header broadcast-header"><button type="button" className="mobile-chat-back" aria-label="Back to chats" onClick={()=>setBroadcastMode(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button><span className="broadcast-header-icon">↗</span><div><strong>Message all users</strong><small>Broadcast message</small></div></header><div className="broadcast-compose-area"><div className="broadcast-explainer"><strong>Announcement</strong><p>This message will be delivered to every account.</p></div>{broadcastResult&&<p className="success">Message sent to {broadcastResult.sent} user(s).</p>}</div><form className="message-compose broadcast-compose" onSubmit={sendBroadcast}><textarea value={broadcastDraft} onChange={(event)=>setBroadcastDraft(event.target.value)} placeholder="Write an announcement to all users…" maxLength={4000} disabled={busy}/><button className="button" disabled={busy||!broadcastDraft.trim()}>{busy?'Sending…':'Send to all'}</button></form></> : peer ? <><header className="conversation-header"><button type="button" className="mobile-chat-back" aria-label="Back to chats" onClick={()=>setParams({}, {replace:true})}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6 6-6-6M9 12h12"/></svg></button><img src={roleAvatar(peer)} loading="eager" decoding="async" fetchPriority="high" width="40" height="40" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} alt=""/><div><strong>{peer.fullName}</strong><small>{peer.accountStatus === 'deactivated' ? 'Deactivated account ? messaging unavailable' : 'Available across your devices'}</small></div></header>
        <div className="conversation-messages">{conversationLoading && <p className="muted empty-conversation" role="status">Loading messages...</p>}{!conversationLoading && orderedMessages.map((message) => { const mine = idOf(message.sender) === ownId; const content = message.content || message.plaintext || (message.legacyUnavailable ? 'This older message was sent before the messaging update and is unavailable.' : ''); return <div className={`chat-row ${mine ? 'mine' : ''}`} key={idOf(message._id)}><article className={`chat-bubble ${mine ? 'mine' : ''}`}><p>{content}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article></div>; })}{!conversationLoading && orderedMessages.length === 0 && <p className="muted empty-conversation">No messages yet. Start the conversation.</p>}<div ref={messageEndRef} /></div>
          <form className="message-compose" onSubmit={sendMessage}><input ref={messageInputRef} enterKeyHint="send" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={peer.accountStatus === 'deactivated' ? 'This account is deactivated' : 'Write a message...'} maxLength={4000} disabled={busy || peer.accountStatus === 'deactivated'}/><button type="submit" className="button send-comment-button message-send-button" onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); messageInputRef.current?.focus({ preventScroll: true }); }} title="Send message" aria-label={busy ? 'Sending message' : 'Send message'} disabled={busy || !draft.trim() || peer.accountStatus === 'deactivated'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" /></svg></button></form>
        </> : <div className="empty-conversation"><span className="empty-chat-mark">W</span><h2>Your messages</h2><p className="muted">Select a conversation or search for someone to message.</p></div>}
      </section>
    </section>
  </div>;
}
