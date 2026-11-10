import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import './i18n';
import './appTranslations';
import './styles.css';
import './components.css';
import './prediction-ui.css';
import './prediction.css';
import './public-pages.css';
import './researcher-dashboard.css';
import { AuthProvider } from './auth';
import App from './App';

createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></BrowserRouter></React.StrictMode>);

