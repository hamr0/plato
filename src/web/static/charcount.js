// Char counter for any <textarea data-charcount>. Renders "<used> /
// <max>" in the sibling .char-counter element so users see how much
// room remains before maxlength stops their typing. Pure progressive
// enhancement: the textarea's maxlength attribute is the actual cap;
// this just surfaces it visibly.
(function () {
  if (!document.addEventListener) return;
  const update = (ta) => {
    const max = parseInt(ta.getAttribute('maxlength') || '0', 10);
    const out = ta.parentElement && ta.parentElement.querySelector('.char-counter[data-for="' + ta.name + '"]');
    if (!out || !max) return;
    const used = ta.value.length;
    out.textContent = used + ' / ' + max;
    out.classList.toggle('char-counter-near', used >= max * 0.9);
    out.classList.toggle('char-counter-full', used >= max);
  };
  document.addEventListener('input', (e) => {
    const ta = e.target;
    if (!(ta instanceof HTMLTextAreaElement)) return;
    if (!ta.hasAttribute('data-charcount')) return;
    update(ta);
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('textarea[data-charcount]').forEach(update);
  });
})();
