import { useEffect, useRef, useState } from 'react';

export default function StyledDropdown({ value, options, onChange, label, icon = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <div className={`language-picker styled-dropdown ${className} ${open ? 'is-open' : ''}`} ref={root}>
    <button type="button" className="language-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {icon && <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>}
      <span>{selected?.shortLabel || selected?.label || ''}</span><svg className="language-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
    </button>
    {open && <div className="language-menu" role="listbox" aria-label={label}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`language-option ${option.value === value ? 'active' : ''}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.code && <small>{option.code}</small>}{option.value === value && <b aria-hidden="true">✓</b>}</button>)}</div>}
  </div>;
}
