import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { isPalawanCoordinate } from './PalawanMangoAreas';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function Compass({ heading, active, error, onToggle, t }) {
  const degrees = Number.isFinite(heading) ? Math.round(heading) : null;
  const direction = degrees === null ? 'N' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
  return <div className={`map-compass ${active ? 'is-active' : ''}`}>
    <button className="map-compass-button" type="button" onClick={onToggle} aria-label={active ? t('Stop compass') : t('Enable live compass')} title={error || (active ? t('Live compass') : t('Enable live compass'))}>
      <span className="compass-cardinal compass-north">N</span><span className="compass-cardinal compass-east">E</span><span className="compass-cardinal compass-south">S</span><span className="compass-cardinal compass-west">W</span>
      <span className="compass-needle" style={{ transform: `rotate(${degrees === null ? 0 : -degrees}deg)` }}><i/><b/></span>
      <span className="compass-center"/>
    </button>
    <span className="compass-reading">{degrees === null ? t('North up') : `${direction} · ${degrees}°`}</span>
  </div>;
}

export function MapLocationSearch({ onSelect, t }) {
  const map = useMap();
  const overlaysRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tracking, setTracking] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [heading, setHeading] = useState(null);
  const [compassActive, setCompassActive] = useState(false);
  const [compassError, setCompassError] = useState('');
  const watchId = useRef(null);
  const lastTrackedPoint = useRef(null);
  const orientationHandler = useRef(null);
  const selectedQuery = useRef('');

  useEffect(() => {
    const term = query.trim();
    if (term && term === selectedQuery.current) { selectedQuery.current = ''; setResults([]); setBusy(false); return undefined; }
    if (term.length < 2) { setResults([]); setBusy(false); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setMessage('');
      try {
        const params = new URLSearchParams({ format: 'jsonv2', q: `${term}, Palawan, Philippines`, limit: '6', countrycodes: 'ph', viewbox: '116,12.9,121,7', bounded: '1', addressdetails: '1' });
        const response = await fetch(`${NOMINATIM_URL}?${params}`, { signal: controller.signal, headers: { 'Accept-Language': navigator.language || 'en' } });
        if (!response.ok) throw new Error(t('Location search is temporarily unavailable.'));
        const rows = (await response.json()).filter((row) => isPalawanCoordinate([Number(row.lat), Number(row.lon)]));
        setResults(rows);
        if (!rows.length) setMessage(t('No matching location found in Palawan.'));
      } catch (error) {
        if (error.name !== 'AbortError') { setResults([]); setMessage(error.message || t('Location search is temporarily unavailable.')); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, t]);

  useEffect(() => {
    const overlays = overlaysRef.current;
    if (!overlays) return undefined;
    L.DomEvent.disableClickPropagation(overlays);
    L.DomEvent.disableScrollPropagation(overlays);
    return () => {
      L.DomEvent.off(overlays, 'click');
      L.DomEvent.off(overlays, 'dblclick');
      L.DomEvent.off(overlays, 'mousedown');
      L.DomEvent.off(overlays, 'touchstart');
      L.DomEvent.off(overlays, 'touchend');
      L.DomEvent.off(overlays, 'contextmenu');
      L.DomEvent.off(overlays, 'wheel');
      L.DomEvent.off(overlays, 'mousewheel');
    };
  }, [map]);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    if (orientationHandler.current) {
      window.removeEventListener('deviceorientation', orientationHandler.current, true);
      window.removeEventListener('deviceorientationabsolute', orientationHandler.current, true);
    }
  }, []);

  function choose(row) {
    const point = [Number(row.lat), Number(row.lon)];
    onSelect(point);
    map.flyTo(point, Math.max(map.getZoom(), 11), { duration: 0.7 });
    const displayName = row.display_name.split(',').slice(0, 2).join(', ');
    selectedQuery.current = displayName;
    setQuery(displayName);
    setResults([]);
    setMessage('');
  }

  function stopFollowing() {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setTracking(false);
  }

  function toggleLocation() {
    if (tracking) { stopFollowing(); return; }
    if (!navigator.geolocation) { setMessage(t('Location is not available in this browser.')); return; }
    setMessage('');
    lastTrackedPoint.current = null;
    setTracking(true);
    watchId.current = navigator.geolocation.watchPosition(({ coords }) => {
      const point = [coords.latitude, coords.longitude];
      setAccuracy(Number.isFinite(coords.accuracy) ? coords.accuracy : null);
      if (!isPalawanCoordinate(point)) { setMessage(t('Your current location is outside the supported Palawan map area.')); return; }
      setMessage('');
      onSelect(point);
      const previous = lastTrackedPoint.current;
      const movedEnough = !previous || map.distance(previous, point) > Math.max(8, Number(coords.accuracy || 0) / 2);
      if (movedEnough) map.flyTo(point, Math.max(map.getZoom(), 11), { duration: 0.65 });
      lastTrackedPoint.current = point;
    }, (error) => {
      stopFollowing();
      setMessage(error.code === error.PERMISSION_DENIED ? t('Location permission was not granted.') : t('Could not read your current location.'));
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  async function toggleCompass() {
    if (compassActive) {
      if (orientationHandler.current) {
        window.removeEventListener('deviceorientation', orientationHandler.current, true);
        window.removeEventListener('deviceorientationabsolute', orientationHandler.current, true);
      }
      orientationHandler.current = null;
      setCompassActive(false);
      return;
    }
    setCompassError('');
    try {
      const orientation = window.DeviceOrientationEvent;
      if (!orientation) { setCompassError(t('Compass is not available on this device.')); return; }
      if (typeof orientation.requestPermission === 'function') {
        const permission = await orientation.requestPermission();
        if (permission !== 'granted') { setCompassError(t('Motion permission was not granted.')); return; }
      }
      const handler = (event) => {
        const webkitHeading = event.webkitCompassHeading;
        const raw = Number.isFinite(webkitHeading) ? webkitHeading : (event.alpha == null ? null : 360 - event.alpha);
        if (Number.isFinite(raw)) setHeading(((raw % 360) + 360) % 360);
      };
      orientationHandler.current = handler;
      window.addEventListener('deviceorientation', handler, true);
      window.addEventListener('deviceorientationabsolute', handler, true);
      setCompassActive(true);
    } catch { setCompassError(t('Motion permission was not granted.')); }
  }

  function submitSearch(event) {
    event.preventDefault();
    if (results[0]) choose(results[0]);
  }

  return <div ref={overlaysRef} className="map-interaction-overlays">
    <div className="map-search-controls">
      <form className="map-location-search" onSubmit={submitSearch} role="search">
        <svg className="map-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>
        <label className="sr-only" htmlFor="map-location-query">{t('Search Palawan location')}</label>
        <input id="map-location-query" value={query} onChange={(event) => { selectedQuery.current = ''; setQuery(event.target.value); }} placeholder={t('Search a place in Palawan')} autoComplete="off" aria-autocomplete="list" aria-controls="map-search-results" aria-expanded={results.length > 0} />
        {busy && <span className="map-search-spinner" aria-label={t('Searching…')}/>}
        {query && <button className="map-search-clear" type="button" aria-label={t('Clear search')} onClick={() => { setQuery(''); setMessage(''); }}>×</button>}
      </form>
      <button type="button" className={`map-locate-button ${tracking ? 'is-tracking' : ''}`} onClick={toggleLocation} title={tracking ? t('Stop following') : t('Use my location')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></svg>
        <span>{tracking ? t('Stop following') : t('Use my location')}</span>
      </button>
      {message && <p className="map-search-message" role="status">{message}</p>}
      {results.length > 0 && <div id="map-search-results" className="map-search-results" role="listbox" aria-label={t('Location suggestions')}>
        {results.map((row) => <button type="button" role="option" aria-selected="false" key={row.place_id} onClick={() => choose(row)}><span className="map-result-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><span><strong>{row.name || row.display_name.split(',')[0]}</strong><small>{row.display_name}</small></span><svg className="map-result-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>)}
      </div>}
    </div>
    <Compass heading={heading} active={compassActive} error={compassError} onToggle={toggleCompass} t={t}/>
    {tracking && <div className="map-live-location"><i/>{t('Live location')}{accuracy !== null && <small>±{Math.round(accuracy)} m</small>}</div>}
  </div>;
}
