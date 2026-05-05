// Click-to-copy on rssvp affordances. Two surfaces, same semantic:
//
//   .rssvp-copy  — button on /memlog wrapping a personal feed URL in
//                  <code>; data-copy carries the URL.
//   .rssvp-link  — <a href="/sub/<name>/rss"> in sub-page action rows.
//                  href IS the URL to copy.
//
// On left-click: copy + flash a transient "copied!" affordance, no
// navigation. Right-click / middle-click / cmd-click still work as
// normal browser link affordances on .rssvp-link, so power users
// keep "open in new tab" / "copy link address". Without JS, the
// .rssvp-link works as a plain link (browser opens the Atom feed)
// and .rssvp-copy text inside <code> is selectable the normal way.
//
// Keep this file tight; if it grows past ~60 lines, reconsider.

(function () {
  if (!navigator.clipboard || !document.addEventListener) return;

  function flash(el, originalText) {
    el.classList.add('rssvp-copied');
    el.textContent = 'copied!';
    setTimeout(() => {
      el.classList.remove('rssvp-copied');
      el.textContent = originalText;
    }, 1200);
  }

  document.addEventListener('click', async (e) => {
    // Modifier-clicks bypass the handler — they're "I want the
    // browser default" signals (cmd/ctrl = new tab, shift = new
    // window, middle-click = aux button).
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const btn = e.target.closest('.rssvp-copy');
    if (btn) {
      const url = btn.dataset.copy;
      const codeEl = btn.querySelector('code');
      if (!url || !codeEl) return;
      e.preventDefault();
      const orig = codeEl.dataset.orig ?? codeEl.textContent;
      codeEl.dataset.orig = orig;
      try { await navigator.clipboard.writeText(url); flash(codeEl, orig); }
      catch { /* permissions blocked — let the user select <code> manually */ }
      return;
    }

    const link = e.target.closest('a.rssvp-link');
    if (link) {
      const href = link.href;
      if (!href) return;
      e.preventDefault();
      const orig = link.dataset.orig ?? link.textContent;
      link.dataset.orig = orig;
      try { await navigator.clipboard.writeText(href); flash(link, orig); }
      catch { window.open(href, '_blank'); /* fallback: open the feed */ }
    }
  });
})();
