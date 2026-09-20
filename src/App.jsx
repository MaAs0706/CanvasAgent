import DemoHero from './DemoHero.jsx';
import DemoNavbar from './DemoNavbar.jsx';
import DemoProjectCard from './DemoProjectCard.jsx';
import DemoStats from './DemoStats.jsx';

export default function App() {
  return (
    <div
      className="app-page"
      data-source="src/App.jsx:8"
      data-inspector-line="8"
      data-component="App"
    >
      <main className="demo-shell">
        <DemoNavbar />
        <DemoHero />
        <DemoStats />
        <DemoProjectCard />
      </main>
    </div>
  );
}
