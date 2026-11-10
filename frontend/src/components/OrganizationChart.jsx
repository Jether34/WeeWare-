const adviser = {
  name: 'Ruffa Mae L. Arzaga',
  role: 'Research Adviser',
  image: '/assets/researchers/adviser.jpg',
};

const researchers = [
  { name: 'Gian Bless', role: 'Student Researcher', image: '/assets/researchers/gian.jpg' },
  { name: 'Glen Ariona', role: 'Student Researcher', image: '/assets/researchers/glen.jpg' },
  { name: 'Yvez Ashley', role: 'Student Researcher', image: '/assets/researchers/yvez.jpg' },
];

function PersonCard({ person, adviserCard = false }) {
  return <article className={`org-person-card ${adviserCard ? 'org-adviser-card' : ''}`}>
    <img src={person.image} alt={person.name} loading="lazy" decoding="async"/>
    <strong>{person.name}</strong>
    <span>{person.role}</span>
  </article>;
}

export default function OrganizationChart() {
  return <section className="public-section organization-section" aria-labelledby="organization-title">
    <div className="section-intro"><span className="section-kicker">WEEWARE RESEARCH TEAM</span><h2 id="organization-title">Organizational chart</h2><p>The research adviser guides the WeeWare student research team.</p></div>
    <div className="research-org-chart">
      <div className="research-org-lead"><PersonCard person={adviser} adviserCard/></div>
      <div className="research-org-connector" aria-hidden="true"><span className="research-org-stem"/><span className="research-org-branch"/></div>
      <div className="research-org-members">{researchers.map((person) => <div className="research-org-member" key={person.name}><span className="research-org-drop" aria-hidden="true"/><PersonCard person={person}/></div>)}</div>
    </div>
  </section>;
}
