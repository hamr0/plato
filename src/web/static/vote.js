// Progressive-enhancement vote interactions.
//
// PRD §Technical Stack rules out client-side JS in the v1 path. This file is
// a deliberate, scoped exception: it makes voting feel right by avoiding the
// page-jump that native form-POST + 302 redirect causes. It is purely
// additive — without JS, forms POST normally and the server redirect path
// still works. Keep this file under ~50 lines; if it grows, reconsider.

(function () {
  if (!window.fetch || !document.addEventListener) return;

  function formatScore(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.getAttribute('action') !== '/vote') return;

    e.preventDefault();
    const voteEl = form.closest('.vote');
    if (!voteEl) { form.submit(); return; }

    const body = new URLSearchParams(new FormData(form));

    try {
      const res = await fetch('/vote', {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('vote: HTTP ' + res.status);
      const data = await res.json();

      const scoreEl = voteEl.querySelector('.score');
      if (scoreEl) scoreEl.textContent = formatScore(data.score);

      voteEl.querySelectorAll('button.arrow').forEach((btn) => {
        btn.classList.remove('active');
        if (btn.classList.contains('up') && data.vote === 'up') btn.classList.add('active');
        if (btn.classList.contains('down') && data.vote === 'down') btn.classList.add('active');
      });
    } catch (err) {
      // Fail safe: hand the submit back to the browser. Worst case the page
      // jumps; the vote still lands.
      form.submit();
    }
  });
})();
