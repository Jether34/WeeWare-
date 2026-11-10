import { useState } from 'react';
import { MapContainer, Marker, Popup, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FitPalawanExtent, PalawanMangoAreas } from '../components/PalawanMangoAreas';

const center = [9.7494, 118.7384];
const markerIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border:4px solid white;border-radius:50%;background:#16804b;box-shadow:0 1px 7px #173a2c88"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const inStudyArea = ([lat, lng]) => lat >= 7 && lat <= 12.9 && lng >= 116 && lng <= 121;

function PinSelector({ onSelect }) {
  useMapEvents({ click(event) { onSelect([event.latlng.lat, event.latlng.lng]); } });
  return null;
}

export default function MapPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pin, setPin] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('weeware-location')); return saved && inStudyArea([saved.lat, saved.lng]) ? [saved.lat, saved.lng] : center; } catch { return center; }
  });
  const [message, setMessage] = useState('');
  function selectPin(point) {
    if (!inStudyArea(point)) { setMessage(t('Choose a pin within the supported Palawan map extent.')); return; }
    setPin(point); setMessage('');
  }
  function predict() {
    const location = { lat: Number(pin[0].toFixed(5)), lng: Number(pin[1].toFixed(5)), name: 'Palawan, Philippines' };
    localStorage.setItem('weeware-location', JSON.stringify(location));
    navigate('/app/prediction', { state: { location } });
  }

  return <div className="page">
    <h1 className="page-title">{t('Location')}</h1>
    <p className="page-subtitle">{t('Click the map to pin a study location. The prediction will extract CMIP6 grid data nearest to these coordinates.')}</p>
    <div className="map-layout">
      <section className="card mango-map-card" style={{ padding: 10 }}>
        <MapContainer center={center} zoom={6} minZoom={5} maxZoom={20} scrollWheelZoom className="map-canvas">
          <PalawanMangoAreas t={t} />
          <FitPalawanExtent />
          <PinSelector onSelect={selectPin} />
          <Marker position={pin} icon={markerIcon}>
            <Tooltip permanent direction="top" offset={[0, -10]}>{t('Selected mango farm location')}</Tooltip>
            <Popup><strong>{t('Selected mango farm location')}</strong><br />{pin[0].toFixed(5)}, {pin[1].toFixed(5)}</Popup>
          </Marker>
        </MapContainer>
      </section>
      <aside className="card map-info">
        <span className="pill risk-low">{t('Documented mango places')}</span>
        <h2>Palawan</h2>
        <p>{t('Markers include documented mango areas in Bacungan and southern Puerto Princesa, Roxas, and Aramaywan in Quezon. Click a marker for its record and source.')}</p>
        <p className="muted">{t('The Philippine Statistics Authority reports {{area}} hectares planted or harvested provincewide in 2024.', { area: '1,477.77' })}</p>
        <p className="muted">{t('The prediction input supports coordinates across the Palawan map extent.')}</p>
        {message && <p className="error">{message}</p>}
        <p className="muted">{t('Pinned coordinates')}: {pin[0].toFixed(5)}° N · {pin[1].toFixed(5)}° E</p>
        <div className="grid" style={{ marginTop: 18 }}><button className="button" onClick={predict}>{t('Choose location and predict')}</button></div>
      </aside>
    </div>
  </div>;
}
