import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { assetUrl } from '../api';
import { useAuth } from '../auth';
import { useTranslation } from 'react-i18next';

function ProfileLink({ person, className = '', children }) {
  const navigate = useNavigate();
  if (!person?._id) return <strong className={className}>{children}</strong>;
  return <button type="button" className={`forum-profile-name ${className}`} onClick={() => navigate(`/app/profile/${person._id}`)}>{children}</button>;
}

function HeartIcon({ filled = false }) {
  return <svg className={`heart-icon ${filled ? 'filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.3 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>;
}

function PostMediaGallery({ media = [] }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const visibleCount = Math.min(media.length, 4);
  const shownMedia = media.slice(0, visibleCount);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight') { setActiveIndex((index) => (index + 1) % media.length); setZoom(1); }
      if (event.key === 'ArrowLeft') { setActiveIndex((index) => (index - 1 + media.length) % media.length); setZoom(1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, media.length]);

  const renderMedia = (item, alt = 'Post attachment') => item.type === 'video'
    ? <video controls autoPlay muted playsInline src={assetUrl(item.url)} aria-label={alt} />
    : <img loading="lazy" src={assetUrl(item.url)} alt={alt} />;

  return <>
    <div className={`post-media-gallery count-${visibleCount} ${media.length === 1 ? 'single' : ''}`}>
      {shownMedia.map((item, index) => <div className="post-media-tile" key={`${item.url}-${index}`} role="button" tabIndex={0} onClick={(event) => { if (event.target.tagName === 'VIDEO') return; setActiveIndex(index); setZoom(1); setOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); setZoom(1); setOpen(true); } }} aria-label={`View attachment ${index + 1} of ${media.length}`}>
        {renderMedia(item)}
        {media.length > 4 && index === 3 && <span className="post-media-more"><b>+{media.length - 4}</b></span>}
      </div>)}
    </div>
    {open && <div className="post-gallery-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="post-gallery-dialog" role="dialog" aria-modal="true" aria-label="Post photos and videos">
        <button type="button" className="post-gallery-close" onClick={() => setOpen(false)} aria-label="Close gallery">Close</button>
        <button type="button" className="post-gallery-nav previous" onClick={() => { setActiveIndex((index) => (index - 1 + media.length) % media.length); setZoom(1); }} aria-label="Previous attachment">Prev</button>
        <div className="post-gallery-current">{media[activeIndex].type === 'video' ? renderMedia(media[activeIndex], `Post attachment ${activeIndex + 1} of ${media.length}`) : <img src={assetUrl(media[activeIndex].url)} alt={`Post attachment ${activeIndex + 1} of ${media.length}`} style={{ transform: `scale(${zoom})` }} />}</div>
        <button type="button" className="post-gallery-nav next" onClick={() => { setActiveIndex((index) => (index + 1) % media.length); setZoom(1); }} aria-label="Next attachment">Next</button>
        <div className="post-gallery-count">{activeIndex + 1} / {media.length}</div>
        <div className="post-gallery-zoom" aria-label="Image zoom controls"><button type="button" onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))} disabled={zoom <= 1} aria-label="Zoom out">-</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))))} disabled={zoom >= 4} aria-label="Zoom in">+</button></div>
      </section>
    </div>}
  </>;
}

function CommentItem({ comment, currentUserId, isAdmin, onReply, onLike, onDelete }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = comment.content || '';
  const isLong = !comment.isDeleted && text.length > 360;
  return <article id={`comment-item-${comment._id}`} className={`comment ${comment.parent ? 'comment-reply-item' : ''} ${comment.isDeleted ? 'comment-deleted' : ''}`}>
    <img className="comment-avatar" src={assetUrl(comment.author?.profilePicture) || '/assets/weeware.png'} alt={`${comment.author?.fullName || 'Member'} profile`} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} />
    <div className="comment-content-column">
      {comment.replyContext && <div className="reply-context" role="note"><span><ProfileLink person={comment.author}>{comment.author?.fullName || 'A member'}</ProfileLink> replied to <ProfileLink person={comment.replyContext.author}>{comment.replyContext.author?.fullName || 'a member'}</ProfileLink></span><blockquote>{comment.replyContext.content}</blockquote></div>}
      <div className="comment-bubble">
        <ProfileLink person={comment.author} className="comment-author">{comment.author?.fullName || 'WeeWare member'}</ProfileLink>
        <div className="comment-text">{isLong && !expanded ? `${text.slice(0, 360).trimEnd()}…` : text}</div>
        {isLong && <button className="see-more-button" onClick={() => setExpanded((value) => !value)}>{expanded ? t('See less') : t('See more')}</button>}
      </div>
      <div className="comment-meta"><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>{!comment.isDeleted && <><button className={`comment-action reaction-button ${comment.isLikedByMe ? 'reacted' : ''}`} aria-label={comment.isLikedByMe ? t('Unlike comment') : t('Like comment')} title={comment.isLikedByMe ? t('Unlike') : t('Like')} aria-pressed={Boolean(comment.isLikedByMe)} onClick={() => onLike(comment._id)}><HeartIcon filled={comment.isLikedByMe} />{comment.likesCount > 0 && <span>{comment.likesCount}</span>}</button><button className="comment-action" onClick={() => onReply(comment)}>{t('Reply')}</button>{(comment.isMine || String(comment.author?._id || comment.author) === String(currentUserId) || isAdmin || comment.canAdminDelete) && <button disabled={!isAdmin && !comment.canAdminDelete && comment.deletionStatus === 'pending'} className="comment-action delete-comment-button" onClick={() => onDelete(comment)}>{isAdmin || comment.canAdminDelete ? t('Remove') : comment.deletionStatus === 'pending' ? t('Request pending') : t('Request delete')}</button>}</>}</div>
      {comment.replies?.length > 0 && <div className="comment-replies"><CommentTree items={comment.replies} currentUserId={currentUserId} isAdmin={isAdmin} onReply={onReply} onLike={onLike} onDelete={onDelete} /></div>}
    </div>
  </article>;
}

function CommentTree({ items, currentUserId, isAdmin, onReply, onLike, onDelete }) {
  const flatten = (root) => {
    const replies = [];
    const visit = (parent) => {
      for (const child of parent.replies || []) {
        replies.push({ ...child, replyContext: child.replyContext || { author: parent.author, content: parent.content, isDeleted: parent.isDeleted }, replies: [] });
        visit(child);
      }
    };
    visit(root);
    return { ...root, replies };
  };
  const threadItems = items.map(flatten);
  return <div className="comment-tree">{threadItems.map((comment) => <CommentItem key={comment._id} comment={comment} currentUserId={currentUserId} isAdmin={isAdmin} onReply={onReply} onLike={onLike} onDelete={onDelete} />)}</div>;
}

export default function ForumPage({ profileId = '', compact = false }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const targetPost = searchParams.get('post');
  const targetComment = searchParams.get('comment');
  const composeRequested = searchParams.get('compose') === '1';
  const navigate = useNavigate();
  const composerRef = useRef(null);
  const [searchText, setSearchText] = useState(query);
  const [posts, setPosts] = useState([]);
  const [people, setPeople] = useState([]);
  const [searchFilter, setSearchFilter] = useState('all');
  const [searchHasMore, setSearchHasMore] = useState({ users: false, posts: false });
  const [searchPage, setSearchPage] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMoreBusy, setSearchMoreBusy] = useState(false);
  const [profilePostsLoading, setProfilePostsLoading] = useState(Boolean(profileId));
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [open, setOpen] = useState({});
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState('');
  const [notice, setNotice] = useState('');
  const searchRequestRef = useRef(0);

  async function load() {
    const requestId = ++searchRequestRef.current;
    if (!profileId && query.trim()) {
      setSearchLoading(true);
      try {
        const { data } = await api.get('/posts/search', { params: { q: query, page: 0, limit: 20 } });
        if (requestId !== searchRequestRef.current) return;
        setPosts(data.posts || []);
        setPeople(data.users || []);
        setSearchHasMore(data.hasMore || { users: false, posts: false });
        setSearchPage(0);
        return;
      } catch (err) {
        if (requestId === searchRequestRef.current) setError(err.message);
      } finally {
        if (requestId === searchRequestRef.current) setSearchLoading(false);
      }
      return;
    }
    if (!profileId) {
      setSearchLoading(false);
      setPeople([]);
      setSearchHasMore({ users: false, posts: false });
      setSearchPage(0);
    }
    if (profileId) setProfilePostsLoading(true);
    try {
      if (!profileId) {
        const { data } = await api.get('/posts');
        setPosts(data.posts || []);
        return;
      }
      // Keep profile feeds working against older API workers that still compare
      // an ObjectId author field to the raw string query parameter.
      const { data } = await api.get('/posts', { params: { limit: 500, q: query } });
      const wantedId = String(profileId);
      setPosts((data.posts || []).filter((post) => String(post.author?._id || post.author) === wantedId));
    }
    catch (err) { setError(err.message); }
    finally { if (profileId) setProfilePostsLoading(false); }
  }
  async function loadMoreSearchResults() {
    if (searchMoreBusy) return;
    setSearchMoreBusy(true);
    try {
      const page = searchPage + 1;
      const { data } = await api.get('/posts/search', { params: { q: query, page, limit: 20 } });
      setPosts((current) => [...current, ...(data.posts || []).filter((post) => !current.some((item) => item._id === post._id))]);
      setPeople((current) => [...current, ...(data.users || []).filter((person) => !current.some((item) => item._id === person._id))]);
      setSearchHasMore(data.hasMore || { users: false, posts: false });
      setSearchPage(page);
    } catch (err) { setError(err.message); }
    finally { setSearchMoreBusy(false); }
  }
  async function loadComments(id) {
    try { const { data } = await api.get(`/posts/${id}/comments`); setComments((old) => ({ ...old, [id]: data.comments || [] })); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [query, profileId]);
  useEffect(() => {
    if (!composeRequested) return;
    const frame = requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      composerRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [composeRequested]);
  useEffect(() => {
    if (!targetPost) return;
    setOpen((old) => ({ ...old, [targetPost]: true }));
    loadComments(targetPost);
  }, [targetPost]);
  useEffect(() => {
    if (!targetPost || !posts.some((post) => post._id === targetPost)) return;
    const timer = setTimeout(() => document.getElementById(targetComment ? `comment-item-${targetComment}` : `post-${targetPost}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
    return () => clearTimeout(timer);
  }, [targetPost, targetComment, posts, comments]);
  useEffect(() => { setSearchText(query); }, [query]);
  useEffect(() => { setSearchFilter('all'); }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => { const value = searchText.trim(); setSearchParams(value ? { q: value } : {}, { replace: true }); }, 250);
    return () => clearTimeout(timer);
  }, [searchText, setSearchParams]);
  useEffect(() => {
    const socket = io('/', { path: '/socket.io', withCredentials: true });
    socket.on('post:created', load);
    socket.on('post:deleted', ({ postId }) => setPosts((rows) => rows.filter((post) => post._id !== postId)));
    socket.on('post:liked', ({ postId, likesCount }) => setPosts((rows) => rows.map((post) => post._id === postId ? { ...post, likesCount } : post)));
    socket.on('comment:created', ({ post }) => { if (open[post]) loadComments(post); setPosts((rows) => rows.map((item) => item._id === String(post) ? { ...item, commentCount: (item.commentCount || 0) + 1 } : item)); });
    socket.on('comment:deleted', ({ post, commentId }) => { if (open[post]) loadComments(post); setPosts((rows) => rows.map((item) => item._id === String(post) ? { ...item, commentCount: Math.max(0, (item.commentCount || 0) - 1) } : item)); });
    socket.on('comment:liked', ({ postId }) => { if (open[postId]) loadComments(postId); });
    return () => socket.disconnect();
  }, [Object.keys(open).join(',')]);

  async function createPost(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { let media = []; if (files.length) { const form = new FormData(); [...files].forEach((file) => form.append('files', file)); const result = await api.post('/uploads', form, { timeout: 10 * 60 * 1000 }); media = result.data.files; } const { data } = await api.post('/posts', { content: text, media }); setNotice(data.message || 'Your post is awaiting admin approval.'); setText(''); setFiles([]); setSelectedFiles(''); event.target.reset(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function toggleLike(id) {
    try { const { data } = await api.post(`/posts/${id}/like`); setPosts((rows) => rows.map((post) => post._id === id ? { ...post, likesCount: data.likesCount, isLikedByMe: data.liked } : post)); }
    catch (err) { setError(err.message); }
  }
  async function sendComment(postId, event) {
    event.preventDefault(); const content = (drafts[postId] || '').trim(); if (!content) return;
    try { if (replyTo?.postId === postId) await api.post(`/comments/${replyTo.commentId}/replies`, { content }); else await api.post(`/posts/${postId}/comments`, { content }); setDrafts((old) => ({ ...old, [postId]: '' })); setReplyTo(null); await loadComments(postId); }
    catch (err) { setError(err.message); }
  }
  async function likeComment(id, postId) { try { await api.post(`/comments/${id}/like`); await loadComments(postId); } catch (err) { setError(err.message); } }
  async function deleteComment(comment, postId) {
    if (user?.role === 'admin') {
      if (!window.confirm('Remove this comment from the forum?')) return;
      try { await api.delete(`/moderation/admin/content/comment/${comment._id}`); await loadComments(postId); setNotice('Comment removed. The author was notified.'); }
      catch (err) { setError(err.message); }
      return;
    }
    if (!window.confirm('Send this comment to the administrator for deletion review?')) return;
    try { const { data } = await api.delete(`/comments/${comment._id}`); await loadComments(postId); setNotice(data.message); }
    catch (err) { setError(err.message); }
  }

  return <div className={`page forum-page ${compact ? 'forum-profile-feed' : ''}`}>
    {!compact && <>
      <h1 className="page-title">{t('Community forum')}</h1>
      <p className="page-subtitle">{t('Share field observations, ask questions, and learn from the Palawan community.')}</p>
      <label className="field community-search"><span>{t('Search community')}</span><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t('Search posts and people…')} /></label>
      {query && <><p className="community-search-summary">{t('Search results for “{{query}}”', { query })}</p><div className="community-search-filters" role="tablist" aria-label={t('Filter search results')}><button type="button" role="tab" aria-selected={searchFilter === 'all'} className={searchFilter === 'all' ? 'active' : ''} onClick={() => setSearchFilter('all')}>{t('All')}</button><button type="button" role="tab" aria-selected={searchFilter === 'posts'} className={searchFilter === 'posts' ? 'active' : ''} onClick={() => setSearchFilter('posts')}>{t('Posts')}</button><button type="button" role="tab" aria-selected={searchFilter === 'people'} className={searchFilter === 'people' ? 'active' : ''} onClick={() => setSearchFilter('people')}>{t('People')}</button></div></>}
    </>}
    {notice && <p className="success">{notice}</p>}{error && <p className="error">{error}</p>}
    {!profileId && !query && <form className="card" onSubmit={createPost} style={{ marginBottom: 18 }}><div className="field"><label>{t('Share an observation')}</label><textarea ref={composerRef} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('What are you seeing in the field?')} /></div><div className="row post-compose-actions"><label className="upload-picker"><input type="file" multiple accept="image/*,video/*" onChange={(event) => { setFiles(event.target.files); setSelectedFiles([...event.target.files].map((file) => file.name).join(', ')); }} /><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg><span>{selectedFiles || t('Add photos or video')}</span></label><button className="button" disabled={busy || (!text.trim() && !files.length)}>{busy ? t('Posting…') : t('Post to community')}</button></div></form>}
    {query && searchFilter !== 'posts' && <section className="community-people-results"><div className="community-results-heading"><h2>{t('People')}</h2><span>{people.length}</span></div>{searchLoading && !people.length ? <p className="muted">{t('Searching people…')}</p> : people.length ? <div className="community-people-list">{people.map((person) => <article className="community-person-result" key={person._id}><button type="button" className="community-person-main" onClick={() => navigate(`/app/profile/${person._id}`)}><img src={assetUrl(person.profilePicture) || '/assets/weeware.png'} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }}/><span><strong>{person.fullName}</strong><small>{t(person.role || 'farmer')}</small></span></button><div className="community-person-actions"><button type="button" className="button secondary" onClick={() => navigate(`/app/profile/${person._id}`)}>{t('View profile')}</button><button type="button" className="button" onClick={() => navigate(`/app/messages?user=${person._id}`)}>{t('Message')}</button></div></article>)}</div> : <p className="muted">{t('No matching people.')}</p>}</section>}
    {searchLoading || profilePostsLoading ? <div className="card empty-state"><p>{t('Loading search results…')}</p></div> : searchFilter !== 'people' && posts.length ? posts.map((post) => <article id={`post-${post._id}`} className="card post-card" key={post._id}>
      <div className="post-header"><button type="button" className="post-author-profile" onClick={() => post.author?._id && navigate(`/app/profile/${post.author._id}`)}><img src={assetUrl(post.author?.profilePicture) || '/assets/weeware.png'} alt="" /><span><strong>{post.author?.fullName || t('Community member')}</strong></span></button><small className="post-created-at">{new Date(post.createdAt).toLocaleString()}{post.publishStatus === 'pending' && post.isMine ? <span className="post-pending-badge"> · Awaiting admin approval</span> : null}</small>{!post.isMine && post.author?._id && <button className="button secondary message-author-button" onClick={() => navigate(`/app/messages?user=${post.author._id}`)}>{t('Message')}</button>}</div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{post.content}</p>{post.media?.length > 0 && <PostMediaGallery media={post.media} />}
      <div className="row post-actions"><button className={`quiet-button reaction-button ${post.isLikedByMe ? 'reacted' : ''}`} aria-label={post.isLikedByMe ? t('Unlike post') : t('Like post')} aria-pressed={Boolean(post.isLikedByMe)} onClick={() => toggleLike(post._id)}><HeartIcon filled={post.isLikedByMe} /><span>{post.likesCount || 0}</span></button><button className="quiet-button" onClick={() => { setOpen((old) => ({ ...old, [post._id]: !old[post._id] })); if (!open[post._id]) loadComments(post._id); }}>▤ {post.commentCount || 0} {t('comments')}</button>{(post.isMine || String(post.author?._id || post.author) === String(user?.id || user?._id) || user?.role === 'admin') && <button className="quiet-button request-delete-post-button" onClick={async () => { if (user?.role === 'admin') { if (!window.confirm(t('Remove this post from the forum?'))) return; try { await api.delete(`/moderation/admin/content/post/${post._id}`); await load(); setNotice(t('Post removed. The author was notified.')); } catch (err) { setError(err.message); } } else if (window.confirm(t('Send this post to the administrator for deletion review?'))) { try { const { data } = await api.delete(`/posts/${post._id}`); setNotice(t(data.message)); } catch (err) { setError(err.message); } } }}>{user?.role === 'admin' ? t('Remove post') : t('Request delete')}</button>}</div>
      {open[post._id] && <div className="comment-section"><CommentTree items={comments[post._id] || []} currentUserId={user?.id || user?._id} isAdmin={user?.role === 'admin'} onReply={(comment) => { setReplyTo({ postId: post._id, commentId: comment._id, comment }); requestAnimationFrame(() => document.getElementById(`comment-${post._id}`)?.focus()); }} onLike={(id) => likeComment(id, post._id)} onDelete={(comment) => deleteComment(comment, post._id)} />{replyTo?.postId === post._id && <div className="replying-to-banner"><div><span>Replying to</span> <strong>{replyTo.comment?.author?.fullName || 'comment'}</strong><blockquote>{replyTo.comment?.content}</blockquote></div><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">×</button></div>}<form className="comment-compose" onSubmit={(event) => sendComment(post._id, event)}><img className="comment-compose-avatar" src={assetUrl(user?.profilePicture) || '/assets/weeware.png'} alt="Your profile" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/assets/weeware.png'; }} /><input id={`comment-${post._id}`} className="comment-input" value={drafts[post._id] || ''} onChange={(event) => setDrafts((old) => ({ ...old, [post._id]: event.target.value }))} placeholder={replyTo?.postId === post._id ? 'Write a reply…' : 'Write a comment…'} /><button className="button send-comment-button" aria-label={replyTo?.postId === post._id ? 'Send reply' : 'Send comment'} title={replyTo?.postId === post._id ? 'Send reply' : 'Send comment'} disabled={!(drafts[post._id] || '').trim()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" /></svg></button></form></div>}
    </article>) : searchFilter !== 'people' && <div className="card empty-state"><h3>{query ? t('No matching posts') : profileId ? t('No public posts yet') : t('The feed is quiet')}</h3><p>{profileId ? t('Approved posts from this member will appear here.') : t('Share a field observation to begin the conversation.')}</p></div>}
    {query && (searchFilter === 'people' ? searchHasMore.users : searchFilter === 'posts' ? searchHasMore.posts : searchHasMore.posts || searchHasMore.users) && <div className="community-load-more"><button type="button" className="button secondary" onClick={loadMoreSearchResults} disabled={searchMoreBusy}>{searchMoreBusy ? t('Loading…') : t('Load more results')}</button></div>}
  </div>;
}
