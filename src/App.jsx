function DemoCheckoutButton() {
  return (
    <button
      className="checkout-button"
      style={{ color: "red", backgroundColor: "yellow" }}
      data-source="src/App.jsx:3"
      data-inspector-line="3"
      data-component="DemoCheckoutButton"
    >
      Complete purchase
    </button>
  );
}

export default function App() {
  return (
    <main className="demo-shell">
      <p className="eyebrow">Viewport HUD · local demo</p>
      <h1>Make frontend edits from the page itself.</h1>
      <p className="description">
        Press <kbd>Alt</kbd> + <kbd>A</kbd>, select the button, and ask for a visual change.
      </p>
      <DemoCheckoutButton />
    </main>
  );
}