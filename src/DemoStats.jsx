const metrics = [
  { label: 'Live experiments', value: '24', detail: '+8 this week', tone: 'cyan' },
  { label: 'Patches applied', value: '83', detail: '96% accepted', tone: 'violet' },
  { label: 'Time saved', value: '6.4h', detail: 'vs. manual edits', tone: 'lime' },
];

export default function DemoStats() {
  return <section className="metrics-grid" aria-label="Workspace metrics">{metrics.map((metric) => <article className={`metric-card ${metric.tone}`} key={metric.label}><p>{metric.label}</p><strong>{metric.value}</strong><span>{metric.detail}</span></article>)}</section>;
}
