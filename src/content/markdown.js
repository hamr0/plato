import { Marked } from 'marked';

// Defense-in-depth markdown rendering for user-provided post bodies.
// Three security concerns:
//
// 1. Raw HTML in source — `<script>...`, `<img onerror=...>`, etc. We escape
//    HTML rather than pass it through. Both block-level and inline HTML flow
//    through renderer.html in marked v15.
//
// 2. Dangerous URL schemes — `[click](javascript:alert(1))` would otherwise
//    produce a live anchor. We filter href/src to allow only http(s), mailto,
//    relative, and #-fragment URLs.
//
// 3. Inline embeds — PRD forbids hosted media and auto-rendered embeds. We
//    convert `![alt](url)` image syntax into a regular link via walkTokens so
//    image-shaped markdown produces text + clickable link, never `<img>`.
//
// Pre-escaping the source (replace < and > before parsing) was tempting but
// breaks blockquote syntax (>) and double-escapes inside code blocks. The
// render-time approach is cleaner.

const SAFE_URL_SCHEME = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;
const DANGEROUS_URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(href) {
  const trimmed = String(href ?? '').trim();
  if (!trimmed) return '';
  // Allow http(s), mailto, fragments, and relative URLs.
  if (SAFE_URL_SCHEME.test(trimmed)) return trimmed;
  // Reject anything else that has a scheme (javascript:, data:, vbscript:, file:, ...).
  if (DANGEROUS_URL_SCHEME.test(trimmed)) return '';
  // Schemeless paths fall through as relative.
  return trimmed;
}

const md = new Marked({ gfm: true, breaks: true });

md.use({
  // Sanitize tokens before render: filter dangerous URLs, convert images to links.
  walkTokens(token) {
    if (token.type === 'link') {
      token.href = safeHref(token.href);
    } else if (token.type === 'image') {
      // PRD: no inline embeds. Rewrite image tokens as links.
      const url = safeHref(token.href);
      const label = token.text || url;
      Object.assign(token, {
        type: 'link',
        href: url,
        title: token.title ?? null,
        tokens: [{ type: 'text', raw: label, text: label }],
      });
    }
  },
  renderer: {
    // Marked v15 funnels both block-level and inline raw HTML through this
    // method. Escape and emit as literal text — never let user-controlled HTML
    // reach the browser as live markup.
    html(token) {
      const text = typeof token === 'object'
        ? (token.text ?? token.raw ?? '')
        : token;
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(source) {
  if (typeof source !== 'string' || source.length === 0) return '';
  return md.parse(source);
}
