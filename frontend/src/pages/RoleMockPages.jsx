import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import api, { assetUrl } from '../api';
import { io } from 'socket.io-client';

export function FarmerAIPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const pageRef = useRef(null);
  const activeConversation = conversations.find((conversation) => String(conversation._id) === activeId);
  const visibleConversations = conversations.filter((conversation) => `${conversation.title} ${conversation.messages.at(-1)?.text || ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    let current = true;
    const socket = io('/', { path: '/socket.io', withCredentials: true });
    api.get('/ai/conversations').then(({ data }) => {
      if (current) setConversations(data.conversations || []);
    }).catch((err) => { if (current) setError(err.message); }).finally(() => { if (current) setLoading(false); });
    socket.on('ai:conversation-updated', (conversation) => {
      if (!current || String(conversation.owner) !== String(user?.id)) return;
      setConversations((rows) => [conversation, ...rows.filter((row) => String(row._id) !== String(conversation._id))].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
    });
    return () => { current = false; socket.disconnect(); };
  }, [user?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [activeConversation?.messages?.length]);
  useEffect(() => {
    if (!activeId || !window.matchMedia('(max-width: 760px)').matches) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [activeId]);
  useEffect(() => {
    const shell = pageRef.current?.closest('.app-shell');
    const viewport = window.visualViewport;
    if (!shell || !window.matchMedia('(max-width: 760px)').matches) return undefined;
    const syncViewportHeight = () => shell.style.setProperty('--messages-viewport-height', `${viewport?.height || window.innerHeight}px`);
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

  async function createConversation() {
    setError('');
    try {
      const { data } = await api.post('/ai/conversations', { title: t('New conversation') });
      const conversation = data.conversation;
      setConversations((current) => [conversation, ...current.filter((item) => String(item._id) !== String(conversation._id))]);
      setActiveId(String(conversation._id));
      setDraft('');
    } catch (err) { setError(err.message); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    setDraft('');
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage = { _id: optimisticId, role: 'user', text, createdAt: new Date().toISOString() };
    let conversationId = String(activeConversation?._id || '');
    try {
      let conversation = activeConversation;
      if (!conversation) {
        const created = await api.post('/ai/conversations', { title: text.slice(0, 48) });
        conversation = created.data.conversation;
        conversationId = String(conversation._id);
        setConversations((rows) => [conversation, ...rows.filter((row) => String(row._id) !== String(conversation._id))]);
        setActiveId(String(conversation._id));
      }
      conversationId = String(conversation._id);
      setConversations((rows) => rows.map((row) => String(row._id) === String(conversation._id)
        ? { ...row, messages: [...(row.messages || []), optimisticMessage] }
        : row));
      const { data } = await api.post(`/ai/conversations/${conversation._id}/messages`, { text }, { timeout: 150000 });
      const saved = data.conversation;
      setConversations((rows) => [saved, ...rows.filter((row) => String(row._id) !== String(saved._id))].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
      setActiveId(String(saved._id));
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } catch (err) {
      setConversations((rows) => rows.map((row) => String(row._id) === conversationId
        ? { ...row, messages: (row.messages || []).filter((message) => String(message._id) !== optimisticId) }
        : row));
      setDraft(text); setError(err.message);
    }
    finally { setSending(false); }
  }

  return <div ref={pageRef} className={`page messages-page ai-messages-page ${activeId ? 'mobile-chat-open' : ''}`}>
    <section className={`card direct-messages ${activeId ? 'has-selection' : ''}`}>
      <aside className="conversation-sidebar">
        <div className="messenger-inbox-heading"><h1>{t('AI conversations')}</h1><button type="button" className="ai-new-chat" aria-label={t('New chat')} title={t('New chat')} onClick={createConversation}>+</button></div>
        <label className="field messenger-search"><span className="sr-only">{t('Search conversations')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search conversations')} /></label>
        <div className="pinned-heading">{t('Conversation history')}</div>
        <div className="conversation-list ai-conversation-list">{loading && <p className="muted conversation-empty">{t('Loading conversations…')}</p>}{visibleConversations.map((conversation) => <button type="button" key={conversation._id} onClick={() => { setActiveId(String(conversation._id)); setDraft(''); }} className={`conversation-button ${activeId === String(conversation._id) ? 'selected' : ''}`}><img className="ai-history-avatar" src="/assets/weeware-vps-logo.png" loading="eager" decoding="async" alt=""/><span><strong>{conversation.title || t('New conversation')}</strong><small>{conversation.messages.at(-1)?.text || t('No messages yet')}</small></span></button>)}{!loading && visibleConversations.length === 0 && <p className="muted conversation-empty">{search ? t('No matching conversations.') : t('Your conversations will appear here.')}</p>}</div>
      </aside>
      <section className="conversation-panel" aria-label={t('AI conversation')}>
        {activeConversation ? <><header className="conversation-header"><button type="button" className="mobile-chat-back" aria-label={t('Back to conversations')} onClick={() => setActiveId('')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg></button><img className="ai-conversation-avatar" src="/assets/weeware-vps-logo.png" loading="eager" decoding="async" width="42" height="42" alt="WeeWare AI"/><div><strong>{t('WeeWare AI')}</strong><small>{activeConversation.title}</small></div></header>
          {error && <p className="error message-error">{error}</p>}
          <div className="conversation-messages">{activeConversation.messages.map((message) => <div className={`chat-row ${message.role === 'user' ? 'mine' : ''}`} key={message._id}><article className={`chat-bubble ${message.role === 'user' ? 'mine' : ''}`}><p>{message.text}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article></div>)}{sending && <div className="chat-row ai-typing-row" role="status" aria-label={t('WeeWare AI is typing')}><article className="chat-bubble ai-typing-bubble"><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span></article></div>}<div ref={endRef} /></div>
          <form className="message-compose" onSubmit={sendMessage}><input ref={inputRef} enterKeyHint="send" aria-label={t('Message the AI assistant')} placeholder={t('Ask WeeWare AI a question')} value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="submit" className="button send-comment-button message-send-button" aria-label={t('Send')} disabled={!draft.trim() || sending}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" /></svg></button></form>
        </> : <div className="empty-conversation"><span className="empty-chat-mark"><img src="/assets/weeware-vps-logo.png" alt=""/></span><h2>{t('Your AI conversations')}</h2><p className="muted">{t('Select a conversation or start a new one.')}</p>{error && <p className="error message-error">{error}</p>}</div>}
      </section>
    </section>
  </div>;
}

export function ResearcherIterationPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  return <div className="page role-tool-page">
    <header className="role-tool-heading"><div><span className="section-kicker">{t('RESEARCH WORKSPACE')}</span><h1 className="page-title">{t('System iteration')}</h1><p className="page-subtitle">{t('Review a dataset and prepare a LASSO model training iteration.')}</p></div><span className="role-tool-badge">{t('Preview')}</span></header>
    <div className="iteration-grid">
      <section className="card iteration-upload"><div className="iteration-section-title"><span className="iteration-step">01</span><div><h2>{t('Upload training dataset')}</h2><p>{t('Choose an Excel workbook containing the cleaned training observations.')}</p></div></div>
        <label className="excel-dropzone"><input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => { setFile(event.target.files?.[0] || null); setShowPreview(false); }}/><span className="excel-icon">XLS</span><strong>{file ? file.name : t('Choose an Excel file')}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB` : t('Supported formats: .xlsx and .xls')}</small><span className="button secondary">{t('Browse files')}</span></label>
        <div className="iteration-actions"><button type="button" className="button secondary" disabled={!file} onClick={() => setShowPreview(true)}>{t('Preview dataset')}</button><button type="button" className="button" disabled={!file} onClick={() => setShowPreview(true)}>{t('Prepare training')}</button></div>
        {showPreview && <div className="iteration-notice"><strong>{t('Prototype preview')}</strong><span>{t('Dataset parsing and LASSO retraining are not connected yet. Your selected file has not been uploaded.')}</span></div>}
      </section>
      <aside className="card iteration-checklist"><span className="section-kicker">{t('TRAINING WORKFLOW')}</span><h2>{t('Iteration overview')}</h2><ol><li><span>01</span><div><strong>{t('Upload dataset')}</strong><small>{t('Select the cleaned Excel workbook')}</small></div></li><li><span>02</span><div><strong>{t('Check variables')}</strong><small>{t('Confirm dates, weather inputs, and infestation target')}</small></div></li><li><span>03</span><div><strong>{t('Train LASSO')}</strong><small>{t('Review model settings before fitting')}</small></div></li><li><span>04</span><div><strong>{t('Validate results')}</strong><small>{t('Compare held-out predictions with observations')}</small></div></li></ol><p className="mock-note">{t('Training controls are a visual prototype and do not change the active prediction model.')}</p></aside>
    </div>
  </div>;
}
