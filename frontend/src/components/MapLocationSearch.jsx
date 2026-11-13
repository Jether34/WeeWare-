import { useState } from 'react';
import { useMap } from 'react-leaflet';
import { isPalawanCoordinate } from './PalawanMangoAreas';

export function MapLocationSearch({ onSelect, t }) {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setMessage(''); setResults([]);
    try {
      const params = new URLSearchParams({ format: 'jsonv2', q: `${query.trim()}, Palawan, Philippines`, limit: '5', countrycodes: 'ph', viewbox: '116,12.9,121,7', bounded: '1' });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!response.ok) throw new Error('Location search is temporarily unavailable.');
      const rows = (await response.json()).filter((row) => isPalawanCoordinate([Number(row.lat), Number(row.lon)]));
      setResults(rows);
      if (!rows.length) setMessage(t('No matching location found in Palawan.'));
    } catch (error) { setMessage(error.message || t('Location search is temporarily unavailable.')); }
    finally { setBusy(false); }
  }
  function choose(row) {
    const point = [Number(row.lat), Number(row.lon)];
    onSelect(point);
    map.flyTo(point, Math.max(map.getZoom(), 11), { duration: 0.7 });
    setQuery(row.display_name.split(',').slice(0, 2).join(',')); setResults([]); setMessage('');
  }
  function locate() {
    if (!navigator.geolocation) { setMessage(t('Location is not available in this browser.')); return; }
    setBusy(true); setMessage('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = [coords.latitude, coords.longitude];
      if (!isPalawanCoordinate(point)) setMessage(t('Your current location is outside the supported Palawan map area.'));
      else { onSelect(point); map.flyTo(point, Math.max(map.getZoom(), 11), { duration: 0.7 }); }
      setBusy(false);
    }, () => { setMessage(t('Location permission was not granted.')); setBusy(false); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  return <div className="map-search-controls"><form className="map-location-search" onSubmit={search}><label className="sr-only" htmlFor="map-location-query">{t('Search Palawan location')}</label><input id="map-location-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search a place in Palawan')}/><button className="button secondary" disabled={busy}>{busy ? t('Searching…') : t('Search')}</button></form><button type="button" className="button secondary" onClick={locate} disabled={busy}>{t('Use my location')}</button>{message && <p className="map-search-message" role="status">{message}</p>}{results.length > 0 && <div className="map-search-results" role="listbox">{results.map((row) => <button type="button" key={row.place_id} onClick={() => choose(row)}>{row.display_name}</button>)}</div>}</div>;
}
