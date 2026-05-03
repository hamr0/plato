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
// Cap visible length for bare auto-linked URLs. The href is preserved; only
// the rendered text is truncated. 30 keeps host + a peek at the path; longer
// URLs blow out line wrapping without adding readable info. Operators can
// retune via config.json:urlDisplayMax — see resolveUrlDisplayMax in app.js.
let URL_DISPLAY_MAX = 30;

export function setUrlDisplayMax(n) {
  URL_DISPLAY_MAX = n;
}

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
    // Anchor + outbound-host hint. For absolute http(s) URLs we append a
    // muted "↗ host.com" span so the reader sees where the link goes
    // before clicking. Relative URLs (/sub/x, #anchor), mailto, and empty
    // hrefs render as a plain anchor with no badge.
    link(token) {
      const href = token.href ?? '';
      const text = token.text ?? '';
      // Visual-only truncation for bare/auto-linked URLs: when the user
      // pasted a raw URL, marked renders text == href. Long URLs blow out
      // line wrapping and add no information past the host + first path
      // segment. Truncate the visible text but keep href intact (full
      // navigation still works) and surface the full URL on hover via
      // title so screen readers / cautious clickers can preview it.
      const isBareUrl = href && text === href;
      let inner;
      if (isBareUrl && href.length > URL_DISPLAY_MAX) {
        inner = `${escapeHtml(href.slice(0, URL_DISPLAY_MAX - 3))}...`;
      } else {
        inner = (token.tokens ?? []).map((t) => this.parser.parseInline([t])).join('') || escapeHtml(text);
      }
      const hoverTitle = token.title ?? (isBareUrl && href.length > URL_DISPLAY_MAX ? href : null);
      const titleAttr = hoverTitle ? ` title="${escapeHtml(hoverTitle)}"` : '';
      if (!href) return `<a${titleAttr}>${inner}</a>`;
      const anchor = `<a href="${escapeHtml(href)}"${titleAttr}>${inner}</a>`;
      const host = outboundHost(href);
      return host ? `${anchor}<span class="ext-host">${escapeHtml(host)}</span>` : anchor;
    },
  },
});

function outboundHost(href) {
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function renderMarkdown(source) {
  if (typeof source !== 'string' || source.length === 0) return '';
  return md.parse(source);
}
