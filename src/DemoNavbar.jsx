export default function DemoNavbar() {
  return (
    <header className="demo-navbar">
      <a className="brand" href="#workspace">canvas<span>agent</span></a>
      <nav className="nav-links" aria-label="Workspace navigation">
        <a className="nav-link active" href="#workspace">Workspace</a>
        <a className="nav-link" href="#insights">Insights</a>
        <a className="nav-link" href="#settings">Settings</a>
      </nav>
      <button className="profile-button" type="button" aria-label="Open profile">AM</button>
    </header>
  );
}
