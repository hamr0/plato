// Flair UI enhancements (no-JS path still works):
//
// 1. Palette swatches in the sub-create/edit flair editor: clicking a swatch
//    sets the sibling color input's value.
// 2. Flair preview pill on the post-create form: paints the selected option
//    in its actual color so authors see what their post will be tagged with.
(function () {
  function relLuminance(hex) {
    const m = hex.replace('#', '');
    const expand = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function contrastFor(hex) {
    return relLuminance(hex) > 0.6 ? '#111111' : '#ffffff';
  }

  // Palette swatch click → set the linked color input.
  document.querySelectorAll('.flair-palette').forEach((palette) => {
    const targetName = palette.getAttribute('data-flair-target');
    const target = document.querySelector(`input[name="${targetName}"]`);
    if (!target) return;
    palette.querySelectorAll('.flair-swatch').forEach((sw) => {
      sw.addEventListener('click', (e) => {
        e.preventDefault();
        const c = sw.getAttribute('data-color');
        if (c) {
          target.value = c;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  });

  // Post-form flair preview pill + cross-sub flair rebuild.
  document.querySelectorAll('.flair-form-row').forEach((row) => {
    const sel = row.querySelector('.flair-form-select');
    const preview = row.querySelector('.flair-form-preview');
    if (!sel || !preview) return;
    let colors = {};
    try { colors = JSON.parse(row.getAttribute('data-flair-colors') || '{}'); } catch { /* ignore */ }
    const update = () => {
      const slug = sel.value;
      const color = colors[slug];
      const opt = sel.options[sel.selectedIndex];
      if (!color || !slug) {
        preview.innerHTML = '';
        return;
      }
      const label = (opt && opt.textContent) || slug;
      preview.innerHTML = '';
      const pill = document.createElement('span');
      pill.className = 'flair-pill';
      pill.style.background = color;
      pill.style.color = contrastFor(color);
      pill.textContent = label;
      preview.appendChild(pill);
    };
    sel.addEventListener('change', update);
    update();

    // Cross-sub form: rebuild flair options when the sub dropdown changes.
    let subMap = null;
    try { subMap = JSON.parse(row.getAttribute('data-sub-flairs') || 'null'); } catch { /* ignore */ }
    if (!subMap) return;
    const form = row.closest('form');
    const subSel = form && form.querySelector('select[name="sub_name"]');
    if (!subSel) return;
    const rebuild = () => {
      const entry = subMap[subSel.value];
      sel.innerHTML = '';
      if (!entry) {
        row.hidden = true;
        sel.removeAttribute('required');
        preview.innerHTML = '';
        return;
      }
      row.hidden = false;
      if (entry.required) sel.setAttribute('required', '');
      else {
        sel.removeAttribute('required');
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '(no flair)';
        sel.appendChild(blank);
      }
      for (const f of entry.flairs) {
        const opt = document.createElement('option');
        opt.value = f.slug;
        opt.textContent = f.label;
        sel.appendChild(opt);
      }
      update();
    };
    subSel.addEventListener('change', rebuild);
  });
})();
