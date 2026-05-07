// Shared pagination primitives for the offline static readers (per-sub
// and per-user archives). The two exporters render different row shapes
// (a sub archive lists posts, a user archive interleaves posts and
// comments across subs), so this module deliberately stays
// item-shape-agnostic — callers pass their own `renderRows` closures and
// pre-sorted item arrays.
//
// Threshold/page-size are PRD-locked at 100/100 so an archive at the
// hobby-scale ceiling fits in one page, and the pager only appears when
// it actually helps.

export const PAGINATION_THRESHOLD = 100;
export const PAGE_SIZE = 100;

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function htmlPage({ title, cssHref, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(cssHref)}">
</head>
<body>
${body}
</body>
</html>
`;
}

export function fmtTimestamp(ms) {
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

// Bucket items by UTC year, newest year first. Items must carry
// `created_at` (ms). Caller is responsible for any per-type tagging
// (e.g., `_kind: 'post' | 'comment'`) needed by its row renderer.
export function bucketByYear(items) {
  const sorted = items.slice().sort((a, b) => b.created_at - a.created_at);
  const buckets = new Map();
  for (const it of sorted) {
    const y = new Date(it.created_at).getUTCFullYear();
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push(it);
  }
  return buckets;
}

export function pagerHtml({ baseFilename, page, totalPages }) {
  if (totalPages <= 1) return '';
  const prevHref = page === 1 ? null
    : page === 2 ? `${baseFilename}.html`
    : `${baseFilename}-${page - 1}.html`;
  const nextHref = page === totalPages ? null : `${baseFilename}-${page + 1}.html`;
  return `<div class="pager">
  ${prevHref ? `<a href="${escapeHtml(prevHref)}">← prev</a>` : '<span></span>'}
  <span>page ${page} of ${totalPages}</span>
  ${nextHref ? `<a href="${escapeHtml(nextHref)}">next →</a>` : '<span></span>'}
</div>`;
}

// Returns [{filename, body}] for one filter bucket. Page 1 lives at
// `<base>.html`, subsequent pages at `<base>-N.html`. Each page wraps
// the rows with a "← index" link and a pager top+bottom.
export function paginateBucket({ items, baseFilename, pageTitle, renderRows }) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const out = [];
  for (let i = 0; i < totalPages; i++) {
    const page = i + 1;
    const filename = page === 1 ? `${baseFilename}.html` : `${baseFilename}-${page}.html`;
    const slice = items.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
    const pager = pagerHtml({ baseFilename, page, totalPages });
    const body = `<p><a href="index.html">← index</a></p>
<h1>${escapeHtml(pageTitle)}</h1>
${pager}
${renderRows(slice)}
${pager}`;
    out.push({ filename, body });
  }
  return out;
}

// CSS for the chips row + pager. Append to the per-exporter ARCHIVE_CSS
// so both readers stay in lockstep on these surfaces.
export const PAGINATION_CSS = `.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.6rem 0; }
.chips a { border: 1px solid var(--border); padding: 0.2rem 0.6rem; border-radius: 3px; color: var(--text); font-size: 0.85rem; }
.chips a:hover { border-color: var(--accent); text-decoration: none; }
.chips a.muted { color: var(--text-dim); }
.pager { display: flex; justify-content: space-between; margin: 1rem 0; font-size: 0.85rem; color: var(--text-dim); }
.pager .spacer { flex: 1; }
`;
