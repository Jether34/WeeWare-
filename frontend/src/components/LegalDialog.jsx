import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import legalTranslations from './legalTranslations';

const documents = {
  terms: {
    title: 'Terms of Service',
    sections: [
      ['1. Using WeeWare', 'By creating an account, you agree to these terms. WeeWare is an academic research and decision support system for mango pulp weevil risk. Do not rely on its estimates as a guarantee or as a substitute for local agricultural advice.'],
      ['2. Eligibility and account information', 'You must be at least 13 years old to create an account. Keep your account credentials secure and provide information that is accurate and current. Your account is activated after you verify your email address.'],
      ['3. Responsible use', 'Use the service lawfully and do not disrupt, probe, or attempt to gain unauthorized access to WeeWare or other users’ accounts. Community posts and messages must respect other people and their rights.'],
      ['4. Your content', 'You retain ownership of content you submit. You allow WeeWare to store and display it as needed to provide the service and its community features.'],
      ['5. Predictions and availability', 'Predictions are statistical estimates based on available data and model training. Their accuracy and availability are not guaranteed. The service is provided as available, without a promise that it will be uninterrupted or error-free.'],
      ['6. Account action and changes', 'Accounts that misuse the service may be restricted or removed. These terms may change as the research system develops; continued use after an update means you accept the revised terms.'],
      ['7. Contact', 'For questions about these terms, contact the WeeWare research team at Palawan National School.'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['1. Information collected', 'We collect account details such as your name, email address, and language preference, plus optional profile information you provide. The service also processes selected forecast dates and map coordinates, prediction history, and content or interactions you submit through community and messaging features.'],
      ['2. How information is used', 'Information is used to manage and approve accounts, provide predictions and save reports, support community and messaging features, and maintain and improve the research system.'],
      ['3. Sharing and research', 'WeeWare is a research project. Personal information is not sold. Limited information may be processed by infrastructure providers that host or operate the service. Research reporting should use aggregated or de-identified information where practical.'],
      ['4. Retention and your choices', 'Account and activity data may be retained while your account is active and as needed to operate the service. You can edit profile information in Settings and may request account deletion through the system or research team.'],
      ['5. Security', 'We use safeguards such as password hashing and access controls. No online service can guarantee complete security. Keep your sign-in credentials private and use a trusted device.'],
      ['6. Browser storage', 'The system uses browser storage for sign-in and features that require device state. Clearing browser data may sign you out or reset local preferences.'],
      ['7. Contact', 'For privacy questions or requests, contact the WeeWare research team at Palawan National School.'],
    ],
  },
};

const legalLabels = {
  en: { terms: 'Terms of Service', privacy: 'Privacy Policy', eyebrow: 'WEEWARE - ACCOUNT POLICIES', close: 'Close policy' },
  tl: { terms: 'Mga Tuntunin ng Serbisyo', privacy: 'Patakaran sa Privacy', eyebrow: 'WEEWARE - MGA PATAKARAN SA ACCOUNT', close: 'Isara ang patakaran' },
  ceb: { terms: 'Mga Termino sa Serbisyo', privacy: 'Patakaran sa Privacy', eyebrow: 'WEEWARE - MGA PATAKARAN SA ACCOUNT', close: 'Sirad-i ang patakaran' },
  hil: { terms: 'Mga Termino sang Serbisyo', privacy: 'Patakaran sa Privacy', eyebrow: 'WEEWARE - MGA PATAKARAN SANG ACCOUNT', close: 'Isira ang patakaran' },
  krj: { terms: 'Mga Termino it Serbisyo', privacy: 'Patakaran sa Privacy', eyebrow: 'WEEWARE - MGA PATAKARAN IT ACCOUNT', close: 'Isira ro patakaran' },
  cyo: { terms: 'Mga Termino kang Serbisyo', privacy: 'Patakaran sa Privacy', eyebrow: 'WEEWARE - MGA PATAKARAN KANG ACCOUNT', close: 'Isira ro patakaran' },
};

export default function LegalDialog({ type, onClose }) {
  const { i18n } = useTranslation();
  const document = documents[type];
  const language = i18n.resolvedLanguage || 'en';
  const labels = legalLabels[language] || legalLabels.en;
  const sectionsForLanguage = legalTranslations[language]?.[type] || document?.sections;
  useEffect(() => {
    if (!document) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [document, onClose]);
  if (!document) return null;
  return <div className="legal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <header className="legal-dialog-head"><div><span className="legal-eyebrow">{labels.eyebrow}</span><h2 id="legal-title">{labels[type] || document.title}</h2></div><button type="button" className="legal-close" onClick={onClose} aria-label={labels.close}>&times;</button></header>
      <div className="legal-document">{sectionsForLanguage.map(([title, body]) => <section key={title}><h3>{title}</h3><p>{body}</p></section>)}</div>
    </section>
  </div>;
}
