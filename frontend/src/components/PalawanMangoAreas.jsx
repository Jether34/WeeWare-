import { useEffect, useState } from 'react';
import { CircleMarker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';

// Keep the interactive map and the API's supported Palawan study extent aligned.
export const palawanExtent = [[7.0, 116.0], [12.9, 121.0]];
export const defaultPalawanLocation = [10.0, 118.8];
export const isPalawanCoordinate = ([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= 7 && Number(lat) <= 12.9 && Number(lng) >= 116 && Number(lng) <= 121;
export function savedPalawanPin() {
  try {
    const value = JSON.parse(localStorage.getItem('weeware-location'));
    if (!value || !isPalawanCoordinate([value.lat, value.lng])) return defaultPalawanLocation;
    // Older releases automatically stored Puerto Princesa as the default pin.
    if (Number(value.lat) === 9.7494 && Number(value.lng) === 118.7384) return defaultPalawanLocation;
    return [Number(value.lat), Number(value.lng)];
  } catch { return defaultPalawanLocation; }
}

export const palawanMangoAreas = [
  {
    key: 'bacungan', place: 'Bacungan · Puerto Princesa', position: [9.90919, 118.69809],
    detail: 'A UPLB field study at Bacungan Farm recorded 310 hectares and about 28,000 mango trees during observations in 2013.',
    source: 'UPLB thesis (2015)', url: 'https://www.ukdr.uplb.edu.ph/etd-undergrad/1705/', kind: 'documented farm study',
  },
  {
    key: 'inagawan-sub', place: 'Inagawan Sub-Colony · Puerto Princesa', position: [9.5501, 118.5984],
    detail: 'DA-PRDP names Inagawan Sub-Colony and nearby Luzviminda, Mangingisda, and Isaub as mango-growing areas around its Tagumpay processing project.',
    source: 'DA-PRDP (2019)', url: 'https://prdp.da.gov.ph/prdp-processing-enterprise-to-promote-puerto-princesa-mango-industry/', kind: 'reported growing area',
  },
  {
    key: 'luzviminda', place: 'Luzviminda · Puerto Princesa', position: [9.6682, 118.7043],
    detail: 'DA-PRDP names Inagawan Sub-Colony and nearby Luzviminda, Mangingisda, and Isaub as mango-growing areas around its Tagumpay processing project.',
    source: 'DA-PRDP (2019)', url: 'https://prdp.da.gov.ph/prdp-processing-enterprise-to-promote-puerto-princesa-mango-industry/', kind: 'reported growing area',
  },
  {
    key: 'mangingisda', place: 'Mangingisda · Puerto Princesa', position: [9.68191, 118.75425],
    detail: 'DA-PRDP names Inagawan Sub-Colony and nearby Luzviminda, Mangingisda, and Isaub as mango-growing areas around its Tagumpay processing project.',
    source: 'DA-PRDP (2019)', url: 'https://prdp.da.gov.ph/prdp-processing-enterprise-to-promote-puerto-princesa-mango-industry/', kind: 'reported growing area',
  },
  {
    key: 'isaub', place: 'Isaub · Aborlan', position: [9.5044, 118.5885],
    detail: 'DA-PRDP names Inagawan Sub-Colony and nearby Luzviminda, Mangingisda, and Isaub as mango-growing areas around its Tagumpay processing project.',
    source: 'DA-PRDP (2019)', url: 'https://prdp.da.gov.ph/prdp-processing-enterprise-to-promote-puerto-princesa-mango-industry/', kind: 'reported growing area',
  },
  {
    key: 'roxas', place: 'Roxas, Palawan', position: [10.31963, 119.343],
    detail: 'A local report describes more than 100 hectares of mango plantations in Roxas; it does not publish farm parcel outlines.',
    source: 'Palawan News (2021)', url: 'https://palawan-news.com/special-report-stopping-the-palawan-mango-weevils-northern-push/', kind: 'reported municipality area',
  },
  {
    key: 'aramaywan', place: 'Aramaywan · Quezon', position: [9.3724, 118.1427],
    detail: 'A public property listing describes a 3.5-hectare lot with mango trees in Aramaywan. This listing is not a verified farm census.',
    source: 'Property listing', url: 'https://www.propertiespalawan.com/property/3-5-hectares-farm-lot-with-mango-trees-in-quezon-palawan/', kind: 'public listing',
  },
];

export function FitPalawanExtent() {
  const map = useMap();
  useEffect(() => { map.fitBounds(palawanExtent, { padding: [12, 12] }); }, [map]);
  return null;
}

export function PalawanMangoAreas({ t }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useEffect(() => {
    const update = () => setZoom(map.getZoom());
    map.on('zoomend', update);
    return () => map.off('zoomend', update);
  }, [map]);

  return <>
    <TileLayer attribution="Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community" url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={17} maxZoom={20} />
    <TileLayer attribution="Place labels © Esri, HERE, Garmin, OpenStreetMap contributors, GIS user community" url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={15} maxZoom={20} />
    {palawanMangoAreas.map((area) => <CircleMarker key={area.key} center={area.position} radius={zoom >= 9 ? 7 : 5} pathOptions={{ color: '#f8ffe0', weight: 2, fillColor: '#087a47', fillOpacity: 1 }} eventHandlers={{ click: () => { if (map.getZoom() < 10) map.flyTo(area.position, 10, { duration: 0.55 }); } }}>
      {zoom >= 10 && <Tooltip permanent direction="top" offset={[0, -6]}>{area.place}</Tooltip>}
      <Popup maxWidth={270}><strong>{area.place}</strong><p>{t(area.detail)}</p><small>{t('Map pin marks an approximate locality, not an individual mango farm boundary.')}</small><p className="mango-area-source"><a href={area.url} target="_blank" rel="noreferrer">{t('Source')}: {area.source}</a></p></Popup>
    </CircleMarker>)}
  </>;
}
