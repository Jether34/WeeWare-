import { useEffect, useRef, useState } from 'react';

export default function ConfirmDialog({ open, title, children, confirmLabel = 'Okay', cancelLabel = 'Cancel', variant = 'info', onConfirm, onClose, busy = false }) {
  const confirmRef = useRef(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();
    const closeOnEscape = (event) => { if (event.key === 'Escape' && !busy && !working) onClose?.(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, busy, working, onClose]);
  if (!open) return null;
  const confirm = async () => {
    if (busy || working) return;
    setWorking(true);
    try {
      const result = await onConfirm?.();
      if (result !== false) onClose?.();
    } finally { setWorking(false); }
  };
  const isBusy = busy || working;
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBusy) onClose?.(); }}>
    <section className={`confirm-dialog confirm-dialog-${variant}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description">
      <span className="confirm-dialog-icon" aria-hidden="true">{variant === 'danger' ? '!' : '?'}</span>
      <h2 id="confirm-dialog-title">{title}</h2>
      <div className="confirm-dialog-copy" id="confirm-dialog-description">{children}</div>
      <div className="confirm-dialog-actions">
        {cancelLabel && <button type="button" className="button secondary" onClick={onClose} disabled={isBusy}>{cancelLabel}</button>}
        <button ref={confirmRef} type="button" className={`button ${variant === 'danger' ? 'danger' : ''}`} onClick={confirm} disabled={isBusy}>{isBusy ? 'Please wait…' : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
