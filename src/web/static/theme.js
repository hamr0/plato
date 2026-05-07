// Theme toggle (M8/B0). Anti-flash inline <script> in <head> already
// stamps any saved data-theme on <html> + sets has-js. This file owns
// only the click handler and the button label sync.
//
// State model:
//   - data-theme attribute on <html> ∈ {"light", "dark", absent}.
//     Absent = "follow OS hint via @media (prefers-color-scheme)".
//   - localStorage.theme persists the click. Once a user clicks, we
//     stop following the OS hint forever (per browser).
//   - Button label shows the action it'll perform: "light" when in
//     dark, "dark" when in light. Reads same source of truth.
(function () {
  const btn = document.querySelector('button.theme-toggle');
  if (!btn) return;
  function effective() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  function syncLabel() {
    btn.textContent = effective() === 'dark' ? 'light' : 'dark';
  }
  syncLabel();
  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (_) {}
    syncLabel();
  });
})();
