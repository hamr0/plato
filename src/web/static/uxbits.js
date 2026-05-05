// Small grab-bag of progressive enhancements that don't fit the bigger
// per-feature modules:
//
//   1. data-copy-target="<input-name>" — click copies the named form
//      field's current value to the clipboard. Used by the post-retry
//      "copy your draft" affordance so users can stash their text
//      before re-targeting or navigating away.
//   2. <details class="inline-confirm"> reset on bfcache restore.
//      Browsers restore [open] state when the user clicks "back," which
//      makes mod-management forms (demote / step-down / disable / transfer)
//      look stuck in confirmation mode. On pageshow with persisted=true,
//      close all inline-confirm details so the page reads as fresh.
(function () {
  if (!document.addEventListener) return;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-target]');
    if (!btn) return;
    const name = btn.getAttribute('data-copy-target');
    const field = document.querySelector('[name="' + name + '"]');
    if (!field) return;
    const text = 'value' in field ? field.value : (field.textContent || '');
    if (!text) return;
    e.preventDefault();
    const done = () => {
      const orig = btn.textContent;
      btn.textContent = 'copied';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
    } else {
      fallback(text, done);
    }
  });

  function fallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { /* swallow */ }
    document.body.removeChild(ta);
  }

  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    document
      .querySelectorAll('details.inline-confirm[open]')
      .forEach((d) => d.removeAttribute('open'));
  });
})();
