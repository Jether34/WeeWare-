import { useState } from 'react';
import { Link } from 'react-router-dom';
import LegalDialog from '../components/LegalDialog';
import OrganizationChart from '../components/OrganizationChart';
import { useTranslation } from 'react-i18next';

const metrics = [['Puerto Princesa', 'Study area'], ['5 climate variables', 'Weather inputs'], ['365 days', 'Forecast period']];
const steps = [
  ['01', 'Choose a place', 'Pin a location within Puerto Princesa to set the coordinates for climate data extraction.'],
  ['02', 'Set the forecast dates', 'Choose any available start date. WeeWare uses the next 365 calendar days.'],
  ['03', 'Review the climate', 'See the extracted weather variables and monthly climate values for that location and period.'],
  ['04', 'Run the model', 'Get an annual infestation estimate and a suggested action from the trained LASSO model.'],
];
const audiences = [
  ['Growers', 'Plan field monitoring and discuss local conditions with an early risk estimate.'],
  ['Agriculture teams', 'Use a shared climate and pest-risk reference to support local planning.'],
  ['Researchers', 'Review model outputs and contribute observations that can guide future validation.'],
];

export default function Home() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState(null);
  return <main className="public-home">
    <header className="public-header"><Link to="/" className="public-brand"><img src="/assets/weeware-vps-logo.png" alt=""/><span>WeeWare</span></Link></header>
    <section className="public-hero"><div className="public-hero-shade"/><div className="public-hero-content"><span className="location-pill"><span aria-hidden="true">⌖</span> Puerto Princesa, Palawan</span><h1>WeeWare<span>Mango Pulp Weevil Prediction System</span></h1><p>Climate data and LASSO regression for annual mango pulp weevil risk planning in Puerto Princesa.</p><div className="public-hero-actions"><Link className="button" to="/signup">Create your account</Link><Link className="button public-outline" to="/login">Sign in</Link></div><a className="scroll-cue" href="#about">Explore WeeWare <span aria-hidden="true">↓</span></a></div></section>
    <div className="public-content">
      <section className="public-metrics" aria-label="WeeWare at a glance">{metrics.map(([value, label]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</section>
      <section id="about" className="public-section"><div className="section-intro"><span className="section-kicker">RESEARCH OVERVIEW</span><h2>Forecasting mango pulp weevil risk for Palawan</h2><p>WeeWare is a decision support research system created by students at Palawan National School to help growers and local teams plan monitoring for mango pulp weevil, <em>Sternochetus frigidus</em>.</p></div><div className="mission-grid"><article className="public-card"><span className="public-card-icon">✳</span><h3>Our mission</h3><p>Turn climate information and local observations into practical support for seasonal orchard monitoring.</p></article><article className="public-card"><span className="public-card-icon">◎</span><h3>Our vision</h3><p>A Palawan mango industry better prepared for pest risks through transparent, science-based forecasting.</p></article></div></section>
      <section className="public-section"><div className="challenge-grid"><article className="public-card challenge-card"><span className="section-kicker">THE CHALLENGE</span><h2>Risk can be difficult to spot early.</h2><p>Mango pulp weevil develops inside the fruit, where damage may remain unnoticed until harvest. Growers need useful local information to plan monitoring before visible losses appear.</p></article><article className="public-card solution-card"><span className="section-kicker">THE WEEWARE APPROACH</span><h2>Climate context for annual planning.</h2><p>WeeWare extracts the selected location’s weather data, summarizes the annual window, and applies the trained LASSO model to estimate infestation risk and provide a suggested action.</p><div className="feature-chips"><span>Rainfall</span><span>Temperature</span><span>Humidity</span><span>Solar radiation</span><span>Wind speed</span></div></article></div></section>
      <section className="public-section how-section" id="how-it-works"><div className="section-intro"><span className="section-kicker">A CLEAR WORKFLOW</span><h2>How WeeWare works</h2><p>Set a location and an annual date window, review the climate inputs, then run the model.</p></div><div className="steps-grid">{steps.map(([number, title, body]) => <article className="step-card" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
      <section className="public-section"><div className="section-intro"><span className="section-kicker">CLIMATE INPUTS</span><h2>Five weather variables, one local view</h2><p>Review annual aggregates and monthly climate values for the chosen place and forecast dates before running the model.</p></div><div className="climate-feature-grid">{[['01', 'Rainfall', 'mm'], ['02', 'Temperature', '°C'], ['03', 'Relative humidity', '%'], ['04', 'Solar radiation', 'MJ/m²/day'], ['05', 'Wind speed', 'm/s']].map(([number, name, unit]) => <article className="climate-feature" key={name}><span>{number}</span><strong>{name}</strong><small>{unit}</small></article>)}</div></section>
      <section className="public-section"><div className="section-intro"><span className="section-kicker">BUILT FOR LOCAL PLANNING</span><h2>Research tools for the people of Palawan</h2></div><div className="audience-grid">{audiences.map(([title, body]) => <article className="public-card audience-card" key={title}><span className="audience-mark" aria-hidden="true">{title === 'Growers' ? '⌂' : title === 'Agriculture teams' ? '⌖' : '⌘'}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
      <OrganizationChart />
      <section className="school-banner"><img src="/assets/weeware-vps-logo.png" alt="WeeWare"/><div><span>STEM RESEARCH · PALAWAN NATIONAL SCHOOL</span><h2>Created for Palawan, by students of PNS</h2><p>WeeWare brings together climate projections, an explainable regression model, and community observations to support local mango research.</p></div></section>
      <section className="public-cta"><span className="section-kicker">START WITH YOUR FORECAST</span><h2>Protect your next harvest with better planning.</h2><p>Create an account to explore the prediction workflow and join the WeeWare community.</p><Link className="button" to="/signup">Get started</Link></section>
      <p className="public-disclaimer">Predictions are research estimates for planning support. Validate field decisions with local agricultural guidance and observations.</p>
    </div>
    <footer className="public-footer"><div className="footer-main"><Link to="/" className="public-brand"><img src="/assets/weeware-vps-logo.png" alt=""/><span>WeeWare</span></Link><p>Palawan mango farming, rooted in data.</p><div><strong>Study area</strong><span>Puerto Princesa City, Palawan, Philippines</span></div><div><strong>Research platform</strong><span>CMIP6 climate data · LASSO regression</span></div></div><div className="footer-bottom"><span>© 2026 WeeWare Research Group · Palawan National School</span><div><button type="button" onClick={() => setPolicy('terms')}>Terms of Service</button><button type="button" onClick={() => setPolicy('privacy')}>Privacy Policy</button></div></div></footer>
    <LegalDialog type={policy} onClose={() => setPolicy(null)} />
  </main>;
}
