const RAW = Symbol('raw-html');

export function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function raw(html) {
  return { [RAW]: true, html: String(html) };
}

export function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) continue;
      if (v[RAW]) out += v.html;
      else if (Array.isArray(v)) out += v.map(x => (x && x[RAW]) ? x.html : escapeHTML(x)).join('');
      else out += escapeHTML(v);
    }
  }
  return { [RAW]: true, html: out };
}

export function render(template) {
  return template && template[RAW] ? template.html : String(template ?? '');
}
