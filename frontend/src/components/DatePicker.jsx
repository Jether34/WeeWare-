import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const localDate = (value) => new Date(`${value}T00:00:00`);
const isoLocal = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inRangeDate = (value, min, max) => {
  const candidate = value || localToday();
  if (candidate < min) return min;
  if (candidate > max) return max;
  return candidate;
};

export default function DatePicker({ value, min = '1900-01-01', max = '2100-12-31', onChange, todayLabel, showToday = true, showJanuary = false }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [choosingYear, setChoosingYear] = useState(false);
  const pickerRef = useRef(null);
  const selectedYearRef = useRef(null);
  const [view, setView] = useState(() => { const date = localDate(inRangeDate(value, min, max)); return new Date(date.getFullYear(), date.getMonth(), 1); });
  useEffect(() => { const close = (event) => { if (!pickerRef.current?.contains(event.target)) setOpen(false); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, []);
  useEffect(() => { if (choosingYear) selectedYearRef.current?.scrollIntoView({ block: 'center' }); }, [choosingYear]);
  const firstDay = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const locale = ({ en: 'en-US', tl: 'fil-PH', ceb: 'ceb-PH', hil: 'hil-PH', krj: 'krj-PH', cyo: 'fil-PH' })[i18n.resolvedLanguage] || 'en-US';
  const localizedMonthTitle = view.toLocaleDateString(locale, { month: 'long' });
  const weekStart = new Date(2023, 0, 1);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index).toLocaleDateString(locale, { weekday: 'short' }));
  const firstYear = Number(min.slice(0, 4));
  const lastYear = Number(max.slice(0, 4));
  const years = Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, index) => firstYear + index);
  const previous = new Date(view.getFullYear(), view.getMonth() - 1, 1);
  const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  const canPrev = isoLocal(new Date(previous.getFullYear(), previous.getMonth() + 1, 0)) >= min;
  const canNext = isoLocal(next) <= max;
  const choose = (day) => { const date = new Date(view.getFullYear(), view.getMonth(), day); onChange(isoLocal(date)); setOpen(false); setChoosingYear(false); };
  const today = () => { const current = localToday(); if (current < min || current > max) return; onChange(current); const date = localDate(current); setView(new Date(date.getFullYear(), date.getMonth(), 1)); setOpen(false); setChoosingYear(false); };
  const minDate = localDate(min);
  const januaryYear = minDate.getMonth() > 0 && isoLocal(new Date(minDate.getFullYear(), 0, 31)) < min ? minDate.getFullYear() + 1 : minDate.getFullYear();
  const canJumpJanuary = `${januaryYear}-01-01` <= max;
  const jumpToJanuary = () => { if (canJumpJanuary) { setView(new Date(januaryYear, 0, 1)); setChoosingYear(false); } };
  const chooseYear = (year) => { setView(new Date(year, view.getMonth(), 1)); setChoosingYear(false); };
  const toggleCalendar = () => { if (!open) { const date = localDate(inRangeDate(value, min, max)); setView(new Date(date.getFullYear(), date.getMonth(), 1)); setChoosingYear(false); } setOpen((state) => !state); };
  return <div className={`date-picker ${open ? 'is-open' : ''}`} ref={pickerRef} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
    <div className="date-picker-shell"><button type="button" className="date-calendar-open" aria-label={t('Open calendar')} title={t('Open calendar')} aria-haspopup="dialog" aria-expanded={open} onClick={toggleCalendar}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg></button><button type="button" className="date-value-button" onClick={toggleCalendar} aria-haspopup="dialog" aria-expanded={open}>{value ? localDate(value).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : t('Choose date')}</button>{showToday && <button type="button" className="today-button" onClick={today} disabled={localToday() < min || localToday() > max}>{todayLabel || t('Today')}</button>}</div>
    {open && <div className="date-calendar-popover" role="dialog" aria-label={t('Choose date')}><div className="calendar-heading"><button type="button" className="calendar-nav" onClick={() => setView(previous)} disabled={choosingYear || !canPrev} aria-label={t('Previous month')}>‹</button><button type="button" className={`calendar-month-year ${choosingYear ? 'active' : ''}`} onClick={() => setChoosingYear((current) => !current)} aria-label={choosingYear ? t('Close year picker') : t('Choose year, currently {{year}}', { year: view.getFullYear() })} aria-expanded={choosingYear}><span>{localizedMonthTitle} {view.getFullYear()}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></button><button type="button" className="calendar-nav" onClick={() => setView(next)} disabled={choosingYear || !canNext} aria-label={t('Next month')}>›</button></div>{choosingYear ? <div className="calendar-year-grid" role="listbox" aria-label={t('Choose year')}>{years.map((year) => <button type="button" role="option" aria-selected={year === view.getFullYear()} ref={year === view.getFullYear() ? selectedYearRef : null} key={year} className={`calendar-year ${year === view.getFullYear() ? 'selected' : ''}`} onClick={() => chooseYear(year)}>{year}</button>)}</div> : <><div className="calendar-grid calendar-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: firstDay }, (_, index) => <span className="calendar-empty" key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const day = index + 1; const date = isoLocal(new Date(view.getFullYear(), view.getMonth(), day)); const disabled = date < min || date > max; return <button type="button" key={date} className={`calendar-day ${date === value ? 'selected' : ''} ${date === localToday() ? 'today' : ''}`} disabled={disabled} aria-pressed={date === value} onClick={() => choose(day)}>{day}</button>; })}</div><div className="calendar-footer"><span>{t('Select a date')}</span><div className="calendar-footer-actions">{showJanuary && canJumpJanuary && <button type="button" onClick={jumpToJanuary}>{t('Jump to January')}</button>}{showToday && <button type="button" onClick={today} disabled={localToday() < min || localToday() > max}>{t('Go to today')}</button>}</div></div></>}</div>}
  </div>;
}
