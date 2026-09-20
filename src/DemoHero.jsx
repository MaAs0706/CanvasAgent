import DemoCheckoutButton from './DemoCheckoutButton.jsx';

export default function DemoHero() {
  return (
    <section className="demo-hero">
      <p className="eyebrow">Viewport HUD · live workspace</p>
      <h1>Build the interface you can see.</h1>
      <p className="description">Select a component, describe the change, preview the patch, and keep a rollback point for every experiment.</p>
      <div className="hero-actions">
        <DemoCheckoutButton />
        <button className="secondary-button" type="button">View activity</button>
      </div>
      <div className="hero-note"><span className="pulse-dot" /> Local source mapping is active</div>
    </section>
  );
}
