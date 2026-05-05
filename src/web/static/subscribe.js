// Progressive-enhancement subscribe / unsubscribe.
//
// Plato's no-JS path is full POST + 302 redirect, which works but
// causes a visible flicker (page reloads, scroll resets, below-the-
// fold layout reflows). This file intercepts the submit and POSTS via
// fetch, then flips the button label and the hidden action input in
// place — no reload, no flicker. Pure additive: without JS the form
// still submits the standard way and the server-side redirect still
// lands the user correctly.
//
// Keep this file tight; if it grows past ~40 lines, reconsider.

(function () {
  if (!window.fetch || !document.addEventListener) return;

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.classList.contains('subscribe-form')) return;
    if (!/\/sub\/[^/]+\/subscribe$/.test(form.getAttribute('action') ?? '')) return;

    e.preventDefault();
    const actionInput = form.querySelector('input[name="action"]');
    const button = form.querySelector('button');
    if (!actionInput || !button) { form.submit(); return; }
    if (button.disabled) return;
    button.disabled = true;

    try {
      const body = new URLSearchParams(new FormData(form));
      const res = await fetch(form.getAttribute('action'), {
        method: 'POST', body,
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'Accept': 'text/html' },
      });
      // 302 → 'opaqueredirect' on follow=manual; 2xx → 'basic' OK; 4xx
      // we treat as failure. 401 means session expired — let the
      // browser do a normal submit so the user lands on /login.
      const isRedirect = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
      const isOk = res.ok;
      if (!isRedirect && !isOk) {
        if (res.status === 401) { form.submit(); return; }
        button.disabled = false;
        return;
      }
      // Flip label + hidden action. The user's next click will toggle
      // back. No partial state — server is the source of truth, and a
      // page reload would reflect the same flipped state.
      const wasSubscribe = actionInput.value === 'subscribe';
      const flipped = wasSubscribe ? 'unsubscribe' : 'subscribe';
      actionInput.value = flipped;
      button.textContent = flipped;

      // Optimistic ±1 on every visible mem-count cell for this sub.
      // The action URL is /sub/<name>/subscribe — pull the name back out.
      // No-op if no cell exists (e.g. on the sub page itself, where mem
      // count isn't surfaced).
      const m = (form.getAttribute('action') ?? '').match(/\/sub\/([^/]+)\/subscribe$/);
      if (m) {
        const subName = m[1];
        const delta = wasSubscribe ? 1 : -1;
        const cells = document.querySelectorAll(`[data-mem-count="${CSS.escape(subName)}"]`);
        cells.forEach((el) => {
          const n = parseInt(el.textContent, 10);
          if (Number.isFinite(n)) el.textContent = String(Math.max(0, n + delta));
        });
      }
    } catch (err) {
      // Network blip / blocked fetch — fall back to a normal submit so
      // the user still gets the action through.
      form.submit();
      return;
    }
    button.disabled = false;
  });
})();
