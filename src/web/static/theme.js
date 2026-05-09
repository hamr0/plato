// Theme toggle (M8/B0). Anti-flash inline <script> in <head> stamps
// the saved theme class on <html> before first paint + sets has-js.
// This file owns only the click handler and the button label sync.
//
// State model:
//   - .theme-light or .theme-dark class on <html>; neither = follow
//     OS hint via @media (prefers-color-scheme). Class-based, not
//     attribute-based: iOS Safari has CSSOM-invalidation bugs around
//     attribute selectors that classes don't trigger.
//   - localStorage.theme persists the click. Once a user clicks, we
//     stop following the OS hint forever (per browser).
//   - Button label shows the action it'll perform: "light" when in
//     dark, "dark" when in light. Reads same source of truth.
//   - color-scheme inline style is set alongside the class flip so
//     native UI elements (form inputs, scrollbars) match.
(function () {
  const root = document.documentElement;
  const btn = document.querySelector('button.theme-toggle');
  if (!btn) return;
  function effective() {
    if (root.classList.contains('theme-light')) return 'light';
    if (root.classList.contains('theme-dark')) return 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  function applyTheme(theme) {
    root.classList.toggle('theme-light', theme === 'light');
    root.classList.toggle('theme-dark', theme === 'dark');
    root.style.colorScheme = theme;
  }
  function syncLabel() {
    btn.textContent = effective() === 'dark' ? 'light' : 'dark';
  }
  // Sync color-scheme on load — the inline anti-flash script already
  // set the class; this just makes sure the inline-style hint matches
  // for native UI.
  root.style.colorScheme = effective();
  syncLabel();
  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('theme', next); } catch (_) {}
    syncLabel();
  });
})();
