// Route-transition fallback. Tiny on purpose: it flashes for a few hundred ms between pages.
export default function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-traps" aria-hidden="true">
        <span>🪣</span>
        <span>🪵</span>
        <span>🧊</span>
      </span>
      Setting the traps…
    </div>
  );
}
