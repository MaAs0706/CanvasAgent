export default function DemoProjectCard() {
  return (
    <section className="project-card" id="workspace">
      <div className="project-heading"><div><p className="card-kicker">Current project</p><h2>Checkout experience</h2></div><span className="status-badge"><i /> In review</span></div>
      <p className="project-copy">A spatial refactoring session for the payment screen. Every patch is previewed before it reaches the source file.</p>
      <div className="progress-row"><div className="progress-label"><span>Design coverage</span><strong>72%</strong></div><div className="progress-track"><span /></div></div>
      <div className="task-list">
        <label className="task-item"><input type="checkbox" defaultChecked /> Make mobile layout resilient</label>
        <label className="task-item"><input type="checkbox" defaultChecked /> Add dark-mode tokens</label>
        <label className="task-item"><input type="checkbox" /> Review the primary CTA</label>
      </div>
    </section>
  );
}
