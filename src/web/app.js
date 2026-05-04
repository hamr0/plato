import { html, render, raw } from './templates.js';
import { applyStaticRoute } from './static.js';
import { readBody, parseForm, send, redirect } from './request.js';
import { pseudonymFor } from '../identity/pseudonym.js';
import { avatarSvg } from '../identity/avatar.js';
import {
  submitDraft,
  finalizeDraft,
  getPost,
  editPost,
  getPostPreview,
  getPostRawBody,
  listPostsInSub,
  listPostsAcrossSubs,
  SUB_SORTS,
  EDIT_WINDOW_MS as POST_EDIT_WINDOW_MS,
} from '../content/post.js';
import {
  createSub,
  getSubByName,
  validateSubName,
  listAllSubs,
  setSubFlairs,
  setSubSensitive,
  setSubFlagThreshold,
  setSubDescription,
  RESERVED_SUB_NAMES,
} from '../content/sub.js';
import { parseFlairs } from '../content/flair.js';
import {
  addComment,
  editComment,
  listCommentsForPost,
  buildCommentTree,
  listRecentCommentsAcrossSubs,
  COMMENT_SORTS,
  EDIT_WINDOW_MS as COMMENT_EDIT_WINDOW_MS,
} from '../content/comment.js';
import { castVote, getVote } from '../content/vote.js';
import {
  canModerate, recordAction, listModActions, MOD_ACTIONS,
  listSubsModeratedBy, listModActionsAcrossSubs, countModActionsAcrossSubs,
  listInboxAcrossSubs, countInboxAcrossSubs,
  isBanned,
} from '../content/mod.js';
import {
  submitFlag, FLAG_CATEGORIES, flaggedTargetsByHandle,
  pendingFlagsAcrossSubs, countPendingTargetsAcrossSubs,
  flagBreakdownsForTargets, resolveFlagsForTarget,
  FLAG_THRESHOLD_FLOOR,
} from '../content/flag.js';
import { renderMarkdown, setUrlDisplayMax } from '../content/markdown.js';
import { isDisposableEmail } from '../content/disposable-domain.js';
import { checkPostRate, checkPostRatePerSub, checkCommentRate, resolveRateLimitConfig } from '../content/rateLimit.js';
import { loadSpamPatterns, matchSpamPatterns, applySpamMatches, SYSTEM_HANDLE } from '../content/spamPatterns.js';
import { checkLinkCap, resolveLinkCapConfig } from '../content/linkCap.js';
import { loadUrlhausCache, matchUrlhaus, applyUrlhausMatches } from '../content/urlhaus.js';
import {
  recordNotification, unreadCount, listNotifications, listActivityForHandle,
  markNotificationRead, markAllNotificationsRead, pruneOldNotifications,
  NOTIFICATION_KINDS,
} from '../content/notification.js';

// Handles are HMAC-SHA256 hex (64 chars) plus the SYSTEM sentinel ('0' x64).
const HANDLE_RE = /^[0-9a-f]{64}$/;

// Canonical page chrome. Every user-facing page goes through `page()`;
// the title parameter doubles as the document title and the wordmark
// replacement in the shared site header. Never call siteHeader directly
// from a renderer — use page() so the rule that "every page reads the
// same as home, with the forum name replaced by the page action" holds
// in code, not in convention.
function pageView({ db, currentHandle = null, title, subtitle, description = null, canonical = null, ogType = 'website' }, body) {
  return layout(title, html`
    ${siteHeader({ db, currentHandle, title, subtitle })}
    ${body}
  `, { description, canonical, ogType });
}

// One-line error/notice pages. Kept terse so the call sites stay readable
// while still going through pageView so chrome is consistent.
function quickPage(req, { db, auth }, title, body) {
  return pageView({ db, currentHandle: auth?.handleFromRequest(req) ?? null, title }, body);
}

// `seo` carries per-page overrides for description / canonical / og:type.
// Defaults: description ← site default (privacy posture surfaced), canonical
// ← apex (siteMeta.baseUrl), og:type ← 'website'. Per-page renderers pass
// the seo opts via pageView when they have richer context (post excerpt,
// sub description, full canonical URL, etc.) — see privacy-seo.md.
function layout(title, body, seo = {}) {
  const description = seo.description || defaultSiteDescription();
  const canonical = seo.canonical || siteMeta.baseUrl;
  const ogType = seo.ogType || 'website';
  return render(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0d1117">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${branding.forumName}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg?v=3">
<link rel="alternate icon" href="/static/favicon.svg?v=3">
<link rel="stylesheet" href="/static/style.css?v=25">
${branding.colors.up || branding.colors.down ? html`<style>:root{${branding.colors.up ? `--up:${branding.colors.up};` : ''}${branding.colors.down ? `--down:${branding.colors.down};` : ''}}</style>` : ''}
<script src="/static/vote.js?v=2" defer></script>
<script src="/static/comment.js?v=3" defer></script>
<script src="/static/flair.js?v=2" defer></script>
</head>
<body>${body}${siteFooter()}</body>
</html>`);
}

// LOCKED project quote — appears in the footer below the
// "a plato instance hosted by ..." line. Source of plato's name;
// not for forking.
const PLATO_QUOTE = 'opinion is the medium between knowledge and ignorance.';

// Module-scoped branding, set by createApp at boot from operator config.
// One process per instance, so a module-level object is safe (no
// cross-instance leakage). Defaults are the canonical plato values.
const branding = {
  forumName: 'plato',
  tagline: 'a forum that lives at one URL',
  hostedBy: null,
  colors: { up: null, down: null },
  feedbackEmail: null,
  rules: [],
  metaDescription: null,
};

// Set at boot from createApp. layout() reads `siteMeta.baseUrl` to compose
// canonical / og:url. Module-scoped (one process per instance).
const siteMeta = { baseUrl: '' };

// Blocks CSS injection: reject anything containing ; { } < > " '
// A valid CSS color (hex, rgb(), named) never needs those characters.
export function resolveBrandingColors(overrides) {
  const unsafe = /[;{}<>"']/;
  const check = (key, val) => {
    if (val == null || val === '') return null;
    if (typeof val !== 'string') throw new Error(`branding.colors.${key} must be a string`);
    if (unsafe.test(val)) throw new Error(`branding.colors.${key} contains invalid characters`);
    return val.trim();
  };
  return {
    up:   check('up',   overrides.up),
    down: check('down', overrides.down),
  };
}

// Mailto / footer-link target. Validated at boot — bad shape throws
// rather than silently rendering a broken link. ASCII-only mirrors the
// magic-link mail body constraint (knowless validateBodyFooter).
export function resolveBrandingFeedbackEmail(val) {
  if (val == null || val === '') return null;
  if (typeof val !== 'string') throw new Error('branding.feedbackEmail must be a string');
  const trimmed = val.trim();
  if (trimmed.length > 120) throw new Error('branding.feedbackEmail must be ≤ 120 chars');
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(trimmed)) {
    throw new Error('branding.feedbackEmail must be a valid email address');
  }
  // Anything outside printable ASCII (incl. control chars and any byte
  // above DEL) is rejected — narrow definition, intentional. Same shape
  // as knowless validateBodyFooter (mailers don't reliably handle 8-bit).
  if (/[^\x20-\x7e]/.test(trimmed)) {
    throw new Error('branding.feedbackEmail must be ASCII');
  }
  return trimmed;
}

// Operator-supplied meta description for search snippets + OpenGraph.
// Falls back to a default that surfaces plato's privacy posture
// (magic-link, no accounts, no tracking) so a fresh fork's search
// snippet self-selects the right audience without operator effort.
// ASCII-only so it round-trips through any link-unfurl preview.
export function resolveBrandingMetaDescription(val) {
  if (val == null || val === '') return null;
  if (typeof val !== 'string') throw new Error('branding.metaDescription must be a string');
  const t = val.trim();
  if (!t) return null;
  if (t.length > 200) throw new Error('branding.metaDescription must be ≤ 200 chars');
  if (/[^\x20-\x7e]/.test(t)) throw new Error('branding.metaDescription must be ASCII');
  return t;
}

// Default site description if branding.metaDescription is unset. Format
// chosen to land cleanly in a Google snippet (~155 chars) and to mention
// what plato is and how it behaves toward the user in the same breath.
function defaultSiteDescription() {
  if (branding.metaDescription) return branding.metaDescription;
  const tagline = branding.tagline ? ` — ${branding.tagline}` : '';
  return `a ${branding.forumName} instance: Reddit-shaped forum, magic-link auth, no tracking, no analytics, public modlog${tagline}.`;
}

// Strip markdown markers and return a plaintext excerpt suitable for
// meta-description / og:description on a post page. Best-effort: keeps
// the first sentence/paragraph intact, trims to `max` chars, appends an
// ellipsis when truncated. ASCII-only output (mirrors the late.fyi
// snippet rule — link-unfurl previews don't reliably handle 8-bit).
function postExcerpt(body, max = 155) {
  if (typeof body !== 'string' || !body) return '';
  const stripped = body
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>~|`]+/g, ' ')
    .replace(/[^\x20-\x7e\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// XML attribute / text escape for sitemap.xml output. The five XML
// predefined entities cover both attribute-value and element-text
// contexts safely.
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Site rules: rendered on /about as a list AND injected into the
// magic-link email signature so users see the rules in the medium they
// actually read text. Constraints inherit from knowless bodyFooter
// (AF-8.2): ≤4 lines, ≤240 chars total when joined with \n, ASCII only,
// no URLs (footer URLs are a phishing vector). Empty array = feature
// disabled (no rules section on /about, no footer on the email).
export function resolveBrandingRules(val) {
  if (val == null || val === '') return [];
  if (!Array.isArray(val)) throw new Error('branding.rules must be an array of strings');
  if (val.length === 0) return [];
  if (val.length > 4) throw new Error('branding.rules: at most 4 rules (knowless mail-footer cap)');
  const out = [];
  for (let i = 0; i < val.length; i++) {
    const r = val[i];
    if (typeof r !== 'string') throw new Error(`branding.rules[${i}] must be a string`);
    const t = r.trim();
    if (!t) throw new Error(`branding.rules[${i}] is empty`);
    if (t.includes('\n') || t.includes('\r')) throw new Error(`branding.rules[${i}] must be one line`);
    if (/[^\x20-\x7e]/.test(t)) throw new Error(`branding.rules[${i}] must be ASCII`);
    // Phishing-vector defence on the magic-link mail signature. Block any
    // URI scheme (http, https, mailto, data, javascript, ftp, tg, …) AND
    // bare-domain shapes that mail clients auto-link (`example.com/x`,
    // `example.com`). Operators express rules in prose; if they want to
    // point at a URL they put it on /about which is the medium for it.
    if (/[a-z]+:\/\//i.test(t)) throw new Error(`branding.rules[${i}] must not contain a URL scheme (footer phishing vector)`);
    if (/\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|me|info|xyz|biz|us|uk|de|fr|jp|cn|ru|tv|gg|fyi|gov|edu)\b/i.test(t)) {
      throw new Error(`branding.rules[${i}] must not contain a bare domain (footer phishing vector)`);
    }
    out.push(t);
  }
  const joined = out.join('\n');
  if (joined.length > 240) throw new Error('branding.rules: joined length must be ≤ 240 chars');
  return out;
}

// Inline SVG of the mark. `loading` adds the wave animation (the only
// animation in the entire app). aria-hidden because the wordmark next to
// it carries the meaning for screen readers. ViewBox is sized so dots
// fill ~75% of width — readable at favicon scales (16px+).
// Display labels for mod actions in the public modlog. Internal enum stays
// 'collapse'/'remove' (DB compat); public surface reads as soft/hard
// removal so the brand of moderation is visible.
const MOD_ACTION_LABELS = {
  collapse:                  'soft removal',
  uncollapse:                'soft removal undone',
  remove:                    'hard removal',
  unremove:                  'hard removal undone',
  auto_uncollapse_community: 'community overruled',
};

function logoMark({ size = 22, loading = false } = {}) {
  const h = Math.round(size * (8 / 24));
  const attrs = loading ? raw(' data-loading') : raw('');
  return html`<svg class="logo-mark" width="${size}" height="${h}" viewBox="0 0 24 8" aria-hidden="true"${attrs}><circle cx="3" cy="4" r="3" opacity="0.4"/><circle cx="12" cy="4" r="3" opacity="0.7"/><circle cx="21" cy="4" r="3"/></svg>`;
}

function siteFooter() {
  const handle = branding.hostedBy ?? `@${branding.forumName}`;
  const feedbackLink = branding.feedbackEmail
    ? html`<a href="mailto:${branding.feedbackEmail}">feedback</a> · `
    : html``;
  return html`<footer class="site-footer">
    <a href="/" class="logo-home">${logoMark({ size: 22 })}</a>
    <span class="hosted-by muted">a plato instance hosted by ${handle}</span>
    <span class="footer-links muted">· ${feedbackLink}<a href="/about">about</a> · <a href="/modlog">modlog</a></span>
    <span class="quote muted">— "${PLATO_QUOTE}"</span>
  </footer>`;
}

// Error pages should keep the user oriented — the top siteHeader (logo,
// nav, sub strip) plus the bottom siteFooter (logo + tagline) sandwich
// every error message so the user can always click home or pick a sub.
// Pass `links` to surface specific recovery actions (e.g. "try again").
// Sanitize a user-supplied `return_to` value for a Location: header.
// Must be a same-origin path: starts with '/', not '//' (protocol-relative
// → external host), not '/\' (browser quirk), and contains no scheme.
// Falls back to `fallback` for anything else.
function safeLocalRedirect(returnTo, fallback) {
  if (typeof returnTo !== 'string') return fallback;
  if (!returnTo.startsWith('/')) return fallback;
  if (returnTo.startsWith('//') || returnTo.startsWith('/\\')) return fallback;
  return returnTo;
}

function errorPage(req, { db, auth }, { title, message, links }) {
  const currentHandle = auth?.handleFromRequest(req);
  return pageView({ db, currentHandle, title }, html`
    <p><a href="/">← home</a></p>
    <h2>// ${title}</h2>
    <p class="muted">${message}</p>
    ${links ?? html``}
  `);
}

function relativeTime(ms) {
  const d = Math.floor((Date.now() - ms) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Pick black or white text for a given hex/named flair color so labels stay
// readable across operator-chosen palettes. Falls back to white when we can't
// parse the color (named/rgb()/etc) — same default as the legacy --flair-text.
function contrastTextFor(color) {
  if (typeof color !== 'string') return '#ffffff';
  const m = color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}

function flairPillStyle(flair) {
  return `background:${flair.color};color:${contrastTextFor(flair.color)}`;
}

function authorMeta(post, pseudonym, { showComments = false, flair = null } = {}) {
  const count = post.comment_count ?? 0;
  const flairPill = flair
    ? html`<a class="flair-pill" href="/sub/${post.sub_name}?flair=${flair.slug}" style="${flairPillStyle(flair)}" title="filter by ${flair.label}">${flair.label}</a>`
    : html``;
  return html`<div class="meta">
    <img src="/avatar/${post.handle}.svg" width="18" height="18" alt="">
    <span class="name">${pseudonym}</span>
    <span class="sep">·</span>
    <a class="sub-link sub-${subColorIndex(post.sub_name)}" href="/sub/${post.sub_name}">//${post.sub_name}</a>
    ${flairPill}
    <span class="sep">·</span>
    <span class="when">${relativeTime(post.created_at)}</span>
    ${showComments
      ? html`<span class="sep">·</span>
        <a class="reply-count${count === 0 ? ' reply-count-zero' : ''}" href="${permalinkFor(post)}#comments">
          <span class="reply-count-n">${count}</span> ${count === 1 ? 'reply' : 'replies'}
        </a>`
      : html``}
  </div>`;
}

// Deterministic sub palette: hash the sub name into one of 8 accent
// hues so the same sub keeps the same color across renders. Cheap djb2
// hash; 8 buckets keeps the visual variety bounded so users see "this
// is the X-color sub" not "every link is a different color." Colors
// themselves live in CSS as --sub-color-0 .. --sub-color-7, so forks
// can override the palette in one place.
function subColorIndex(subName) {
  let h = 5381;
  for (let i = 0; i < subName.length; i++) h = ((h << 5) + h + subName.charCodeAt(i)) >>> 0;
  return h % 8;
}

function pseudonymsByHandle(db, handles) {
  if (handles.length === 0) return new Map();
  const placeholders = handles.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT handle, pseudonym FROM handles WHERE handle IN (${placeholders})`)
    .all(...handles);
  return new Map(rows.map((r) => [r.handle, r.pseudonym]));
}

// PRD §Permanently out: no default catch-all sub. The legacy 'general' row
// from the M1 schema is hidden from pickers; existing posts at /sub/general
// remain readable for archaeology, but new posts can't land there.
function listPostableSubs(db) {
  return db.prepare(
    "SELECT name, flairs, flairs_required FROM subs WHERE name != 'general' ORDER BY name ASC"
  ).all();
}

// Subs nav data: every postable sub with its last-24h post count and
// description, hottest first. Home renders the top 4 as the
// "// active subs · last 24h" block.
function listSubsForNav(db, { sinceMs = Date.now() - 24 * 60 * 60 * 1000 } = {}) {
  return db.prepare(
    `SELECT s.name, s.description,
       (SELECT COUNT(*) FROM posts p WHERE p.sub_name = s.name AND p.created_at >= ?) AS post_count
     FROM subs s
     WHERE s.name != 'general'
     ORDER BY post_count DESC, s.name ASC`
  ).all(sinceMs);
}

function loginStatusFor(db, currentHandle) {
  if (!currentHandle) {
    // Anonymous: explicit "log in" affordance top-right. Triggers the same
    // magic-link flow as the post form does today; no separate auth page,
    // just a single email field that drops them back where they were.
    return html`<div class="status muted">
      <a href="/subs">subs</a> ·
      <details class="login-trigger">
        <summary>log in</summary>
        <form method="POST" action="/login" class="login-form">
          <input name="email" type="email" placeholder="your email" required>
          <input type="hidden" name="return_to" value="">
          <button>send link</button>
        </form>
      </details>
    </div>`;
  }
  const pseudonym = pseudonymFor(db, currentHandle);
  // Mods (owner or co) see a unified `modlog` link in the nav, defaulting
  // to `?mod=me` so the chip lands on "my decisions" — the public footer
  // link points at bare /modlog (instance-wide audit). One page, two
  // entry points: mods see their own actions first; everyone else sees
  // everything.
  const modSubs = listSubsModeratedBy(db, currentHandle);
  const openCount = modSubs.length > 0 ? countPendingTargetsAcrossSubs(db, modSubs) : 0;
  const openChip = openCount > 0
    ? html` <a class="memlog-chip" href="/modlog?mode=open" title="${openCount} open for review">(${openCount})</a>`
    : html``;
  const modLogLink = modSubs.length > 0
    ? html` · <a href="/modlog?mod=me">modlog</a>${openChip}`
    : html``;
  // Pseudonym is the entry point to /memlog (personal notification log).
  // Unread count chip uses .reply-count colors so non-zero pops accent.
  const unread = unreadCount(db, currentHandle);
  const unreadChip = unread > 0
    ? html` <a class="memlog-chip" href="/memlog" title="${unread} unread">(${unread})</a>`
    : html``;
  return html`<div class="status muted">
    <img src="/avatar/${currentHandle}.svg" width="16" height="16" alt="">
    <a class="memlog-link" href="/memlog">${pseudonym}</a>${unreadChip} · <a href="/subs">subs</a>${modLogLink} ·
    <form method="POST" action="/logout" class="inline">
      <button class="link">logout</button>
    </form>
  </div>`;
}

function anonHintFor(currentHandle) {
  return currentHandle
    ? html``
    : html`<p class="muted"><em>fill the form to post — magic-link required, no password, no PII</em></p>`;
}

function siteHeader({ db, currentHandle, title, subtitle }) {
  // The site-wide default header: logo + "plato" wordmark + the tagline-
  // subtitle "a forum that lives at one URL". Pages that want their own
  // identity (per-sub feed) pass `title` and optionally `subtitle`. When
  // a page passes neither, it gets the home default — every error or
  // listing page reads the same so the user is always sure where they
  // are in the app.
  const effectiveTitle = title ?? html`${branding.forumName}`;
  const effectiveSubtitle = title === undefined && subtitle === undefined
    ? branding.tagline
    : subtitle;
  return html`<header class="site">
    <div class="brand">
      <h1><a href="/" class="logo-home">${logoMark({ size: 32 })}${effectiveTitle}</a></h1>
      ${effectiveSubtitle ? html`<div class="nav muted">${effectiveSubtitle}</div>` : html``}
    </div>
    ${loginStatusFor(db, currentHandle)}
  </header>`;
}

const FLAIR_EDITOR_ROWS = 6;
const FLAIR_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];
const FLAIR_DEFAULT_COLOR = '#3b82f6';

// Derive a URL-safe slug from a label. Operators only ever fill in the
// label + color — the slug is an internal id. Keep <=20 chars to match
// the legacy column width and to keep filter URLs compact.
function slugifyFlairLabel(label) {
  return label.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
}

function flairEditorView({ flairs = [], flairsRequired = false } = {}) {
  const rows = [];
  for (let i = 0; i < FLAIR_EDITOR_ROWS; i++) {
    const f = flairs[i];
    const color = f?.color && /^#?[0-9a-f]{3,6}$/i.test(f.color.trim())
      ? (f.color.startsWith('#') ? f.color : `#${f.color}`)
      : FLAIR_DEFAULT_COLOR;
    rows.push(html`<div class="flair-row">
      <input class="flair-row-label" name="flair_label_${i}" placeholder="label (e.g. Discussion)" value="${f?.label ?? ''}" maxlength="24">
      <input class="flair-row-color" type="color" name="flair_color_${i}" value="${color}" title="pill background">
      <div class="flair-palette" data-flair-target="flair_color_${i}">
        ${FLAIR_PALETTE.map((c) => html`<button type="button" class="flair-swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="set color to ${c}"></button>`)}
      </div>
    </div>`);
  }
  return html`<fieldset class="flair-editor">
    <legend class="muted">flairs (optional, max ${FLAIR_EDITOR_ROWS})</legend>
    ${rows}
    <label class="threshold-row">
      <input type="checkbox" name="flairs_required" value="1" ${flairsRequired ? 'checked' : ''}>
      <span>require a flair on every new post</span>
    </label>
    <p class="muted">label is what readers see; the URL slug is derived automatically. click a swatch for a preset, or use the color box for any hex (need ideas? <a href="https://htmlcolorcodes.com/color-picker/" target="_blank" rel="noopener">color picker</a>). clear a label to remove that flair.</p>
  </fieldset>`;
}

function parseFlairFormFields(form) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < FLAIR_EDITOR_ROWS; i++) {
    const label = (form[`flair_label_${i}`] ?? '').trim();
    const color = (form[`flair_color_${i}`] ?? '').trim();
    if (!label) continue;
    let slug = slugifyFlairLabel(label);
    if (!slug) continue;
    if (seen.has(slug)) {
      let n = 2;
      while (seen.has(`${slug}-${n}`) && n < 99) n++;
      slug = `${slug}-${n}`.slice(0, 20);
    }
    seen.add(slug);
    out.push({ slug, label, color: color || FLAIR_DEFAULT_COLOR });
  }
  return out;
}

function postFormFor({ currentHandle, defaultSub, postableSubs, subFlairs = [], flairsRequired = false, defaults = {} }) {
  // No default catch-all sub — every post must pick a sub with a real owner.
  // When a sub is contextually fixed (the sub page itself), the picker is
  // hidden and pinned. Otherwise both anon and logged-in users see a real
  // dropdown. If postableSubs is empty, render an empty state instead of
  // the form: posting requires creating the first sub.
  if (!defaultSub && postableSubs.length === 0) {
    return html`<p class="muted">
      no subs to post in yet. ${currentHandle
        ? html`<a href="/sub/create">create the first one</a> to get started.`
        : html`a logged-in user must <a href="/sub/create">create a sub</a> first.`}
    </p>`;
  }

  const dTitle = defaults.title ?? '';
  const dBody = defaults.body ?? '';
  const dFlair = defaults.flairSlug ?? '';
  const dSensitive = !!defaults.sensitive;

  let subField;
  if (defaultSub) {
    subField = html`<input type="hidden" name="sub_name" value="${defaultSub}">`;
  } else {
    subField = html`<select name="sub_name" required>
      ${postableSubs.map((s) => html`<option value="${s.name}" ${defaults.subName === s.name ? 'selected' : ''}>//${s.name}</option>`)}
    </select>`;
  }

  // Flair picker. Pinned-sub form (per-sub page) uses its passed-in flairs.
  // Cross-sub form (home) carries a per-sub flair map; flair.js rebuilds the
  // select options when the sub dropdown changes, and toggles `required` for
  // subs with flairs_required. No-JS fallback: finalizeDraft rejects mismatch
  // and re-renders via postRetryView with the typed values preserved.
  let flairField = html``;
  if (defaultSub && subFlairs.length > 0) {
    const colorMap = subFlairs.reduce((acc, f) => { acc[f.slug] = f.color; return acc; }, {});
    flairField = html`<div class="flair-form-row" data-flair-colors='${JSON.stringify(colorMap)}'>
      <select name="flair_slug" class="flair-form-select" ${flairsRequired ? 'required' : ''}>
        ${flairsRequired ? html`` : html`<option value="" ${dFlair === '' ? 'selected' : ''}>(no flair)</option>`}
        ${subFlairs.map((f) => html`<option value="${f.slug}" ${dFlair === f.slug ? 'selected' : ''}>${f.label}</option>`)}
      </select>
      <span class="flair-form-preview" aria-hidden="true"></span>
    </div>`;
  } else if (!defaultSub && postableSubs.some((s) => s.flairs)) {
    const subFlairMap = {};
    const colorMap = {};
    for (const s of postableSubs) {
      const f = parseFlairs(s.flairs);
      if (f.length === 0 && !s.flairs_required) continue;
      subFlairMap[s.name] = { flairs: f, required: !!s.flairs_required };
      for (const fl of f) colorMap[fl.slug] = fl.color;
    }
    const initialSubName = defaults.subName || postableSubs[0]?.name;
    const initial = subFlairMap[initialSubName];
    flairField = html`<div class="flair-form-row" data-flair-colors='${JSON.stringify(colorMap)}' data-sub-flairs='${JSON.stringify(subFlairMap)}'${initial ? html`` : html` hidden`}>
      <select name="flair_slug" class="flair-form-select" ${initial?.required ? 'required' : ''}>
        ${initial?.required ? html`` : html`<option value="" ${dFlair === '' ? 'selected' : ''}>(no flair)</option>`}
        ${(initial?.flairs ?? []).map((f) => html`<option value="${f.slug}" ${dFlair === f.slug ? 'selected' : ''}>${f.label}</option>`)}
      </select>
      <span class="flair-form-preview" aria-hidden="true"></span>
    </div>`;
  }

  return html`<form method="POST" action="/draft">
    ${currentHandle
      ? html``
      : html`<input name="email" type="email" placeholder="your email (we don't keep it)" required>`}
    ${subField}
    <input name="title" placeholder="post title" value="${dTitle}" required>
    ${flairField}
    <textarea name="body" placeholder="markdown body" required>${dBody}</textarea>
    <label class="post-form-row sensitive-row">
      <input type="checkbox" name="sensitive" value="1" ${dSensitive ? 'checked' : ''}>
      <span class="muted">mark as sensitive (advisory banner; not for porn — see rules)</span>
    </label>
    <button>post</button>
  </form>`;
}

// Re-render the post form with the user's typed values preserved, plus an
// inline error banner. Used when a logged-in user's submission is rejected
// post-validation (link cap, rate limit, banned, flair mismatch). Avoids the
// "click back and lose your post" trap.
function postRetryView({ db, currentHandle, subName, errorMessage, defaults }) {
  const sub = subName ? getSubByName(db, subName) : null;
  const subFlairs = sub ? parseFlairs(sub.flairs) : [];
  const flairsRequired = !!sub?.flairs_required;
  const backLink = subName
    ? html`<p><a href="/sub/${subName}">← back to //${subName}</a></p>`
    : html`<p><a href="/">← back home</a></p>`;
  return html`
    ${backLink}
    <h2 class="section">// post not accepted</h2>
    <div class="post-error-banner">${errorMessage}</div>
    <p class="muted">your text is preserved below — fix the issue and resubmit.</p>
    ${postFormFor({
      currentHandle,
      defaultSub: subName ?? null,
      postableSubs: [],
      subFlairs,
      flairsRequired,
      defaults,
    })}
  `;
}

function permalinkFor(post) {
  return `/sub/${post.sub_name}/post/${post.id}`;
}

function formatScore(n) {
  // Cached score is REAL (half-weights from new accounts). Show one decimal
  // only when the value isn't whole; integers render cleanly.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function voteWidget({ targetType, targetId, score, currentVote, currentHandle, returnTo }) {
  // No JS: each arrow is its own POST form. Server toggles and redirects.
  // currentVote is 'up' / 'down' / null — used to highlight the active
  // arrow. Anonymous users see arrows as muted text (no form, no action).
  const scoreClass = score > 0 ? 'score score-pos' : score < 0 ? 'score score-neg' : 'score score-zero';
  if (!currentHandle) {
    return html`<div class="vote">
      <span class="arrow muted">▲</span>
      <span class="${scoreClass}">${formatScore(score)}</span>
      <span class="arrow muted">▼</span>
    </div>`;
  }
  const upClass = currentVote === 'up' ? 'arrow up active' : 'arrow up';
  const downClass = currentVote === 'down' ? 'arrow down active' : 'arrow down';
  return html`<div class="vote">
    <form method="POST" action="/vote" class="inline">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="direction" value="up">
      <input type="hidden" name="return_to" value="${returnTo}">
      <button class="${upClass}" title="upvote">▲</button>
    </form>
    <span class="${scoreClass}">${formatScore(score)}</span>
    <form method="POST" action="/vote" class="inline">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="direction" value="down">
      <input type="hidden" name="return_to" value="${returnTo}">
      <button class="${downClass}" title="downvote">▼</button>
    </form>
  </div>`;
}

function postLinksView(hosts, readMoreHref) {
  const hasHosts = !!hosts?.length;
  if (!hasHosts && !readMoreHref) return html``;
  return html`<div class="links">
    ${readMoreHref ? html`<a href="${readMoreHref}" class="more">read more →</a>` : html``}
    ${hasHosts ? hosts.map((h) => html`<span class="lh">${h}</span>`) : html``}
  </div>`;
}

function postRowsView({ posts, pseudonyms, previews, linksMap, flairMap, voteState, currentHandle, returnTo, modRole, subName, flaggedSet, bannedAuthors }) {
  if (posts.length === 0) {
    return html`<p class="muted">no posts yet — be the first.</p>`;
  }
  return posts.map((post) => {
    const name = pseudonyms.get(post.handle) ?? post.handle.slice(0, 8);
    const preview = previews?.get(post.id);
    const link = permalinkFor(post);
    // After voting, redirect back to this exact post in the list so the
    // browser doesn't scroll to top. Anchor matches the post element below.
    const perPostReturn = `${returnTo}#post-${post.id}`;
    return html`<div class="post" id="post-${post.id}">
      ${voteWidget({
        targetType: 'post',
        targetId: post.id,
        score: post.score ?? 0,
        currentVote: voteState?.get(post.id) ?? null,
        currentHandle,
        returnTo: perPostReturn,
      })}
      <div class="body">
        <div class="post-title-line">
          <h2><a href="${link}">${post.title}</a>${post.sensitive ? html` <span class="sensitive-mark" title="sensitive content — use discretion">[!]</span>` : html``}</h2>
          <div class="post-actions">
            ${currentHandle && post.removed_at == null && !(modRole && subName === post.sub_name)
              ? flagButton({
                  targetType: 'post', targetId: post.id, returnTo: perPostReturn,
                  alreadyFlagged: flaggedSet?.has(post.id) ?? false,
                })
              : html``}
            ${modRole && subName === post.sub_name ? modControls({
              subName, targetType: 'post', targetId: post.id,
              collapsedAt: post.collapsed_at, removedAt: post.removed_at, returnTo: perPostReturn,
              authorHandle: post.handle, authorBanned: bannedAuthors?.has(post.handle) ?? false,
              currentHandle,
            }) : html``}
          </div>
        </div>
        ${authorMeta(post, name, { showComments: true, flair: flairMap?.get(post.id) ?? null })}
        ${modStateView({ removedAt: post.removed_at, collapsedAt: post.collapsed_at, body: preview
          ? html`<div class="preview">${raw(preview.html)}</div>`
          : html`` })}
        ${postLinksView(linksMap?.get(post.id), preview?.truncated ? link : null)}
      </div>
    </div>`;
  });
}

function votesForPostList(db, posts, currentHandle) {
  if (!currentHandle || posts.length === 0) return new Map();
  const placeholders = posts.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id, value FROM votes
     WHERE target_type = 'post' AND handle = ? AND target_id IN (${placeholders})`
  ).all(currentHandle, ...posts.map((p) => p.id));
  const map = new Map();
  for (const r of rows) map.set(r.target_id, r.value > 0 ? 'up' : 'down');
  return map;
}

function buildPreviews(posts, postsDir, maxChars) {
  const map = new Map();
  for (const p of posts) {
    map.set(p.id, getPostPreview(p, postsDir, { maxChars }));
  }
  return map;
}

const OUTBOUND_URL_RE = /https?:\/\/[^\s)>"<\]\[]+/g;

function extractOutboundHosts(text) {
  const seen = new Set();
  const hosts = [];
  for (const m of text.matchAll(OUTBOUND_URL_RE)) {
    try {
      const host = new URL(m[0]).hostname.replace(/^www\./, '');
      if (host && !seen.has(host)) { seen.add(host); hosts.push(host); }
    } catch { /* skip malformed */ }
  }
  return hosts;
}

function buildLinkBadges(posts, postsDir) {
  const map = new Map();
  for (const p of posts) {
    const body = getPostRawBody(p, postsDir);
    if (body) map.set(p.id, extractOutboundHosts(body));
  }
  return map;
}

// Resolve each post's flair_slug against its sub's current flair list.
// Returns Map<postId, {slug,label,color}>. Posts whose flair was removed
// from the sub since posting render with no pill (rather than a stale slug).
function buildFlairMap(db, posts) {
  const out = new Map();
  const subNames = [...new Set(posts.filter((p) => p.flair_slug).map((p) => p.sub_name))];
  if (subNames.length === 0) return out;
  const placeholders = subNames.map(() => '?').join(',');
  const rows = db.prepare(`SELECT name, flairs FROM subs WHERE name IN (${placeholders})`).all(...subNames);
  const subFlairs = new Map(rows.map((r) => [r.name, parseFlairs(r.flairs)]));
  for (const p of posts) {
    if (!p.flair_slug) continue;
    const flair = subFlairs.get(p.sub_name)?.find((f) => f.slug === p.flair_slug);
    if (flair) out.set(p.id, flair);
  }
  return out;
}

// Top-of-home active-subs block — vertical list of the 4 most-active subs
// in the last 24h. Each row: //name — description    N posts · M subs.
// Subscriber count is a placeholder (`—`) until M6 ships subscriptions.
function activeSubsBlock({ subs, currentHandle }) {
  const top = subs.slice(0, 4);
  const newSubLink = currentHandle
    ? html`<a class="new-sub" href="/sub/create">+ new sub</a>`
    : html``;
  if (top.length === 0) {
    return html`<section class="active-subs">
      <h3 class="section">// active subs · last 24h</h3>
      <p class="muted"><em>no subs yet.</em> ${newSubLink}</p>
    </section>`;
  }
  return html`<section class="active-subs">
    <h3 class="section">// active subs · last 24h</h3>
    <div class="active-subs-list">
      ${top.map((s) => html`<div class="active-sub-row">
        <a class="name sub-link sub-${subColorIndex(s.name)}" href="/sub/${s.name}">//${s.name}</a>
        ${s.sensitive ? html`<span class="sensitive-mark" title="sensitive content — use discretion">[!]</span>` : html``}
        <span class="desc muted">${s.description ? html`— ${s.description}` : html``}</span>
        <span class="stats muted"><strong>${s.post_count}</strong> ${s.post_count === 1 ? 'post' : 'posts'} · — subs</span>
      </div>`)}
    </div>
    ${newSubLink ? html`<p class="active-subs-foot">${newSubLink}</p>` : html``}
  </section>`;
}

// Home top-nav filter values. Sort applies to both posts and comments
// tabs ('hot' is post-only); date narrows the time window.
const HOME_SORTS = ['new', 'old', 'top', 'hot'];
const HOME_DATES = { '24h': 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, all: null };

function parseHomeFilters(searchParams) {
  const tab = searchParams?.get('tab') === 'comments' ? 'comments' : 'posts';
  const rawSort = searchParams?.get('sort');
  const sort = HOME_SORTS.includes(rawSort) ? rawSort : 'new';
  const rawDate = searchParams?.get('date');
  const date = rawDate in HOME_DATES ? rawDate : 'all';
  return { tab, sort, date };
}

function homeNav(filters) {
  const href = (overrides) => {
    const params = new URLSearchParams();
    const merged = { ...filters, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v == null || v === '' || (k === 'sort' && v === 'new') || (k === 'date' && v === 'all') || (k === 'tab' && v === 'posts')) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  };
  const chip = (key, value, label, active) => {
    const cls = active ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${href({ [key]: value })}">${label}</a>`;
  };
  return html`<nav class="home-nav muted">
    <span class="filter-group">
      ${chip('tab', 'posts', 'posts', filters.tab === 'posts')}
      ${chip('tab', 'comments', 'comments', filters.tab === 'comments')}
    </span>
    <span class="filter-sep">·</span>
    <span class="filter-group">
      ${chip('sort', 'new', 'new', filters.sort === 'new')}
      ${chip('sort', 'old', 'old', filters.sort === 'old')}
      ${chip('sort', 'top', 'top', filters.sort === 'top')}
      ${filters.tab === 'posts'
        ? chip('sort', 'hot', 'hot', filters.sort === 'hot')
        : html``}
    </span>
    <span class="filter-sep">·</span>
    <span class="filter-group">
      ${chip('date', '24h', '24h', filters.date === '24h')}
      ${chip('date', 'week', 'week', filters.date === 'week')}
      ${chip('date', 'all', 'all', filters.date === 'all')}
    </span>
    <span class="filter-sep">·</span>
    <span class="filter-group">
      <span class="filter-btn filter-btn-disabled" title="subscriptions — coming soon">subs</span>
      <a class="filter-btn filter-btn-active" href="/">all</a>
    </span>
  </nav>`;
}

// Pages — every feed (home posts, home comments, sub) renders FEED_PAGE_SIZE
// items then a "next" link. No infinite scroll: a clean end-of-page beat lets
// the reader pause, and the URL stays shareable / back-button-honest.
// Operator-tunable via config.json:feedPageSize; resolved at boot in createApp.
let FEED_PAGE_SIZE = 50;

function parsePage(searchParams) {
  const raw = Number.parseInt(searchParams?.get('page') ?? '1', 10);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 10000) : 1;
  return { page, offset: (page - 1) * FEED_PAGE_SIZE, limit: FEED_PAGE_SIZE };
}

// Over-fetch by one to detect "more" without a COUNT(*). If the query
// returns 51 rows, slice to 50 and remember there's a next page.
function sliceForPage(rows, limit) {
  if (rows.length > limit) return { items: rows.slice(0, limit), hasNext: true };
  return { items: rows, hasNext: false };
}

function buildPageUrl(basePath, searchParams, page) {
  const next = new URLSearchParams(searchParams ?? '');
  if (page <= 1) next.delete('page');
  else next.set('page', String(page));
  const q = next.toString();
  return q ? `${basePath}?${q}` : basePath;
}

function paginationFooter({ page, hasNext, basePath, searchParams }) {
  if (page <= 1 && !hasNext) return html``;
  const prev = page > 1
    ? html`<a class="page-link" href="${buildPageUrl(basePath, searchParams, page - 1)}" rel="prev">← previous</a>`
    : html`<span class="page-link page-link-disabled">← previous</span>`;
  const next = hasNext
    ? html`<a class="page-link" href="${buildPageUrl(basePath, searchParams, page + 1)}" rel="next">more →</a>`
    : html`<span class="page-link page-link-disabled">end</span>`;
  return html`<nav class="page-nav muted" aria-label="pagination">
    ${prev}
    ${next}
  </nav>`;
}

function commentRowsView({ comments, pseudonyms, currentHandle }) {
  if (comments.length === 0) {
    return html`<p class="muted">no comments match.</p>`;
  }
  return html`<div class="comment-feed">${comments.map((c) => {
    const pseudonym = pseudonyms.get(c.handle) ?? c.handle.slice(0, 8);
    const preview = c.body.length > 280 ? c.body.slice(0, 280).trimEnd() + '…' : c.body;
    return html`<article class="comment-row">
      <div class="meta">
        <img src="/avatar/${c.handle}.svg" width="18" height="18" alt="">
        <span class="name">${pseudonym}</span>
        <span class="sep">·</span>
        <a class="sub-link sub-${subColorIndex(c.sub_name)}" href="/sub/${c.sub_name}">//${c.sub_name}</a>
        <span class="sep">·</span>
        <span class="when">${relativeTime(c.created_at)}</span>
        <span class="sep">·</span>
        <span class="muted">on <a href="/sub/${c.sub_name}/post/${c.post_id}#comment-${c.id}">${c.post_title}</a></span>
      </div>
      <div class="comment-body">${raw(renderMarkdown(preview))}</div>
    </article>`;
  })}</div>`;
}

function renderHome(req, res, { db, auth, postsDir }, searchParams) {
  const filters = parseHomeFilters(searchParams);
  const sinceMs = HOME_DATES[filters.date] ? Date.now() - HOME_DATES[filters.date] : null;
  const subsNav = listSubsForNav(db);
  const postableSubs = listPostableSubs(db);
  const currentHandle = auth.handleFromRequest(req);

  const { page, offset, limit } = parsePage(searchParams);
  const overFetch = limit + 1;
  let feedView;
  let hasNext = false;
  if (filters.tab === 'comments') {
    const raw = listRecentCommentsAcrossSubs(db, {
      sort: filters.sort === 'hot' ? 'top' : filters.sort,
      sinceMs: sinceMs ?? undefined,
      limit: overFetch,
      offset,
    });
    const sliced = sliceForPage(raw, limit);
    hasNext = sliced.hasNext;
    const comments = sliced.items;
    const pseudonyms = pseudonymsByHandle(db, [...new Set(comments.map((c) => c.handle))]);
    feedView = commentRowsView({ comments, pseudonyms, currentHandle });
  } else {
    // Posts: one feed shape — global cross-sub ordering. The sort + date
    // chips do all the curation; the user controls diversity by hopping
    // into a sub or (M6) by subscription. No algorithmic per-sub cap —
    // "no algorithm decides what you see" is the load-bearing rule, and
    // capping per-sub on the default view is itself a small algorithm.
    const raw = listPostsAcrossSubs(db, { sort: filters.sort, sinceMs: sinceMs ?? undefined, limit: overFetch, offset });
    const sliced = sliceForPage(raw, limit);
    hasNext = sliced.hasNext;
    const posts = sliced.items;
    const pseudonyms = pseudonymsByHandle(db, [...new Set(posts.map((p) => p.handle))]);
    const previews = buildPreviews(posts, postsDir, 280);
    const linksMap = buildLinkBadges(posts, postsDir);
    const flairMap = buildFlairMap(db, posts);
    const voteState = votesForPostList(db, posts, currentHandle);
    const flaggedSet = currentHandle
      ? flaggedTargetsByHandle(db, 'post', posts.map((p) => p.id), currentHandle)
      : new Set();
    feedView = postRowsView({ posts, pseudonyms, previews, linksMap, flairMap, voteState, currentHandle, returnTo: '/', flaggedSet });
  }
  const pager = paginationFooter({ page, hasNext, basePath: '/', searchParams });

  send(
    res,
    200,
    pageView({
      db, currentHandle,
      title: branding.forumName,
      subtitle: branding.tagline,
      canonical: `${siteMeta.baseUrl}/`,
    }, html`
      ${anonHintFor(currentHandle)}
      ${activeSubsBlock({ subs: subsNav, currentHandle })}
      <details class="new-post-toggle">
        <summary>+ new post</summary>
        ${postFormFor({ currentHandle, postableSubs })}
      </details>
      ${homeNav(filters)}
      ${feedView}
      ${pager}
    `)
  );
}

// /about: a single page that documents who runs this instance, what
// content rules apply, and what data the forum keeps. The rules section
// reads from `branding.rules` (operator-supplied, also injected into the
// magic-link email signature so users see the same text in both
// surfaces — single source of truth, no drift). The data-handling
// paragraph is project-baked and not operator-edited: plato's data
// minimization is uniform across forks, and letting an operator weaken
// the description here would defeat the public-honesty contract.
function renderAbout(req, res, { db, auth }) {
  const currentHandle = auth.handleFromRequest(req);
  const handle = branding.hostedBy ?? `@${branding.forumName}`;
  const feedback = branding.feedbackEmail
    ? html` <a href="mailto:${branding.feedbackEmail}">questions or feedback</a>.`
    : html``;
  const rules = branding.rules.length > 0
    ? html`<section class="about-section">
        <h3>rules</h3>
        <ul>${branding.rules.map((r) => html`<li>${r}</li>`)}</ul>
        <p class="muted">these rules also appear in the footer of every magic-link email this instance sends.</p>
      </section>`
    : html``;
  const dataHandling = html`<section class="about-section">
    <h3>what data this instance keeps</h3>
    <p>plato is built around storing as little about you as possible. specifically:</p>
    <ul>
      <li><strong>your email address is never stored.</strong> when you sign in, the forum derives a one-way hash of your email (<a href="https://github.com/hamr0/knowless">knowless</a> identity) and discards the original. the hash is per-instance, so the same email yields different identities across forks.</li>
      <li><strong>your IP address is held briefly</strong> for rate-limit accounting. it isn't logged to disk beyond the rate-limit window and isn't shared with anyone.</li>
      <li><strong>no analytics, no tracking pixels, no third parties.</strong> the forum doesn't load JavaScript, fonts, or assets from any host except its own.</li>
      <li><strong>posts and comments are public by design.</strong> there are no private subs, no DMs, no shadow visibility. what you write is what other people see.</li>
      <li><strong>moderation is auditable.</strong> every mod action lands in a public <a href="/modlog">modlog</a>. no shadowbans, no quiet removals.</li>
    </ul>
  </section>`;
  const fork = html`<section class="about-section">
    <h3>if you don't trust this operator</h3>
    <p>that's fine — the forum is shaped so you don't have to. <a href="https://github.com/hamr0/plato"><strong>plato</strong></a> is the open-source codebase running this instance (Apache 2.0). clone the repo, copy <code>forum.db</code> + <code>posts/</code>, set a fresh <code>KNOWLESS_SECRET</code>, and run your own. handles re-derive per instance — same email yields different pseudonyms across forks — so leaving is a fresh start, not a sticky identity transplant.</p>
  </section>`;
  send(res, 200, pageView({
    db, currentHandle,
    title: html`about`,
    description: `what ${branding.forumName} keeps about its users — and what it doesn't.`,
    canonical: `${siteMeta.baseUrl}/about`,
  }, html`
    <article class="about">
      <p>this is a <strong>${branding.forumName}</strong> instance, hosted by ${handle}.${feedback}</p>
      ${rules}
      ${dataHandling}
      ${fork}
    </article>
  `));
}

function renderCommunities(req, res, { db, auth }, searchParams) {
  const sort = ['name', 'posts', 'active'].includes(searchParams?.get('sort'))
    ? searchParams.get('sort') : 'active';
  const subs = listAllSubs(db, { sort });
  const ownerHandles = [...new Set(subs.map((s) => s.owner_handle).filter(Boolean))];
  const pseudonyms = pseudonymsByHandle(db, ownerHandles);
  const currentHandle = auth.handleFromRequest(req);
  const sortLink = (val, label) => {
    const cls = sort === val ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="/subs?sort=${val}">${label}</a>`;
  };
  const rows = subs.length === 0
    ? html`<p class="muted">no subs yet. <a href="/sub/create">create one</a>.</p>`
    : html`<table class="communities">
        <thead><tr><th>sub</th><th>description</th><th>posts</th><th>subscribers</th><th>active</th><th>owner</th></tr></thead>
        <tbody>${subs.map((s) => html`<tr>
          <td><a class="sub-link sub-${subColorIndex(s.name)}" href="/sub/${s.name}">//${s.name}</a>${s.sensitive ? html` <span class="sensitive-mark" title="sensitive content — use discretion">[!]</span>` : html``}</td>
          <td class="muted desc-cell">${s.description || ''}</td>
          <td class="num">${s.post_count}</td>
          <td class="num muted" title="subscriber count lights up in M6">—</td>
          <td class="muted">${s.last_post_at ? relativeTime(s.last_post_at) : '—'}</td>
          <td class="muted">${s.owner_handle ? (pseudonyms.get(s.owner_handle) ?? s.owner_handle.slice(0, 8)) : '—'}</td>
        </tr>`)}</tbody>
      </table>`;
  send(res, 200, pageView({
    db, currentHandle,
    title: 'subs',
    description: `every sub on ${branding.forumName}.`,
    canonical: `${siteMeta.baseUrl}/subs`,
  }, html`
    <p><a href="/">← home</a></p>
    <h2>// subs</h2>
    <p class="muted">every sub on this instance. click a sub name to read or post.</p>
    <p class="modlog-filters muted">
      sort: ${sortLink('active', 'most recent')} ${sortLink('posts', 'most posts')} ${sortLink('name', 'a-z')}
      <span class="filter-sep">·</span>
      <input type="search" id="community-filter" placeholder="filter by name…" autocomplete="off">
    </p>
    ${rows}
    <script>
      // Client-side prefix filter on the listing. Hides rows whose
      // sub name doesn't start with the typed prefix. No server roundtrip.
      (function () {
        const input = document.getElementById('community-filter');
        if (!input) return;
        const rows = Array.from(document.querySelectorAll('table.communities tbody tr'));
        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          for (const r of rows) {
            const name = r.querySelector('a.sub-link')?.textContent?.replace(/^\\/\\//, '') ?? '';
            r.style.display = !q || name.startsWith(q) ? '' : 'none';
          }
        });
      })();
    </script>
  `));
}

function renderSubPage(req, res, { db, auth, postsDir }, subName, sort, searchParams) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, quickPage(req, { db, auth }, 'sub not found', html`<p class="muted">no such sub. <a href="/">back</a></p>`));
  }
  const activeSort = SUB_SORTS.includes(sort) ? sort : 'new';
  const subFlairs = parseFlairs(sub.flairs);
  const filterFlairSlug = searchParams?.get('flair') ?? null;
  const activeFilter = filterFlairSlug && subFlairs.find((f) => f.slug === filterFlairSlug) ? filterFlairSlug : null;
  const { page, offset, limit } = parsePage(searchParams);
  const rawPosts = listPostsInSub(db, subName, { limit: limit + 1, offset, sort: activeSort, flairSlug: activeFilter });
  const sliced = sliceForPage(rawPosts, limit);
  const hasNext = sliced.hasNext;
  const posts = sliced.items;
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const currentHandle = auth.handleFromRequest(req);
  const previews = buildPreviews(posts, postsDir, 600);
  const linksMap = buildLinkBadges(posts, postsDir);
  const flairMap = buildFlairMap(db, posts);
  const voteState = votesForPostList(db, posts, currentHandle);
  const filterSuffix = activeFilter ? `&flair=${activeFilter}` : '';
  const returnTo = `/sub/${subName}${activeSort === 'new' && !activeFilter ? '' : `?sort=${activeSort}${filterSuffix}`}`;
  const modRole = canModerate(db, subName, currentHandle);
  // Per-render flag/ban state: dim the flag button on already-flagged posts
  // and surface the right ban/unban label per author.
  const flaggedSet = currentHandle && !modRole
    ? flaggedTargetsByHandle(db, 'post', posts.map((p) => p.id), currentHandle)
    : new Set();
  const bannedAuthors = modRole
    ? new Set(posts.filter((p) => isBanned(db, subName, p.handle)).map((p) => p.handle))
    : new Set();

  const sortNav = html`<div class="sort-nav muted">
    ${SUB_SORTS.map((s) => {
      const href = s === 'new' ? `/sub/${subName}` : `/sub/${subName}?sort=${s}`;
      return s === activeSort
        ? html`<strong>${s}</strong>`
        : html`<a href="${href}">${s}</a>`;
    })}
  </div>`;

  send(
    res,
    200,
    pageView({
      db, currentHandle,
      title: html`//${subName}`,
      subtitle: sub.description || null,
      description: sub.description || `//${subName} on ${branding.forumName}: ${defaultSiteDescription()}`,
      canonical: `${siteMeta.baseUrl}/sub/${encodeURIComponent(subName)}`,
    }, html`
      <p><a href="/">← home</a> · <a href="/sub/${subName}/modlog">public //modlog</a>${modRole === 'owner' ? html` · <a href="/sub/${subName}/edit">edit sub</a>` : html``}</p>
      ${sub.sensitive ? html`<div class="sensitive-banner">[!] sensitive content — use discretion</div>` : html``}
      ${anonHintFor(currentHandle)}
      <details class="new-post-toggle">
        <summary>+ new post</summary>
        ${postFormFor({ currentHandle, defaultSub: subName, postableSubs: [], subFlairs, flairsRequired: !!sub.flairs_required })}
      </details>
      <h3 class="section">// posts · sort:</h3>
      ${sortNav}
      ${subFlairs.length > 0 ? html`<div class="flair-filter">
        <a class="flair-pill flair-pill-all${activeFilter ? '' : ' flair-pill-active'}" href="/sub/${subName}${activeSort === 'new' ? '' : `?sort=${activeSort}`}">all</a>
        ${subFlairs.map((f) => html`<a class="flair-pill${activeFilter === f.slug ? ' flair-pill-active' : ''}" style="${flairPillStyle(f)}" href="/sub/${subName}?${activeSort === 'new' ? '' : `sort=${activeSort}&`}flair=${f.slug}">${f.label}</a>`)}
      </div>` : html``}
      ${postRowsView({ posts, pseudonyms, previews, linksMap, flairMap, voteState, currentHandle, returnTo, modRole, subName, flaggedSet, bannedAuthors })}
      ${paginationFooter({ page, hasNext, basePath: `/sub/${subName}`, searchParams })}
    `)
  );
}

function renderSubCreate(req, res, { db, auth }) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(
      res,
      401,
      pageView({ db, currentHandle: null, title: 'login required' }, html`
        <p class="muted">creating a sub requires a session. <a href="/">back</a> and post once to get one.</p>
      `)
    );
  }
  send(
    res,
    200,
    pageView({ db, currentHandle, title: 'create a sub' }, html`
      <p><a href="/">← home</a></p>
      <form method="POST" action="/sub/create">
        <input name="name" placeholder="name (lowercase, 3–30, hyphens ok)" required pattern="[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?">
        <input name="description" placeholder="one-line description (optional, ≤200 chars)" maxlength="200">
        <fieldset class="sub-thresholds">
          <legend class="muted">auto-uncollapse (soft mod)</legend>
          <label class="threshold-row">
            <span>posts (≥ 50)</span>
            <input type="number" name="autoUncollapsePost" value="50" min="50" step="1" required>
          </label>
          <label class="threshold-row">
            <span>comments (≥ 20)</span>
            <input type="number" name="autoUncollapseComment" value="20" min="20" step="1" required>
          </label>
          <p class="muted">net upvotes that auto-lift a soft-removal. higher = harder to overrule a mod. applies to soft removals only — hard removals never auto-revert.</p>
        </fieldset>
        <fieldset class="sub-thresholds">
          <legend class="muted">flag auto-hide threshold</legend>
          <label class="threshold-row">
            <span>distinct flaggers (≥ 3)</span>
            <input type="number" name="flagThreshold" value="3" min="3" step="1" required>
          </label>
          <p class="muted">distinct users who must flag a target before it auto-hides for mod review. higher = niche subs avoid spurious auto-hides; never below 3 (so a single flagger can't collapse).</p>
        </fieldset>
        ${flairEditorView()}
        <label class="threshold-row">
          <input type="checkbox" name="sensitive" value="1">
          <span>sensitive content (banner advisory; not for porn — see rules)</span>
        </label>
        <button>create</button>
      </form>
      <p class="muted">name is locked at creation. reserved: ${[...RESERVED_SUB_NAMES].join(', ')}.</p>
    `)
  );
}

async function handleSubCreate(req, res, { db, auth }) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in first to create a sub.',
    }));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { name, description = '' } = form;
  const autoUncollapsePost = Number.parseInt(form.autoUncollapsePost ?? '50', 10);
  const autoUncollapseComment = Number.parseInt(form.autoUncollapseComment ?? '20', 10);
  const flagThreshold = Number.parseInt(form.flagThreshold ?? '3', 10);
  const flairs = parseFlairFormFields(form);
  const flairsRequired = form.flairs_required === '1';
  const sensitive = form.sensitive === '1';

  const tryAgain = html`<p><a href="/sub/create">← try again</a></p>`;
  try {
    validateSubName(name);
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'invalid name', message: err.message, links: tryAgain,
    }));
  }

  try {
    createSub(db, {
      name,
      description,
      ownerHandle: currentHandle,
      autoUncollapsePost,
      autoUncollapseComment,
      flairs,
      flairsRequired,
      sensitive,
      flagThreshold,
    });
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'create failed', message: err.message, links: tryAgain,
    }));
  }

  redirect(res, `/sub/${name}`);
}

function renderSubEdit(req, res, { db, auth }, subName) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in to edit this sub.',
    }));
  }
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, quickPage(req, { db, auth }, 'sub not found', html`<p class="muted">no such sub. <a href="/">back</a></p>`));
  }
  if (canModerate(db, subName, currentHandle) !== 'owner') {
    return send(res, 403, errorPage(req, { db, auth }, {
      title: 'owner only', message: 'editing the sub is restricted to its owner.',
      links: html`<p><a href="/sub/${subName}">← back to //${subName}</a></p>`,
    }));
  }
  const flairs = parseFlairs(sub.flairs);
  send(res, 200, pageView({ db, currentHandle, title: html`edit //${subName}` }, html`
    <p><a href="/sub/${subName}">← back to //${subName}</a></p>
    <form method="POST" action="/sub/${subName}/edit">
      <input name="description" placeholder="one-line description (optional, ≤200 chars)" maxlength="200" value="${sub.description ?? ''}">
      ${flairEditorView({ flairs, flairsRequired: !!sub.flairs_required })}
      <label class="threshold-row">
        <input type="checkbox" name="sensitive" value="1" ${sub.sensitive ? 'checked' : ''}>
        <span>sensitive content (banner advisory; not for porn — see rules)</span>
      </label>
      <fieldset class="sub-thresholds">
        <legend class="muted">flag auto-hide threshold</legend>
        <label class="threshold-row">
          <span>distinct flaggers (≥ 3)</span>
          <input type="number" name="flagThreshold" value="${sub.flag_threshold}" min="3" step="1" required>
        </label>
      </fieldset>
      <button>save</button>
    </form>
    <p class="muted">name and auto-uncollapse thresholds are locked at creation.</p>
  `));
}

async function handleSubEdit(req, res, { db, auth }, subName) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in to edit this sub.',
    }));
  }
  if (!getSubByName(db, subName)) {
    return send(res, 404, quickPage(req, { db, auth }, 'sub not found', html`<p class="muted">no such sub.</p>`));
  }
  if (canModerate(db, subName, currentHandle) !== 'owner') {
    return send(res, 403, errorPage(req, { db, auth }, {
      title: 'owner only', message: 'editing the sub is restricted to its owner.',
    }));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const description = (form.description ?? '').trim();
  const flairs = parseFlairFormFields(form);
  const flairsRequired = form.flairs_required === '1';
  const sensitive = form.sensitive === '1';
  const flagThreshold = Number.parseInt(form.flagThreshold ?? '3', 10);
  const tryAgain = html`<p><a href="/sub/${subName}/edit">← try again</a></p>`;
  try {
    parseFlairs(flairs);
    if (flairsRequired && flairs.length === 0) {
      throw new Error('flairs_required cannot be set when no flairs are defined');
    }
    if (!Number.isInteger(flagThreshold) || flagThreshold < FLAG_THRESHOLD_FLOOR) {
      throw new Error(`flag threshold must be an integer ≥ ${FLAG_THRESHOLD_FLOOR}`);
    }
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'edit failed', message: err.message, links: tryAgain,
    }));
  }
  try {
    setSubFlairs(db, subName, { flairs, flairsRequired });
    setSubSensitive(db, subName, sensitive);
    setSubFlagThreshold(db, subName, flagThreshold);
    setSubDescription(db, subName, description);
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'edit failed', message: err.message, links: tryAgain,
    }));
  }
  redirect(res, `/sub/${subName}`);
}

async function handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir, rateLimitConfig, spamPatterns, linkCapConfig, urlhausHosts }) {
  const body = await readBody(req);
  const form = parseForm(body);
  const { email, title, body: postBody, sub_name: subName } = form;
  const flairSlug = (form.flair_slug ?? '').trim() || null;
  const sensitive = form.sensitive === '1';
  const currentHandle = auth.handleFromRequest(req);

  if (!title || !postBody || !subName || (!currentHandle && !email)) {
    return send(
      res,
      400,
      quickPage(req, { db, auth }, 'missing fields',
        html`<p class="muted">all fields are required, including the sub. <a href="/">back</a></p>`
      )
    );
  }

  // PRD §Permanently out: no default sub. 'general' is read-only legacy.
  if (subName === 'general') {
    return send(
      res,
      400,
      quickPage(req, { db, auth }, 'no default sub',
        html`<p class="muted">/sub/general is archive-only. pick a real sub or <a href="/sub/create">create one</a>.</p>`
      )
    );
  }

  if (!getSubByName(db, subName)) {
    return send(
      res,
      400,
      quickPage(req, { db, auth }, 'unknown sub',
        html`<p class="muted">/sub/${subName} doesn't exist. <a href="/">back</a></p>`
      )
    );
  }

  if (currentHandle) {
    const formDefaults = { title, body: postBody, subName, flairSlug, sensitive };
    const retry = (status, message) => send(res, status, pageView({ db, currentHandle, title: 'post not accepted' }, postRetryView({
      db, currentHandle, subName, errorMessage: message, defaults: formDefaults,
    })));

    const linkBlock = checkLinkCap(db, currentHandle, `${title}\n${postBody}`, Date.now(), linkCapConfig);
    if (linkBlock) return retry(400, linkBlock.message);

    // Owner of the destination sub bypasses (a) the global per-hour
    // burst-pacing cap and (b) the per-sub topic-flood cap. The global
    // per-DAY cap still applies, so the spam-floor defense holds — a
    // fresh owner can burst their daily 3 posts into their own sub
    // without waiting an hour between each, but can't drain quota
    // across the instance. Topic-flooding a sub you own is a
    // contradiction; the cap was symbolic friction.
    const isOwnerOfSub = canModerate(db, subName, currentHandle) === 'owner';
    const rateBlock = checkPostRate(db, currentHandle, Date.now(), rateLimitConfig, { skipHourly: isOwnerOfSub });
    if (rateBlock) return retry(429, rateBlock.message);

    if (!isOwnerOfSub) {
      const subBlock = checkPostRatePerSub(db, currentHandle, subName, Date.now(), rateLimitConfig);
      if (subBlock) return retry(429, subBlock.message);
    }

    try {
      const { draftId } = submitDraft(db, { title, body: postBody, subName, flairSlug, sensitive });
      const { subName: published, postId } = finalizeDraft(db, { draftId, handle: currentHandle, postsDir });
      // Spam regex check post-publish: match against title + body and,
      // if any pattern hits, auto-collapse + flag for mod review. The
      // post still exists; the author sees the collapsed state when
      // they revisit the sub.
      const matched = matchSpamPatterns(`${title}\n${postBody}`, spamPatterns);
      if (matched.length > 0) {
        applySpamMatches(db, { targetType: 'post', targetId: postId, subName: published, matched });
      }
      const matchedHosts = matchUrlhaus(`${title}\n${postBody}`, urlhausHosts);
      if (matchedHosts.length > 0) {
        applyUrlhausMatches(db, { targetType: 'post', targetId: postId, subName: published, matchedHosts });
      }
      return redirect(res, `/sub/${published}`);
    } catch (err) {
      return retry(400, err.message);
    }
  }

  if (isDisposableEmail(email, disposableDomains)) {
    return send(
      res,
      400,
      quickPage(req, { db, auth }, 'rejected',
        html`<p class="muted">disposable email domains aren't accepted. <a href="/">back</a></p>`
      )
    );
  }

  const { draftId } = submitDraft(db, { title, body: postBody, subName, flairSlug, sensitive });

  await auth.startLogin({
    email,
    nextUrl: `${baseUrl}/draft/${draftId}/finalize`,
    sourceIp: req.socket?.remoteAddress,
  });

  send(
    res,
    200,
    pageView(
      { db, currentHandle: auth.handleFromRequest(req), title: html`${branding.forumName} · check your email` },
      html`
        <p>We sent a magic link to <code>${email}</code>. Click it within 15 minutes to publish your post.</p>
        <p class="muted">No account needed. The same email always becomes the same pseudonym + avatar on this instance — that's how identity works here. We never store the email itself, only a one-way hash of it.</p>
        <p class="muted">Your draft is saved server-side until you click. If you don't get the email or the link expires, just <a href="/">post again</a>.</p>
      `
    )
  );
}

function handleFinalize(req, res, { db, auth, postsDir, rateLimitConfig, spamPatterns, linkCapConfig, urlhausHosts }, draftId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(
      res,
      401,
      quickPage(req, { db, auth }, 'not logged in',
        html`<p class="muted">your session expired. <a href="/">post again</a> to get a fresh magic link.</p>`
      )
    );
  }

  // Rate-limit the publish step, not draft creation. New accounts
  // confirming their email shouldn't be silently swallowed by the
  // limiter. The 429 surfaces a clear message + the home link.
  // Owner of the destination sub bypasses the per-hour and per-sub
  // caps; the per-day cap still bites (see handleDraft for the
  // rationale).
  const draftRow = db.prepare('SELECT sub_name FROM drafts WHERE id = ?').get(draftId);
  const isOwnerOfSub = draftRow ? canModerate(db, draftRow.sub_name, handle) === 'owner' : false;
  const rateBlock = checkPostRate(db, handle, Date.now(), rateLimitConfig, { skipHourly: isOwnerOfSub });
  if (rateBlock) {
    return send(res, 429, errorPage(req, { db, auth }, {
      title: 'rate limited', message: rateBlock.message,
    }));
  }
  if (draftRow && !isOwnerOfSub) {
    const subBlock = checkPostRatePerSub(db, handle, draftRow.sub_name, Date.now(), rateLimitConfig);
    if (subBlock) {
      return send(res, 429, errorPage(req, { db, auth }, {
        title: 'rate limited', message: subBlock.message,
        links: html`<p><a href="/sub/${draftRow.sub_name}">← back to //${draftRow.sub_name}</a></p>`,
      }));
    }
  }

  // Link-cap gate. Pull the draft's title+body once and check against
  // the handle's tier. Reject with a clear count + cap before writing
  // anything; the user can edit the draft via a fresh /draft submit.
  const draftFull = db.prepare('SELECT title, body, sub_name FROM drafts WHERE id = ?').get(draftId);
  if (draftFull) {
    const linkBlock = checkLinkCap(db, handle, `${draftFull.title}\n${draftFull.body}`, Date.now(), linkCapConfig);
    if (linkBlock) {
      return send(res, 400, errorPage(req, { db, auth }, {
        title: 'too many links', message: linkBlock.message,
        links: html`<p><a href="/sub/${draftFull.sub_name}">← back to //${draftFull.sub_name}</a></p>`,
      }));
    }
  }

  let result;
  try {
    result = finalizeDraft(db, { draftId, handle, postsDir });
  } catch (err) {
    if (/draft .* not found/.test(err.message)) {
      return send(res, 404, errorPage(req, { db, auth }, {
        title: 'not found', message: 'draft expired or not found.',
      }));
    }
    // Bans applied between draft submission and magic-link click also
    // surface here. Render the message; don't crash the process.
    // Extract the sub name from a "banned from <sub>" error to surface
    // a "back to /sub/<name>" recovery link.
    const banMatch = /banned from ([a-z0-9-]+)/.exec(err.message);
    const links = banMatch
      ? html`<p><a href="/sub/${banMatch[1]}">← back to //${banMatch[1]}</a></p>`
      : html``;
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'post failed', message: err.message, links,
    }));
  }

  // Spam regex + URLhaus checks post-publish. The draft body lives in
  // the drafts table until finalize; pull it back to feed both matchers.
  const draftBody = db.prepare('SELECT title, body, sub_name FROM drafts WHERE id = ?').get(draftId);
  if (draftBody) {
    const text = `${draftBody.title}\n${draftBody.body}`;
    const matched = matchSpamPatterns(text, spamPatterns);
    if (matched.length > 0) {
      applySpamMatches(db, { targetType: 'post', targetId: result.postId, subName: draftBody.sub_name, matched });
    }
    const matchedHosts = matchUrlhaus(text, urlhausHosts);
    if (matchedHosts.length > 0) {
      applyUrlhausMatches(db, { targetType: 'post', targetId: result.postId, subName: draftBody.sub_name, matchedHosts });
    }
  }

  redirect(res, `/sub/${result.subName}`);
}

// Comment tree render. Auto-collapse depth: any subtree beyond MAX_DEPTH
// rolls up into a native <details> "+ N more replies" so deep threads don't
// drown the page. Score-collapse threshold hides comments that have been
// driven below -3 behind a separate <details> toggle.
const COLLAPSE_THRESHOLD = -3;
const MAX_DEPTH = 4;
// Hard recursion guard. buildCommentTree rejects cycles, but a forum-scale
// pathological thread (or a future re-parenting bug) shouldn't be able to
// blow the stack. Beyond HARD_DEPTH we collapse the rest into a single
// "+ N more replies" affordance and stop recursing.
const HARD_DEPTH = 64;
const COMMENT_PREVIEW_CHARS = 280;

function countDescendants(node) {
  let n = 0;
  for (const r of node.replies) {
    n += 1 + countDescendants(r);
  }
  return n;
}

function commentNodeView(node, ctx, depth) {
  if (depth >= HARD_DEPTH) {
    const total = 1 + countDescendants(node);
    return html`<div class="comment comment-truncated muted">+ ${total} replies hidden (depth limit)</div>`;
  }
  const pseudonym = ctx.pseudonyms.get(node.handle) ?? node.handle.slice(0, 8);
  const scoreCollapsed = node.score <= COLLAPSE_THRESHOLD;
  const modCollapsed = node.collapsed_at != null;
  const removed = node.removed_at != null;

  const replyForm = ctx.currentHandle && !removed
    ? html`<details class="reply"><summary class="muted">reply</summary>
        <form method="POST" action="/sub/${ctx.subName}/post/${ctx.postId}/comment" class="reply-form">
          <input type="hidden" name="parent_id" value="${node.id}">
          <textarea name="body" placeholder="markdown reply" required></textarea>
          <button>reply</button>
        </form>
      </details>`
    : html``;

  // Body rendering: for live/score-collapsed comments build the body
  // tree, then wrap with mod-state chip if mod-collapsed/removed. PRD
  // §Moderation Tier 2: removed comments keep their slot in the tree
  // (stub) so downstream replies still make sense.
  let inner;
  if (removed) {
    inner = modStateView({ removedAt: node.removed_at, collapsedAt: null, body: html`` });
  } else {
    const fullBody = html`<div class="comment-body">${raw(renderMarkdown(node.body))}</div>`;
    const isLong = node.body.length > COMMENT_PREVIEW_CHARS;
    const longBody = isLong
      ? html`<details class="comment-long">
          <summary class="muted">${node.body.slice(0, COMMENT_PREVIEW_CHARS).trimEnd()}… <span class="read-more">read more</span></summary>
          ${fullBody}
        </details>`
      : fullBody;

    if (modCollapsed) {
      inner = modStateView({ removedAt: null, collapsedAt: node.collapsed_at, body: longBody });
    } else if (scoreCollapsed) {
      inner = html`<details class="comment-collapsed">
        <summary class="muted">[+] (score ${formatScore(node.score)}) collapsed by community</summary>
        ${longBody}
      </details>`;
    } else {
      inner = longBody;
    }
  }

  let repliesView = html``;
  if (node.replies.length > 0) {
    if (depth + 1 >= MAX_DEPTH) {
      const total = countDescendants(node);
      repliesView = html`<details class="more-replies"><summary class="muted">+ ${total} more ${total === 1 ? 'reply' : 'replies'}</summary>
        <div class="replies">${node.replies.map((r) => commentNodeView(r, ctx, depth + 1))}</div>
      </details>`;
    } else {
      repliesView = html`<div class="replies">${node.replies.map((r) => commentNodeView(r, ctx, depth + 1))}</div>`;
    }
  }

  return html`<div class="comment" id="comment-${node.id}">
    <div class="comment-header">
      ${voteWidget({
        targetType: 'comment',
        targetId: node.id,
        score: node.score,
        currentVote: ctx.commentVotes.get(node.id) ?? null,
        currentHandle: ctx.currentHandle,
        returnTo: `${ctx.returnTo}#comment-${node.id}`,
      })}
      <div class="meta">
        <img src="/avatar/${node.handle}.svg" width="16" height="16" alt="">
        <span class="name">${pseudonym}</span>
        <span class="when">· ${relativeTime(node.created_at)}</span>
        ${node.edited_at != null ? html`<span class="muted">(edited)</span>` : html``}
      </div>
      <div class="post-actions">
        ${ctx.currentHandle === node.handle && !removed && (Date.now() - node.created_at) <= COMMENT_EDIT_WINDOW_MS
          ? html`<a class="action-link" href="/sub/${ctx.subName}/post/${ctx.postId}/comment/${node.id}/edit">edit</a>`
          : html``}
        ${ctx.currentHandle && !removed && !ctx.modRole
          ? flagButton({
              targetType: 'comment', targetId: node.id,
              returnTo: `${ctx.returnTo}#comment-${node.id}`,
              alreadyFlagged: ctx.flaggedComments?.has(node.id) ?? false,
            })
          : html``}
        ${ctx.modRole ? modControls({
          subName: ctx.subName, targetType: 'comment', targetId: node.id,
          collapsedAt: node.collapsed_at, removedAt: node.removed_at, returnTo: ctx.returnTo,
          authorHandle: node.handle, authorBanned: ctx.bannedAuthors?.has(node.handle) ?? false,
          currentHandle: ctx.currentHandle,
        }) : html``}
      </div>
    </div>
    ${inner}
    ${replyForm}
    ${repliesView}
  </div>`;
}

function commentVotesFor(db, comments, currentHandle) {
  if (!currentHandle || comments.length === 0) return new Map();
  const placeholders = comments.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id, value FROM votes
     WHERE target_type = 'comment' AND handle = ? AND target_id IN (${placeholders})`
  ).all(currentHandle, ...comments.map((c) => c.id));
  const map = new Map();
  for (const r of rows) map.set(r.target_id, r.value > 0 ? 'up' : 'down');
  return map;
}

function renderPostPage(req, res, { db, auth, postsDir }, subName, postId, sort) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">sub not found.</p>`));
  }
  const result = getPost(db, postId, postsDir);
  if (!result || result.post.sub_name !== subName) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">post not found in this sub.</p>`));
  }

  const { post, body: postBody, bodyHtml } = result;
  const currentHandle = auth.handleFromRequest(req);
  const postFlair = post.flair_slug ? parseFlairs(sub.flairs).find((f) => f.slug === post.flair_slug) ?? null : null;
  const activeSort = COMMENT_SORTS.includes(sort) ? sort : 'best';
  const returnTo = `${permalinkFor(post)}${activeSort === 'best' ? '' : `?sort=${activeSort}`}`;

  const comments = listCommentsForPost(db, postId, { sort: activeSort });
  const tree = buildCommentTree(comments);
  const allHandles = [...new Set([post.handle, ...comments.map((c) => c.handle)])];
  const pseudonyms = pseudonymsByHandle(db, allHandles);
  const commentVotes = commentVotesFor(db, comments, currentHandle);
  const postVote = currentHandle
    ? getVote(db, { targetType: 'post', targetId: postId, voterHandle: currentHandle })
    : null;
  const modRole = canModerate(db, subName, currentHandle);
  // Flag-already + ban-state lookups for the post and its comments. One
  // batch each so the per-row render is a Set membership check.
  const commentIds = comments.map((c) => c.id);
  const flaggedPosts = currentHandle && !modRole
    ? flaggedTargetsByHandle(db, 'post', [postId], currentHandle)
    : new Set();
  const flaggedComments = currentHandle && !modRole
    ? flaggedTargetsByHandle(db, 'comment', commentIds, currentHandle)
    : new Set();
  const commentAuthors = [...new Set(comments.map((c) => c.handle))];
  const bannedAuthors = modRole
    ? new Set([post.handle, ...commentAuthors].filter((h) => isBanned(db, subName, h)))
    : new Set();
  const treeCtx = {
    pseudonyms, commentVotes, currentHandle, subName, postId, returnTo, modRole,
    flaggedComments, bannedAuthors,
  };

  const commentSortNav = html`<div class="sort-nav muted">
    ${COMMENT_SORTS.map((s) => {
      const href = s === 'best' ? permalinkFor(post) : `${permalinkFor(post)}?sort=${s}`;
      return s === activeSort
        ? html`<strong>${s}</strong>`
        : html`<a href="${href}#comments">${s}</a>`;
    })}
  </div>`;

  send(
    res,
    200,
    pageView({
      db, currentHandle,
      title: post.title,
      // Removed posts → fall back to a minimal description so an indexed
      // snippet doesn't quote a body the operator already retracted.
      description: post.removed_at
        ? `${post.title} — removed post on ${branding.forumName}.`
        : (postExcerpt(postBody) || `${post.title} — ${branding.forumName} //${subName}`),
      canonical: `${siteMeta.baseUrl}/sub/${encodeURIComponent(subName)}/post/${encodeURIComponent(post.id)}`,
      ogType: 'article',
    }, html`
      <p><a href="/">← home</a> · <a href="/sub/${subName}">//${subName}</a></p>
      <div class="post post-page">
        ${voteWidget({ targetType: 'post', targetId: postId, score: post.score, currentVote: postVote, currentHandle, returnTo })}
        <div class="body">
          <div class="post-title-line">
            <h1>${post.title}</h1>
            <div class="post-actions">
              ${currentHandle === post.handle && post.removed_at == null && (Date.now() - post.created_at) <= POST_EDIT_WINDOW_MS
                ? html`<a class="action-link" href="/sub/${subName}/post/${postId}/edit">edit</a>`
                : html``}
              ${currentHandle && post.removed_at == null && !modRole
                ? flagButton({
                    targetType: 'post', targetId: postId, returnTo,
                    alreadyFlagged: flaggedPosts.has(postId),
                  })
                : html``}
              ${modRole ? modControls({
                subName, targetType: 'post', targetId: postId,
                collapsedAt: post.collapsed_at, removedAt: post.removed_at, returnTo,
                authorHandle: post.handle, authorBanned: bannedAuthors.has(post.handle),
                currentHandle,
              }) : html``}
            </div>
          </div>
          ${authorMeta({ ...post, comment_count: comments.length }, pseudonyms.get(post.handle), { showComments: true, flair: postFlair })}
          ${post.edited_at != null ? html`<p class="edited-note muted">(edited)</p>` : html``}
          ${post.sensitive ? html`<div class="sensitive-banner">[!] sensitive content — use discretion</div>` : html``}
          ${modStateView({ removedAt: post.removed_at, collapsedAt: post.collapsed_at, body: html`<article>${raw(bodyHtml)}</article>` })}
        </div>
      </div>

      <h3 class="section" id="comments">// comments · sort:</h3>
      ${commentSortNav}

      ${tree.length === 0
        ? html`<p class="muted">no comments yet — be the first.</p>`
        : html`<div class="comment-tree">${tree.map((node) => commentNodeView(node, treeCtx, 0))}</div>`}

      <div class="composer-bar">
        <form method="POST" action="/sub/${subName}/post/${postId}/comment"${currentHandle ? html`` : html` data-guest="1"`}>
          <textarea name="body" placeholder="join the conversation" required></textarea>
          <div class="guest-notice" hidden>saved — sign in above to post it. we'll submit it for you when you confirm.</div>
          <button>comment</button>
        </form>
      </div>
    `)
  );
}

async function handleAddComment(req, res, { db, auth, rateLimitConfig, spamPatterns, urlhausHosts }, subName, postId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to comment.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { body: commentBody, parent_id: parentId } = form;
  if (!commentBody || commentBody.trim().length === 0) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'empty', message: 'comment body required.',
    }));
  }
  // Owner of this sub gets 2× the daily comment cap — engagement carve-out
  // mirroring the post-side. Global ceiling still applies (just doubled);
  // a compromised owner can't drop unlimited comments.
  const isOwnerOfSub = canModerate(db, subName, handle) === 'owner';
  const rateBlock = checkCommentRate(db, handle, Date.now(), rateLimitConfig, { doubledForOwner: isOwnerOfSub });
  if (rateBlock) {
    if (wantsJson(req)) return sendJson(res, 429, { error: rateBlock.message });
    return send(res, 429, errorPage(req, { db, auth }, {
      title: 'rate limited', message: rateBlock.message,
      links: html`<p><a href="/sub/${subName}/post/${postId}">← back to the post</a></p>`,
    }));
  }
  let result;
  try {
    result = addComment(db, { postId, parentId: parentId || null, handle, body: commentBody });
  } catch (err) {
    if (wantsJson(req)) return sendJson(res, 400, { error: err.message });
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'comment failed', message: err.message,
      links: html`<p><a href="/sub/${subName}/post/${postId}">← back to the post</a></p>`,
    }));
  }
  // Spam regex + URLhaus checks post-publish. Comments have body only.
  const matched = matchSpamPatterns(commentBody, spamPatterns);
  if (matched.length > 0) {
    applySpamMatches(db, { targetType: 'comment', targetId: result.commentId, subName, matched });
  }
  const matchedHosts = matchUrlhaus(commentBody, urlhausHosts);
  if (matchedHosts.length > 0) {
    applyUrlhausMatches(db, { targetType: 'comment', targetId: result.commentId, subName, matchedHosts });
  }
  // Fire a memlog notification to the right recipient: parent comment author
  // for replies, post author for top-level comments. recordNotification skips
  // self-notifications so users don't ping themselves.
  if (parentId) {
    const parent = db.prepare('SELECT handle FROM comments WHERE id = ?').get(parentId);
    if (parent?.handle) {
      recordNotification(db, {
        recipientHandle: parent.handle,
        kind: 'reply_to_comment',
        subName,
        targetType: 'comment',
        targetId: result.commentId,
        actorHandle: handle,
        snippet: commentBody,
      });
    }
  } else {
    const post = db.prepare('SELECT handle FROM posts WHERE id = ?').get(postId);
    if (post?.handle) {
      recordNotification(db, {
        recipientHandle: post.handle,
        kind: 'comment_on_post',
        subName,
        targetType: 'comment',
        targetId: result.commentId,
        actorHandle: handle,
        snippet: commentBody,
      });
    }
  }
  // JSON branch: client-side comment.js inserts the rendered fragment
  // in-place so the page doesn't reload. Loading-dots wave shows during
  // the round-trip. Falls back to native redirect if Accept != JSON.
  if (wantsJson(req)) {
    const pseudonym = pseudonymFor(db, handle);
    const newComment = {
      id: result.commentId,
      parent_comment_id: parentId || null,
      handle,
      body: commentBody,
      score: 0,
      created_at: Date.now(),
      replies: [],
    };
    const ctx = {
      pseudonyms: new Map([[handle, pseudonym]]),
      commentVotes: new Map(),
      currentHandle: handle,
      subName,
      postId,
      returnTo: `/sub/${subName}/post/${postId}`,
    };
    return sendJson(res, 200, {
      ok: true,
      commentId: result.commentId,
      parentId: parentId || null,
      html: render(commentNodeView(newComment, ctx, parentId ? 1 : 0)),
    });
  }
  // Land on the new comment so the user sees their submission in context
  // instead of the page jumping to the top.
  redirect(res, `/sub/${subName}/post/${postId}#comment-${result.commentId}`);
}

function renderPostEditPage(req, res, { db, auth, postsDir }, subName, postId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to edit.</p>`));
  const result = getPost(db, postId, postsDir);
  if (!result || result.post.sub_name !== subName) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">post not found.</p>`));
  }
  const { post, body } = result;
  if (post.handle !== handle) return send(res, 403, quickPage(req, { db, auth }, 'forbidden', html`<p class="muted">not your post.</p>`));
  if (Date.now() - post.created_at > POST_EDIT_WINDOW_MS) {
    return send(res, 403, quickPage(req, { db, auth }, 'edit window closed', html`<p class="muted">the 24h edit window has passed. <a href="${permalinkFor(post)}">back</a></p>`));
  }
  const permalink = permalinkFor(post);
  send(res, 200, pageView({ db, currentHandle: handle, title: `edit: ${post.title}` }, html`
    <p><a href="${permalink}">← back to post</a></p>
    <h2 class="section">// edit post</h2>
    <form method="POST" action="/sub/${subName}/post/${postId}/edit" class="post-form">
      <label>body (markdown)</label>
      <textarea name="body" required>${body}</textarea>
      <label class="post-form-row sensitive-row">
        <input type="checkbox" name="sensitive" value="1" ${post.sensitive ? 'checked' : ''}>
        <span class="muted">mark as sensitive (advisory banner; not for porn — see rules)</span>
      </label>
      <div class="form-actions">
        <button>save</button>
        <a href="${permalink}">cancel</a>
      </div>
    </form>
  `));
}

async function handlePostEdit(req, res, { db, auth, postsDir }, subName, postId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to edit.</p>`));
  const form = parseForm(await readBody(req));
  const body = form.body ?? '';
  const sensitive = form.sensitive === '1';
  try {
    editPost(db, { postId, handle, body, sensitive, postsDir });
  } catch (err) {
    const status = err.message.includes('not the author') || err.message.includes('window') ? 403 : 400;
    return send(res, status, errorPage(req, { db, auth }, { title: 'edit failed', message: err.message }));
  }
  const post = db.prepare('SELECT sub_name, id FROM posts WHERE id = ?').get(postId);
  redirect(res, permalinkFor(post));
}

function renderCommentEditPage(req, res, { db, auth }, subName, postId, commentId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to edit.</p>`));
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!comment || comment.post_id !== postId) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">comment not found.</p>`));
  }
  if (comment.handle !== handle) return send(res, 403, quickPage(req, { db, auth }, 'forbidden', html`<p class="muted">not your comment.</p>`));
  if (Date.now() - comment.created_at > COMMENT_EDIT_WINDOW_MS) {
    return send(res, 403, quickPage(req, { db, auth }, 'edit window closed', html`<p class="muted">the 24h edit window has passed. <a href="/sub/${subName}/post/${postId}#comment-${commentId}">back</a></p>`));
  }
  send(res, 200, pageView({ db, currentHandle: handle, title: 'edit comment' }, html`
    <p><a href="/sub/${subName}/post/${postId}#comment-${commentId}">← back</a></p>
    <h2 class="section">// edit comment</h2>
    <form method="POST" action="/sub/${subName}/post/${postId}/comment/${commentId}/edit" class="post-form">
      <label>body (markdown)</label>
      <textarea name="body" required>${comment.body}</textarea>
      <div class="form-actions">
        <button>save</button>
        <a href="/sub/${subName}/post/${postId}#comment-${commentId}">cancel</a>
      </div>
    </form>
  `));
}

async function handleCommentEdit(req, res, { db, auth }, subName, postId, commentId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to edit.</p>`));
  const form = parseForm(await readBody(req));
  const body = form.body ?? '';
  try {
    editComment(db, { commentId, handle, body });
  } catch (err) {
    const status = err.message.includes('not the author') || err.message.includes('window') ? 403 : 400;
    return send(res, status, errorPage(req, { db, auth }, { title: 'edit failed', message: err.message }));
  }
  redirect(res, `/sub/${subName}/post/${postId}#comment-${commentId}`);
}

function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleVote(req, res, { db, auth }) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    if (wantsJson(req)) return sendJson(res, 401, { error: 'login required' });
    return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to vote.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { target_type: targetType, target_id: targetId, direction, return_to: returnTo } = form;
  let result;
  try {
    result = castVote(db, { targetType, targetId, voterHandle: handle, direction });
  } catch (err) {
    if (wantsJson(req)) return sendJson(res, 400, { error: err.message });
    return send(res, 400, quickPage(req, { db, auth }, 'vote failed', html`<p class="muted">${err.message}</p>`));
  }
  if (wantsJson(req)) return sendJson(res, 200, result);
  // Native form path: redirect back to where the user came from. Whitelist
  // the path so /vote can't be weaponized as an open redirect.
  const safeReturn = safeLocalRedirect(returnTo, '/');
  redirect(res, safeReturn);
}

// Legacy /post/<id> from M1/M2: redirect to the canonical sub-namespaced URL.
function redirectLegacyPost(req, res, { db, auth }, postId) {
  const post = db.prepare('SELECT sub_name FROM posts WHERE id = ?').get(postId);
  if (!post) return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">post not found.</p>`));
  res.writeHead(301, { Location: `/sub/${post.sub_name}/post/${postId}` });
  res.end();
}

function renderAvatar(res, handle) {
  if (!HANDLE_RE.test(handle)) {
    return send(res, 400, 'bad handle');
  }
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(avatarSvg(handle));
}

// /robots.txt — declarative crawl policy. Indexes every public route
// (homepage, sub feeds, post pages, /about, /modlog, /subs); blocks
// auth callbacks, POST endpoints, and the per-user /memlog. Sitemap
// line points crawlers at the dynamic sitemap.xml.
function renderRobots(res) {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /draft',
    'Disallow: /vote',
    'Disallow: /flag',
    'Disallow: /login',
    'Disallow: /logout',
    'Disallow: /verify',
    'Disallow: /auth/',
    'Disallow: /memlog',
    'Disallow: /modlog/resolve',
    `Sitemap: ${siteMeta.baseUrl}/sitemap.xml`,
    '',
  ];
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(lines.join('\n'));
}

// /sitemap.xml — every public, indexable URL on this instance:
//   /, /about, /modlog, /subs, /sub/<name>, /sub/<name>/post/<id>
// Pagination + filter params excluded; canonical pages only.
// `lastmod` uses the most recent activity timestamp for sub indices,
// the post's created_at for post pages. Removed posts are excluded.
function renderSitemap(res, { db }) {
  const base = siteMeta.baseUrl;
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = isoDay(Date.now());
  const urls = [];
  const push = (loc, lastmod, priority, changefreq) => {
    urls.push(
      `  <url>\n` +
      `    <loc>${escapeXml(loc)}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${changefreq}</changefreq>\n` +
      `    <priority>${priority}</priority>\n` +
      `  </url>`
    );
  };
  push(`${base}/`, today, '1.0', 'hourly');
  push(`${base}/subs`, today, '0.5', 'daily');
  push(`${base}/about`, today, '0.5', 'monthly');
  push(`${base}/modlog`, today, '0.5', 'daily');
  // Sub index pages — lastmod = most recent post in the sub (or today
  // for empty subs).
  const subs = db.prepare(`
    SELECT s.name, MAX(p.created_at) AS last_post_at
    FROM subs s LEFT JOIN posts p ON p.sub_name = s.name AND p.removed_at IS NULL
    GROUP BY s.name
    ORDER BY s.name
  `).all();
  for (const s of subs) {
    push(`${base}/sub/${encodeURIComponent(s.name)}`, isoDay(s.last_post_at ?? Date.now()), '0.7', 'daily');
  }
  // Post pages — exclude removed.
  const posts = db.prepare(`
    SELECT id, sub_name, created_at FROM posts WHERE removed_at IS NULL ORDER BY created_at DESC
  `).all();
  for (const p of posts) {
    push(`${base}/sub/${encodeURIComponent(p.sub_name)}/post/${encodeURIComponent(p.id)}`, isoDay(p.created_at), '0.7', 'weekly');
  }
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n' +
    '</urlset>\n';
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

// Inline mod controls. Rendered next to a post or comment when the
// current user is owner or co-mod of the sub. The buttons toggle the
// soft-state column via POST /sub/<name>/mod. State-aware: shows
// "uncollapse" if collapsed, "unremove" if removed, etc.
// Public view of a post or comment's mod state. Live = body inline.
// Soft-removed = `[+] [collapsed by mod]` <details> chip; clicking the
// chip expands the body in place of the label. Hard-removed = `[-]
// [removed by mod]` static stub, no body. Same shape, different sigils,
// different interactivity. PRD §Moderation Tier 2.
function modStateView({ removedAt, collapsedAt, body }) {
  if (removedAt != null) {
    return html`<div class="mod-state mod-hard-removed muted">
      <span class="sigil">[−]</span> <span class="label">[removed by mod]</span>
    </div>`;
  }
  if (collapsedAt != null) {
    return html`<details class="mod-state mod-soft-removed">
      <summary>
        <span class="sigil">[+]</span> <span class="label">[collapsed by mod]</span>
      </summary>
      ${body}
    </details>`;
  }
  return body;
}

// Inline confirm form per mod action. Clicking the action label expands a
// small form with a reason textarea + confirm button. Hard removal (remove)
// requires a reason; soft removal (collapse) makes it optional. The
// expand-form pattern is the friction that makes hard moderation
// deliberate without needing a JS modal.
function modActionForm({ subName, action, targetType, targetId, returnTo, reasonRequired, disabled, warn }) {
  if (disabled) {
    // Dimmed marker: only one mod-state should be active at a time. When
    // the target is hard-removed, the collapse/uncollapse pair is meaningless
    // (the body is gone), so we render a non-interactive label in place of
    // the <details> button. The mod must `unremove` first to re-enable.
    return html`<span class="mod-btn mod-btn-disabled" aria-disabled="true" title="not available while ${MOD_ACTION_LABELS.remove ?? 'removed'}">${action}</span>`;
  }
  const summaryClass = warn ? 'mod-btn mod-btn-warn' : 'mod-btn';
  return html`<details class="mod-confirm">
    <summary class="${summaryClass}">${action}</summary>
    <form method="POST" action="/sub/${subName}/mod" class="mod-form">
      <input type="hidden" name="action" value="${action}">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="return_to" value="${returnTo}">
      <textarea name="reason" placeholder="${reasonRequired ? 'reason (required)' : 'reason (optional)'}" ${reasonRequired ? raw('required') : raw('')}></textarea>
      <button>confirm ${action}</button>
    </form>
  </details>`;
}

function modControls({
  subName, targetType, targetId, collapsedAt, removedAt, returnTo,
  authorHandle, authorBanned, currentHandle,
}) {
  const collapseAction = collapsedAt != null ? 'uncollapse' : 'collapse';
  const removeAction   = removedAt   != null ? 'unremove'   : 'remove';
  // Mutual exclusion: hard-removal supersedes soft-collapse. While the item
  // is hard-removed, dim the collapse pair — the body is gone, so toggling a
  // collapse on/off is a no-op. A mod escalating from collapse → remove is
  // still allowed (remove pair stays live when collapsed_at is set).
  // Reason required only on the destructive direction: 'remove'. uncollapse,
  // unremove, and collapse all leave content readable, so the deliberation
  // gate is lighter.
  // Ban: target_type='handle', target_id=author. Reason required on the
  // ban direction (it cuts a user out of every write path in this sub),
  // optional on unban. Skipped entirely when authorHandle isn't known.
  // When the author is currently banned in this sub, render the unban
  // form with a "warn" class so the banned-state is visible at a glance.
  // Plain "ban" on a non-banned author is the usual neutral mod-btn.
  // Self-ban is a footgun — banning yourself out of a sub you mod has
  // no legitimate use. Hide (not dim) the ban control when the author
  // is the current mod. Collapse/remove stay visible because mod-acting
  // on your own old content is a legitimate cleanup path (no
  // author-delete after the edit window).
  const banForm = authorHandle && authorHandle !== currentHandle
    ? modActionForm({
        subName,
        action: authorBanned ? 'unban' : 'ban',
        targetType: 'handle',
        targetId: authorHandle,
        returnTo,
        reasonRequired: !authorBanned,
        warn: authorBanned,
      })
    : html``;
  return html`<div class="mod-controls">
    ${modActionForm({ subName, action: collapseAction, targetType, targetId, returnTo,
      reasonRequired: false, disabled: removedAt != null })}
    ${modActionForm({ subName, action: removeAction,   targetType, targetId, returnTo,
      reasonRequired: removeAction === 'remove' })}
    ${banForm}
  </div>`;
}

// Flag button — every logged-in user can flag any post/comment for mod
// review. PRD §Spam 7: flagging is separate from downvote; categories
// are a closed list. Threshold-based auto-hide lives in the flag module.
function flagButton({ targetType, targetId, returnTo, alreadyFlagged }) {
  if (alreadyFlagged) {
    // Dimmed marker: the user already submitted a flag on this target. The
    // UNIQUE on (target_type, target_id, flagger_handle) would silently
    // collide on resubmit; rendering the dimmed label up front makes the
    // state visible instead of swallowing the second click.
    return html`<span class="flag-trigger muted flag-trigger-disabled" title="you flagged this">flagged</span>`;
  }
  return html`<details class="flag-form-wrap">
    <summary class="flag-trigger muted">flag</summary>
    <form method="POST" action="/flag" class="flag-form">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="return_to" value="${returnTo}">
      <select name="category" required>
        ${FLAG_CATEGORIES.map((c) => html`<option value="${c}">${c.replace('_', ' ')}</option>`)}
      </select>
      <input name="note" placeholder="optional note" maxlength="280">
      <button>submit flag</button>
    </form>
  </details>`;
}

async function handleFlag(req, res, { db, auth }) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to flag.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { target_type: targetType, target_id: targetId, category, note, return_to: returnTo } = form;
  try {
    submitFlag(db, {
      targetType, targetId, flaggerHandle: handle, category,
      note: note && note.trim().length > 0 ? note.trim() : null,
    });
  } catch (err) {
    // UNIQUE collision = same user re-flagging the same target. Treat as
    // success-ish (their concern is registered) so the redirect is clean.
    if (!/UNIQUE/.test(err.message)) {
      return send(res, 400, quickPage(req, { db, auth }, 'flag failed', html`<p class="muted">${err.message}</p>`));
    }
  }
  const safeReturn = safeLocalRedirect(returnTo, '/');
  redirect(res, safeReturn);
}

// Resolve the handle a mod action affects and emit a memlog notification.
// Owner-only sub-management actions (promote/demote/transfer) don't notify;
// those land in the public modlog for affected co-mods to see directly.
const NOTIFIABLE_MOD_ACTIONS = new Set([
  'collapse', 'uncollapse', 'remove', 'unremove', 'ban', 'unban',
]);
function notifyModAction(db, { subName, action, targetType, targetId, modHandle, reason }) {
  if (!NOTIFIABLE_MOD_ACTIONS.has(action)) return;
  let recipientHandle = null;
  if (targetType === 'handle') {
    recipientHandle = targetId;
  } else if (targetType === 'post') {
    recipientHandle = db.prepare('SELECT handle FROM posts WHERE id = ?').get(targetId)?.handle ?? null;
  } else if (targetType === 'comment') {
    recipientHandle = db.prepare('SELECT handle FROM comments WHERE id = ?').get(targetId)?.handle ?? null;
  }
  if (!recipientHandle) return;
  recordNotification(db, {
    recipientHandle,
    kind: 'mod_action',
    subName,
    targetType,
    targetId,
    actorHandle: modHandle,
    snippet: reason ? `${action}: ${reason}` : action,
  });
}

async function handleModAction(req, res, { db, auth }, subName) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in to moderate.',
    }));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { action, target_type: targetType, target_id: targetId, reason, return_to: returnTo } = form;
  if (!MOD_ACTIONS.includes(action)) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'bad action', message: 'unknown mod action.',
    }));
  }
  const trimmedReason = reason && reason.trim().length > 0 ? reason.trim() : null;
  // Hard removal (the destructive direction) requires a written reason —
  // self-discipline gate per "every mod action is auditable" + reason
  // captures intent for the modlog so future reviewers can judge it.
  if (action === 'remove' && !trimmedReason) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'reason required', message: 'hard removal requires a reason.',
    }));
  }
  try {
    recordAction(db, {
      subName, modHandle: handle, action, targetType, targetId, reason: trimmedReason,
    });
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'mod failed', message: err.message,
    }));
  }
  notifyModAction(db, { subName, action, targetType, targetId, modHandle: handle, reason: trimmedReason });
  const safeReturn = safeLocalRedirect(returnTo, `/sub/${subName}`);
  redirect(res, safeReturn);
}

// Resolve every pending flag on a target plus (when upholding) record
// the corresponding mod_action. One transaction so a pending flag set
// can never be partly resolved on a server crash. Mod must moderate the
// sub the target lives in — otherwise this is rejected as a 403, even
// if a crafted form names a sub the caller doesn't run.
async function handleModlogResolve(req, res, { db, auth }) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in to moderate.',
    }));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { target_type: targetType, target_id: targetId, sub_name: subName, decision, reason, return_to: returnTo } = form;
  const backToModlog = html`<p><a href="/modlog">← back to /modlog</a></p>`;
  if (!['post', 'comment'].includes(targetType)) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'bad target', message: 'invalid target.', links: backToModlog,
    }));
  }
  if (!['uphold-soft', 'uphold-hard', 'dismiss'].includes(decision)) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'bad decision', message: 'unknown decision.', links: backToModlog,
    }));
  }
  if (!canModerate(db, subName, handle)) {
    return send(res, 403, errorPage(req, { db, auth }, {
      title: 'not a mod', message: "you don't moderate this sub.", links: backToModlog,
    }));
  }
  const trimmedReason = reason && reason.trim().length > 0 ? reason.trim() : null;
  if (decision === 'uphold-hard' && !trimmedReason) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'reason required', message: 'hard removal requires a reason.', links: backToModlog,
    }));
  }
  // recordAction wraps each call in its own BEGIN/COMMIT (see mod.js),
  // and SQLite has no nested transactions, so we sequence the two
  // operations rather than wrap them. If resolveFlagsForTarget throws
  // after recordAction succeeded, the mod_action persists with flags
  // still pending — visible to the mod, recoverable by re-clicking.
  try {
    if (decision === 'uphold-soft') {
      recordAction(db, { subName, modHandle: handle, action: 'collapse', targetType, targetId, reason: trimmedReason });
      notifyModAction(db, { subName, action: 'collapse', targetType, targetId, modHandle: handle, reason: trimmedReason });
      resolveFlagsForTarget(db, { targetType, targetId, resolverHandle: handle, resolution: 'upheld' });
    } else if (decision === 'uphold-hard') {
      recordAction(db, { subName, modHandle: handle, action: 'remove', targetType, targetId, reason: trimmedReason });
      notifyModAction(db, { subName, action: 'remove', targetType, targetId, modHandle: handle, reason: trimmedReason });
      resolveFlagsForTarget(db, { targetType, targetId, resolverHandle: handle, resolution: 'upheld' });
    } else {
      // dismiss: close out flags + uncollapse if the auto-hide threshold
      // had hidden the target (collapsed_at non-null with no mod
      // collapse on record). recordAction emits an 'uncollapse' so the
      // public modlog reflects the override.
      const table = targetType === 'post' ? 'posts' : 'comments';
      const target = db.prepare(`SELECT collapsed_at FROM ${table} WHERE id = ?`).get(targetId);
      resolveFlagsForTarget(db, { targetType, targetId, resolverHandle: handle, resolution: 'dismissed' });
      if (target && target.collapsed_at != null) {
        recordAction(db, { subName, modHandle: handle, action: 'uncollapse', targetType, targetId, reason: trimmedReason });
        notifyModAction(db, { subName, action: 'uncollapse', targetType, targetId, modHandle: handle, reason: trimmedReason });
      }
    }
  } catch (err) {
    return send(res, 400, errorPage(req, { db, auth }, {
      title: 'resolve failed', message: err.message,
      links: html`<p><a href="/modlog">← back to /modlog</a></p>`,
    }));
  }
  const safeReturn = safeLocalRedirect(returnTo, '/modlog');
  redirect(res, safeReturn);
}

// Personal notification log — memlog (M6/B0). The user's private inverse
// of /modlog: events that happened *to* their content. Same table chrome
// as the modlog audit view so mental model stays one. Three filter chips:
// all kinds plus a per-kind narrow. Default view is unread; "all" pulls
// in read history (kept for 90 days, lazily pruned on every GET). Mark-
// all-read respects the active filter so users can clear one kind without
// losing visibility on others.
const MEMLOG_KIND_FILTERS = [
  { slug: 'comments',    kinds: ['comment_on_post'],   label: 'comments' },
  { slug: 'replies',     kinds: ['reply_to_comment'],  label: 'replies' },
  { slug: 'mod-actions', kinds: ['mod_action'],        label: 'mod actions' },
];

const MEMLOG_MODES = ['notifications', 'activity', 'all'];

function memlogParseFilters(searchParams) {
  const modeParam = searchParams?.get('mode');
  const mode = MEMLOG_MODES.includes(modeParam) ? modeParam : 'notifications';
  const show = searchParams?.get('show') === 'all' ? 'all' : 'unread';
  const kindParam = searchParams?.get('kind') || 'all';
  const matched = MEMLOG_KIND_FILTERS.find((f) => f.slug === kindParam);
  return { mode, show, kindSlug: matched ? matched.slug : 'all', kinds: matched ? matched.kinds : null };
}

function memlogHref({ mode, show, kindSlug }) {
  const params = new URLSearchParams();
  if (mode && mode !== 'notifications') params.set('mode', mode);
  if (show !== 'unread') params.set('show', show);
  if (kindSlug !== 'all') params.set('kind', kindSlug);
  const qs = params.toString();
  return qs ? `/memlog?${qs}` : '/memlog';
}

function memlogTargetLink(db, n) {
  if (n.target_type === 'comment') {
    const row = db.prepare(
      `SELECT c.id AS comment_id, c.post_id, p.sub_name
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.id = ?`
    ).get(n.target_id);
    if (!row) return null;
    return `/sub/${row.sub_name}/post/${row.post_id}#comment-${row.comment_id}`;
  }
  if (n.target_type === 'post') {
    const row = db.prepare('SELECT id, sub_name FROM posts WHERE id = ?').get(n.target_id);
    if (!row) return null;
    return `/sub/${row.sub_name}/post/${row.id}`;
  }
  if (n.target_type === 'handle' && n.sub_name) {
    return `/sub/${n.sub_name}/modlog`;
  }
  return null;
}

const MEMLOG_KIND_LABELS = {
  comment_on_post:  'comment on post',
  reply_to_comment: 'reply',
  mod_action:       'mod action',
  my_post:          'my post',
  my_comment:       'my comment',
};

function renderMemlog(req, res, { db, auth }, searchParams) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to see your memlog.</p>`));
  }
  pruneOldNotifications(db);
  const filters = memlogParseFilters(searchParams);
  // Pull the rows for the active mode. notifications = received-events
  // table; activity = my-authored posts + comments; all = both merged
  // by created_at desc. Kind/show filters apply only to notifications;
  // for activity they're hidden (no read-state, no kind subfilter yet).
  let rows = [];
  if (filters.mode === 'notifications') {
    rows = listNotifications(db, handle, { show: filters.show, kinds: filters.kinds, limit: 200 });
  } else if (filters.mode === 'activity') {
    rows = listActivityForHandle(db, handle, { limit: 200 });
  } else {
    const notifs = listNotifications(db, handle, { show: 'all', limit: 200 });
    const activity = listActivityForHandle(db, handle, { limit: 200 });
    rows = [...notifs, ...activity].sort((a, b) => b.created_at - a.created_at).slice(0, 200);
  }
  const actorHandles = [...new Set(rows.map((r) => r.actor_handle).filter(Boolean))];
  const pseudonyms = pseudonymsByHandle(db, actorHandles);
  const modeLink = (slug, label) => {
    const isActive = filters.mode === slug;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${memlogHref({ ...filters, mode: slug, kindSlug: 'all', show: 'unread' })}">${label}</a>`;
  };
  const filterLink = (slug, label) => {
    const isActive = (slug === 'all' && filters.kindSlug === 'all') || filters.kindSlug === slug;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${memlogHref({ ...filters, kindSlug: slug })}">${label}</a>`;
  };
  const showLink = (val, label) => {
    const isActive = filters.show === val;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${memlogHref({ ...filters, show: val })}">${label}</a>`;
  };
  const markAllForm = html`<form method="POST" action="/memlog/mark-read" class="filter-form">
    <input type="hidden" name="kind" value="${filters.kindSlug}">
    <input type="hidden" name="return_to" value="${memlogHref(filters)}">
    <button class="filter-btn" title="mark all visible as read">mark all read</button>
  </form>`;
  // show/kind/mark-read only meaningful for notification rows. Hide them
  // when the active mode is activity (own posts/comments aren't unread,
  // and the notification kind axis doesn't apply).
  const showsNotificationFilters = filters.mode !== 'activity';
  const filterBar = html`<div class="modlog-filters muted">
    mode: ${modeLink('notifications', 'notifications')} ${modeLink('activity', 'activity')} ${modeLink('all', 'all')}
    ${showsNotificationFilters ? html`
      <span class="filter-sep">·</span>
      show: ${showLink('unread', 'unread')} ${showLink('all', 'all')}
      <span class="filter-sep">·</span>
      kind: ${filterLink('all', 'all')} ${MEMLOG_KIND_FILTERS.map((f) => filterLink(f.slug, f.label))}
      <span class="filter-sep">·</span>
      ${markAllForm}
    ` : html``}
  </div>`;
  const emptyText = filters.mode === 'activity'
    ? 'no posts or comments yet.'
    : filters.mode === 'all'
      ? 'nothing in your memlog yet.'
      : (filters.show === 'unread' ? 'no unread notifications.' : 'nothing in your memlog yet.');
  const body = rows.length === 0
    ? html`<p class="muted">${emptyText}</p>`
    : html`<table class="modlog">
        <thead><tr><th>type</th><th>when</th><th>kind</th><th>from</th><th>where</th><th>snippet</th></tr></thead>
        <tbody>${rows.map((n) => {
          const link = memlogTargetLink(db, n);
          const ago = relativeTime(n.created_at);
          const isActivity = n.kind === 'my_post' || n.kind === 'my_comment';
          const typeLabel = isActivity ? 'actv' : 'ntfy';
          const fromName = isActivity ? '—' : (n.actor_handle ? (pseudonyms.get(n.actor_handle) ?? n.actor_handle.slice(0, 8)) : 'system');
          const where = n.sub_name ? html`<a class="sub-link sub-${subColorIndex(n.sub_name)}" href="/sub/${n.sub_name}">//${n.sub_name}</a>` : html`—`;
          const snippet = n.snippet ?? '';
          const rowCls = n.read_at ? 'memlog-row-read' : '';
          // Activity rows have post/comment ids, not notification ids —
          // route directly via memlogTargetLink, no read-state to mark.
          const whenCell = !link
            ? html`<span class="muted">${ago}</span>`
            : isActivity
              ? html`<a href="${link}" title="open">${ago}</a>`
              : html`<a href="/memlog/go/${n.id}" title="open">${ago}</a>`;
          return html`<tr class="${rowCls}">
            <td class="muted">${typeLabel}</td>
            <td>${whenCell}</td>
            <td class="muted">${MEMLOG_KIND_LABELS[n.kind] ?? n.kind}</td>
            <td class="muted">${fromName}</td>
            <td>${where}</td>
            <td class="muted">${snippet}</td>
          </tr>`;
        })}</tbody>
      </table>`;
  const intro = filters.mode === 'activity'
    ? 'showing posts and comments you authored. removed content is excluded — for that, see the public modlog of the relevant sub.'
    : filters.mode === 'all'
      ? 'one stream: notifications received + posts and comments authored, newest first. read state and kind filters apply only to notifications.'
      : 'showing notifications: comments and replies you received, plus mod actions on your content. read items stay visible for 90 days.';
  send(res, 200, pageView({ db, currentHandle: handle, title: 'memlog' }, html`
    <div class="memlog-page">
      <p><a href="/">← home</a></p>
      <h2>// memlog</h2>
      <p class="muted">your private personal log — everything you do on this instance and everything done in response. one place, filtered by mode.</p>
      <p class="muted">${intro}</p>
      ${filterBar}
      ${body}
    </div>
  `));
}

async function handleMemlogMarkRead(req, res, { db, auth }) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, errorPage(req, { db, auth }, {
      title: 'login required', message: 'log in to clear your memlog.',
    }));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const kindSlug = form.kind || 'all';
  const matched = MEMLOG_KIND_FILTERS.find((f) => f.slug === kindSlug);
  markAllNotificationsRead(db, handle, { kinds: matched ? matched.kinds : null });
  redirect(res, safeLocalRedirect(form.return_to, '/memlog'));
}

function handleMemlogGo(req, res, { db, auth }, idParam) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">log in to follow this link.</p>`));
  }
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return send(res, 400, quickPage(req, { db, auth }, 'bad notification', html`<p class="muted">invalid notification id.</p>`));
  }
  const row = db.prepare(
    `SELECT id, kind, sub_name, target_type, target_id
     FROM notifications WHERE id = ? AND recipient_handle = ?`
  ).get(id, handle);
  if (!row) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">no such notification. <a href="/memlog">back</a></p>`));
  }
  markNotificationRead(db, handle, id);
  const target = memlogTargetLink(db, row);
  redirect(res, target ?? '/memlog');
}

// Public per-sub modlog. Audit-only (the trust surface). Same table shape
// as the mod-only /modlog audit view so a viewer's mental model is one
// table, not two — minus the mode/sub/date/type bar (this is locked to
// one sub, audit, all-time) and minus pending data (queries `mod_actions`
// only, which is upheld actions; pending flags live in the `flags` table
// and never reach this surface).
function renderModLog(req, res, { db, auth }, subName, searchParams) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">sub not found.</p>`));
  }
  const currentHandle = auth.handleFromRequest(req);
  const modParam = searchParams?.get('mod') ?? null;
  const userParam = searchParams?.get('user') ?? null;
  const dateParam = searchParams?.get('date') === '24h' ? '24h' : 'all';
  const rawType = searchParams?.get('type');
  const typeParam = ['flagged', 'banned', 'removed'].includes(rawType) ? rawType : 'all';
  const since = dateParam === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : undefined;
  const actionFilter = MODLOG_TYPES[typeParam] ?? undefined;
  const actions = listModActionsAcrossSubs(db, [subName], {
    limit: 100,
    since,
    actions: actionFilter,
    modHandle: modParam ?? undefined,
    targetHandle: userParam ?? undefined,
  });
  const { commentToPost, targetAuthor } = batchTargetLookups(db, actions);
  const modHandles = [...new Set(actions.map((a) => a.mod_handle).filter((h) => h != null))];
  const userHandles = [...new Set([
    ...actions.filter((a) => a.target_type === 'handle').map((a) => a.target_id),
    ...targetAuthor.values(),
  ])];
  // Include filter param handles too so the active-summary line can
  // resolve the pseudonym even when the filter narrows results to zero.
  if (modParam && modParam !== 'system') modHandles.push(modParam);
  if (userParam) userHandles.push(userParam);
  const pseudonyms = pseudonymsByHandle(db, [...modHandles, ...userHandles]);
  const targetCell = (a) => {
    if (a.target_type === 'post') {
      return html`<a href="/sub/${subName}/post/${a.target_id}">post ${a.target_id.slice(0, 12)}</a>`;
    }
    if (a.target_type === 'comment') {
      const postId = commentToPost.get(a.target_id);
      return postId
        ? html`<a href="/sub/${subName}/post/${postId}#comment-${a.target_id}">comment ${a.target_id.slice(0, 12)}</a>`
        : html`<span class="muted">comment ${a.target_id.slice(0, 12)}</span>`;
    }
    if (a.target_type === 'handle') {
      return html`<span class="muted">${pseudonyms.get(a.target_id) ?? a.target_id.slice(0, 8)}</span>`;
    }
    return html`<span class="muted">${a.target_type} ${a.target_id.slice(0, 12)}</span>`;
  };

  const subModlogHref = (overrides) => {
    const params = new URLSearchParams();
    const merged = {
      mod: modParam,
      user: userParam,
      date: dateParam === '24h' ? '24h' : null,
      type: typeParam !== 'all' ? typeParam : null,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v == null || v === '' || v === false) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/sub/${subName}/modlog?${qs}` : `/sub/${subName}/modlog`;
  };
  const filterToggle = (key, value, label, currentValue) => {
    const isActive = currentValue === value;
    const next = isActive ? { [key]: null } : { [key]: value };
    const cls = isActive ? 'filter-toggle filter-toggle-active' : 'filter-toggle';
    return html`<a class="${cls}" href="${subModlogHref(next)}">${label}</a>`;
  };
  const modCell = (a) => {
    if (a.mod_handle === SYSTEM_HANDLE) {
      return filterToggle('mod', 'system', html`<em>system</em>`, modParam);
    }
    if (a.mod_handle == null) {
      return html`<em class="muted">community</em>`;
    }
    const label = pseudonyms.get(a.mod_handle) ?? a.mod_handle.slice(0, 8);
    return filterToggle('mod', a.mod_handle, label, modParam);
  };
  const userCell = (a) => {
    const handle = a.target_type === 'handle' ? a.target_id : targetAuthor.get(a.target_id);
    if (!handle) return html`<span class="muted">—</span>`;
    const label = pseudonyms.get(handle) ?? handle.slice(0, 8);
    return filterToggle('user', handle, label, userParam);
  };

  const dateBtn = (val, label) => {
    const isActive = dateParam === val;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${subModlogHref({ date: val === 'all' ? null : val })}">${label}</a>`;
  };
  const typeBtn = (val, label) => {
    const isActive = typeParam === val;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${subModlogHref({ type: val === 'all' ? null : val })}">${label}</a>`;
  };
  const filterBar = html`<p class="modlog-filters muted">
    ${dateBtn('24h', 'new (24h)')} ${dateBtn('all', 'all-time')}
    <span class="filter-sep">·</span>
    ${typeBtn('flagged', 'flagged')} ${typeBtn('banned', 'banned')} ${typeBtn('removed', 'removed')} ${typeBtn('all', 'all')}
  </p>`;

  const summaryParts = [];
  if (modParam === 'system') summaryParts.push('mod=system');
  else if (modParam) summaryParts.push(`mod=${pseudonyms.get(modParam) ?? modParam.slice(0, 8)}`);
  if (userParam) summaryParts.push(`user=${pseudonyms.get(userParam) ?? userParam.slice(0, 8)}`);
  if (dateParam === '24h') summaryParts.push('last 24h');
  if (typeParam !== 'all') summaryParts.push(`type=${typeParam}`);
  const summary = summaryParts.length === 0
    ? html``
    : html`<p class="muted modlog-summary">showing: ${summaryParts.join(', ')} · <a href="/sub/${subName}/modlog">clear all</a></p>`;

  const rowsView = actions.length === 0
    ? html`<p class="muted">no mod actions match.</p>`
    : html`<table class="modlog">
        <thead><tr><th>when</th><th>mod</th><th>user</th><th>action</th><th>target</th><th>reason</th></tr></thead>
        <tbody>${actions.map((a) => html`<tr>
          <td class="muted">${relativeTime(a.created_at)}</td>
          <td>${modCell(a)}</td>
          <td>${userCell(a)}</td>
          <td><span class="mod-action mod-action-${a.action}">${MOD_ACTION_LABELS[a.action] ?? a.action}</span></td>
          <td>${targetCell(a)}</td>
          <td class="muted">${a.reason ?? ''}</td>
        </tr>`)}</tbody>
      </table>`;

  send(res, 200, pageView({
    db, currentHandle,
    title: `/sub/${subName}/modlog`,
    description: `public moderation log for ${branding.forumName} //${subName}: every soft removal, hard removal, ban, and system auto-action.`,
    canonical: `${siteMeta.baseUrl}/sub/${encodeURIComponent(subName)}/modlog`,
  }, html`
    <p><a href="/">← home</a> · <a href="/sub/${subName}">${subName}</a> · //modlog</p>
    <h2>// modlog</h2>
    <p class="muted">every moderator action in this sub. public.</p>
    ${filterBar}
    ${summary}
    ${rowsView}
  `));
}

// Cross-sub modlog for the current user's mod-of subs. M5 unifies this
// surface into three modes (open / inbox / audit) — see
// docs/01-product/m5-mod-surface-spec.md. This file currently lands the
// dispatcher + audit mode (steps 1+2 of the spec's implementation order).
// Open and inbox stub out until steps 3+4. 50 rows per page (up from 25
// because pending-flag volume will arrive with open mode).
const MODLOG_PAGE_SIZE = 50;

const MODLOG_MODES = ['open', 'inbox', 'audit'];
const MODLOG_TYPES = {
  // Mapping from type-filter chip to the action enum subset it shows in
  // audit mode. 'flagged' has no clean SQL mapping until flag→action
  // linkage is added in step 4 (open mode); for now it is a no-op in
  // audit so the chip is still present in the UI but doesn't constrain.
  banned:  ['ban', 'unban'],
  removed: ['collapse', 'uncollapse', 'remove', 'unremove'],
};

function parseModlogFilters(searchParams, modSubs) {
  const raw = (k) => searchParams.get(k) ?? null;
  const mode = MODLOG_MODES.includes(raw('mode')) ? raw('mode') : 'audit';
  const date = raw('date') === '24h' ? '24h' : 'all';
  const type = ['flagged', 'banned', 'removed'].includes(raw('type')) ? raw('type') : 'all';
  const subParam = raw('sub');
  const sub = subParam && modSubs.includes(subParam) ? subParam : null;
  // mod=me is resolved by the caller (needs currentHandle); pass through.
  const mod = raw('mod');
  const user = raw('user');
  const page = Math.max(1, Number.parseInt(raw('page') ?? '1', 10) || 1);
  return { mode, date, type, sub, mod, user, page };
}

// Batched lookup helper for modlog rows. Comments resolve to their
// parent post (so the comment cell can be a permalink) and every
// post/comment row resolves to its author (so the user column reads
// naturally for soft/hard removals, not just bans).
function batchTargetLookups(db, actions) {
  const commentToPost = new Map();
  const targetAuthor = new Map();
  const postIds = [...new Set(actions.filter((a) => a.target_type === 'post').map((a) => a.target_id))];
  const commentIds = [...new Set(actions.filter((a) => a.target_type === 'comment').map((a) => a.target_id))];
  if (postIds.length > 0) {
    const ph = postIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id, handle FROM posts WHERE id IN (${ph})`).all(...postIds)) {
      targetAuthor.set(r.id, r.handle);
    }
  }
  if (commentIds.length > 0) {
    const ph = commentIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id, post_id, handle FROM comments WHERE id IN (${ph})`).all(...commentIds)) {
      commentToPost.set(r.id, r.post_id);
      targetAuthor.set(r.id, r.handle);
    }
  }
  return { commentToPost, targetAuthor };
}

function modlogHref(overrides) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null || v === '' || v === false) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `/modlog?${qs}` : '/modlog';
}

function renderMyModLog(req, res, { db, auth, postsDir }, searchParams) {
  const currentHandle = auth.handleFromRequest(req);
  const myModSubs = currentHandle ? listSubsModeratedBy(db, currentHandle) : [];
  const isMod = myModSubs.length > 0;
  // Audit is instance-wide and public — sub filter chip enumerates every
  // sub. open/inbox modes stay mod-private and scope to subs the viewer
  // moderates. parseModlogFilters validates ?sub= against the union so a
  // mod can deep-link any sub for audit; in open/inbox we re-clamp to
  // myModSubs below.
  const allSubNames = listAllSubs(db).map((s) => s.name);
  const filters = parseModlogFilters(searchParams, allSubNames);

  if (filters.mode === 'open' || filters.mode === 'inbox') {
    if (!currentHandle) {
      return send(res, 401, quickPage(req, { db, auth }, 'login required', html`<p class="muted">${filters.mode} is mod-only. <a href="/modlog">view public audit</a>.</p>`));
    }
    if (!isMod) {
      return send(res, 403, quickPage(req, { db, auth }, 'not a mod', html`<p class="muted">${filters.mode} is mod-only. <a href="/modlog">view public audit</a>.</p>`));
    }
  }

  // Default-mode landing for mods: open if anything is pending, else audit.
  // Non-mods always default to audit. Only applied when the URL has no
  // explicit ?mode= (so a clicked tab still wins).
  if (!searchParams?.get('mode') && isMod) {
    const pendingTotal = pendingFlagsAcrossSubs(db, myModSubs).length;
    if (pendingTotal > 0) filters.mode = 'open';
  }
  // ?mod=me → resolve to current handle so a bookmarked link stays stable.
  // For non-mods (logged-out OR logged-in without any sub), strip the
  // param entirely — silently rendering an unfiltered audit while the
  // URL still says ?mod=me would mislead the user. A non-mod has nothing
  // to filter by.
  if (filters.mod === 'me' && !isMod) {
    filters.mod = null;
  }
  const modHandle = filters.mod === 'me' ? currentHandle : filters.mod;

  if (filters.mode === 'open') {
    const opSub = filters.sub && myModSubs.includes(filters.sub) ? filters.sub : null;
    return renderModlogOpen(res, {
      currentHandle, db, postsDir,
      modSubs: myModSubs,
      scopedSubs: opSub ? [opSub] : myModSubs,
      filters: { ...filters, sub: opSub },
    });
  }
  if (filters.mode === 'inbox') {
    const opSub = filters.sub && myModSubs.includes(filters.sub) ? filters.sub : null;
    return renderModlogInbox(res, {
      currentHandle, db,
      modSubs: myModSubs,
      scopedSubs: opSub ? [opSub] : myModSubs,
      filters: { ...filters, sub: opSub }, modHandle,
    });
  }
  // Audit: instance-wide. modSubs = allSubNames so the sub filter chip
  // enumerates every sub. scopedSubs narrows to one when ?sub= is set.
  return renderModlogAudit(res, {
    currentHandle, db,
    modSubs: allSubNames,
    scopedSubs: filters.sub ? [filters.sub] : allSubNames,
    filters, modHandle, isMod,
  });
}

// Map a mod action to its inverse, when one exists. Used to render
// inline "revoke" buttons in the my-modlog audit view.
const REVOKE_MAP = Object.freeze({
  collapse: 'uncollapse',
  remove:   'unremove',
  ban:      'unban',
});

// For each row, return the inverse action to offer (or null) given the
// target's current state. We only show revoke when the action's effect
// is still in place — a `collapse` row whose post has since been
// uncollapsed by anyone shouldn't show a revoke button.
export function buildRevokeMap(db, actions, currentHandle) {
  const out = new Map();
  if (!currentHandle) return out;
  const candidates = actions.filter((a) => a.mod_handle === currentHandle && REVOKE_MAP[a.action]);
  if (candidates.length === 0) return out;

  const postIds    = candidates.filter((a) => a.target_type === 'post').map((a) => a.target_id);
  const commentIds = candidates.filter((a) => a.target_type === 'comment').map((a) => a.target_id);
  const banPairs   = candidates.filter((a) => a.target_type === 'handle').map((a) => [a.sub_name, a.target_id]);

  const postState = new Map();
  if (postIds.length) {
    const placeholders = postIds.map(() => '?').join(',');
    db.prepare(`SELECT id, collapsed_at, removed_at FROM posts WHERE id IN (${placeholders})`)
      .all(...postIds)
      .forEach((r) => postState.set(r.id, r));
  }
  const commentState = new Map();
  if (commentIds.length) {
    const placeholders = commentIds.map(() => '?').join(',');
    db.prepare(`SELECT id, collapsed_at, removed_at FROM comments WHERE id IN (${placeholders})`)
      .all(...commentIds)
      .forEach((r) => commentState.set(r.id, r));
  }
  const banSet = new Set();
  for (const [subName, handle] of banPairs) {
    const row = db.prepare('SELECT 1 FROM bans WHERE sub_name = ? AND handle = ?').get(subName, handle);
    if (row) banSet.add(`${subName}\0${handle}`);
  }

  for (const a of candidates) {
    let stillActive = false;
    if (a.target_type === 'post') {
      const s = postState.get(a.target_id);
      stillActive = (a.action === 'collapse' && s?.collapsed_at != null)
                 || (a.action === 'remove'   && s?.removed_at   != null);
    } else if (a.target_type === 'comment') {
      const s = commentState.get(a.target_id);
      stillActive = (a.action === 'collapse' && s?.collapsed_at != null)
                 || (a.action === 'remove'   && s?.removed_at   != null);
    } else if (a.target_type === 'handle' && a.action === 'ban') {
      stillActive = banSet.has(`${a.sub_name}\0${a.target_id}`);
    }
    if (stillActive) out.set(a.id, REVOKE_MAP[a.action]);
  }
  return out;
}

function renderModlogAudit(res, { currentHandle, db, modSubs, scopedSubs, filters, modHandle, isMod = false }) {
  const since = filters.date === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : null;
  const actionFilter = MODLOG_TYPES[filters.type] ?? null;
  const queryOpts = {
    since: since ?? undefined,
    actions: actionFilter ?? undefined,
    modHandle: modHandle ?? undefined,
    targetHandle: filters.user ?? undefined,
  };

  const offset = (filters.page - 1) * MODLOG_PAGE_SIZE;
  const total = countModActionsAcrossSubs(db, scopedSubs, queryOpts);
  const totalPages = Math.max(1, Math.ceil(total / MODLOG_PAGE_SIZE));
  const actions = listModActionsAcrossSubs(db, scopedSubs, {
    ...queryOpts, limit: MODLOG_PAGE_SIZE, offset,
  });

  const { commentToPost, targetAuthor } = batchTargetLookups(db, actions);
  const revokeMap = buildRevokeMap(db, actions, currentHandle);
  const modHandles = [...new Set(actions.map((a) => a.mod_handle).filter((h) => h != null))];
  const userHandles = [...new Set([
    ...actions.filter((a) => a.target_type === 'handle').map((a) => a.target_id),
    ...targetAuthor.values(),
  ])];
  const pseudonyms = pseudonymsByHandle(db, [...modHandles, ...userHandles]);
  const targetCell = (a) => {
    if (a.target_type === 'post') {
      return html`<a href="/sub/${a.sub_name}/post/${a.target_id}">post ${a.target_id.slice(0, 12)}</a>`;
    }
    if (a.target_type === 'comment') {
      const postId = commentToPost.get(a.target_id);
      return postId
        ? html`<a href="/sub/${a.sub_name}/post/${postId}#comment-${a.target_id}">comment ${a.target_id.slice(0, 12)}</a>`
        : html`<span class="muted">comment ${a.target_id.slice(0, 12)}</span>`;
    }
    if (a.target_type === 'handle') {
      // Ban target: render the user pseudonym as the target so the
      // 'target' column reads naturally for ban rows.
      return html`<span class="muted">${pseudonyms.get(a.target_id) ?? a.target_id.slice(0, 8)}</span>`;
    }
    return html`<span class="muted">${a.target_type} ${a.target_id.slice(0, 12)}</span>`;
  };

  // Click-to-filter toggle for mod / user columns. The label is the
  // affordance — clicking it the second time (when warm) drops the
  // filter. Same pattern as the subs strip (commit 978c85a).
  const filterToggle = (key, value, label, currentValue) => {
    const isActive = currentValue === value;
    const next = isActive
      ? { ...filters, [key]: null, page: null }
      : { ...filters, [key]: value, page: null };
    const cls = isActive ? 'filter-toggle filter-toggle-active' : 'filter-toggle';
    return html`<a class="${cls}" href="${modlogHref(next)}">${label}</a>`;
  };
  const modCell = (a) => {
    if (a.mod_handle === SYSTEM_HANDLE) {
      return filterToggle('mod', 'system', html`<em>system</em>`, filters.mod);
    }
    // Auto-uncollapse-community rows store mod_handle = NULL — the
    // event isn't a moderator decision, it's the community threshold
    // firing. Surface that distinctly so a viewer doesn't read the
    // empty cell as a missing mod.
    if (a.mod_handle == null) {
      return html`<em class="muted">community</em>`;
    }
    const label = pseudonyms.get(a.mod_handle) ?? a.mod_handle.slice(0, 8);
    return filterToggle('mod', a.mod_handle, label, filters.mod);
  };
  const userCell = (a) => {
    const handle = a.target_type === 'handle' ? a.target_id : targetAuthor.get(a.target_id);
    if (!handle) return html`<span class="muted">—</span>`;
    const label = pseudonyms.get(handle) ?? handle.slice(0, 8);
    return filterToggle('user', handle, label, filters.user);
  };

  const pageHref = (n) => modlogHref({ ...filters, page: n > 1 ? n : null });
  const pager = totalPages > 1
    ? html`<nav class="pager muted">
        ${filters.page > 1 ? html`<a href="${pageHref(filters.page - 1)}">← previous</a>` : html`<span class="pager-disabled">← previous</span>`}
        ${filters.page < totalPages ? html`<a href="${pageHref(filters.page + 1)}">more →</a>` : html`<span class="pager-disabled">end</span>`}
      </nav>`
    : html`<p class="muted">${total} action${total === 1 ? '' : 's'}.</p>`;

  const revokeReturn = modlogHref(filters);
  const revokeCell = (a) => {
    const inverse = revokeMap.get(a.id);
    if (!inverse) return html``;
    return html`<form method="POST" action="/sub/${a.sub_name}/mod" class="modlog-revoke">
      <input type="hidden" name="action" value="${inverse}">
      <input type="hidden" name="target_type" value="${a.target_type}">
      <input type="hidden" name="target_id" value="${a.target_id}">
      <input type="hidden" name="return_to" value="${revokeReturn}">
      <button class="action-link" title="undo this action">revoke</button>
    </form>`;
  };
  const rowsView = actions.length === 0
    ? html`<p class="muted">no mod actions match.</p>`
    : html`<table class="modlog">
        <thead><tr><th>sub</th><th>when</th><th>mod</th><th>user</th><th>action</th><th>target</th><th>reason</th><th></th></tr></thead>
        <tbody>${actions.map((a) => html`<tr>
          <td><a href="/sub/${a.sub_name}/modlog">${a.sub_name}</a></td>
          <td class="muted">${relativeTime(a.created_at)}</td>
          <td>${modCell(a)}</td>
          <td>${userCell(a)}</td>
          <td><span class="mod-action mod-action-${a.action}">${MOD_ACTION_LABELS[a.action] ?? a.action}</span></td>
          <td>${targetCell(a)}</td>
          <td class="muted">${a.reason ?? ''}</td>
          <td>${revokeCell(a)}</td>
        </tr>`)}</tbody>
      </table>`;

  const subControl = subFilterControl(modSubs, filters);

  send(res, 200, pageView({
    db, currentHandle,
    title: 'modlog',
    description: `every moderation action on ${branding.forumName}, public and audited.`,
    canonical: `${siteMeta.baseUrl}/modlog`,
  }, html`
    <p><a href="/">← home</a> · my modlog</p>
    <h2>// my modlog</h2>
    ${modlogModeBar(filters)}
    ${modlogFilterBar(filters, currentHandle, subControl.inline, isMod)}
    ${subControl.strip ?? ''}
    ${modlogActiveSummary(filters, pseudonyms, modHandle)}
    ${rowsView}
    ${pager}
  `));
}

function renderModlogOpen(res, { currentHandle, db, postsDir, modSubs, scopedSubs, filters }) {
  // Open mode = pending flags grouped by target. Each row is a native
  // <details> that expands inline to show flag breakdown + an action
  // form (uphold soft, uphold hard with reason, dismiss). Resolution
  // POSTs to /modlog/resolve which both records the mod_action and
  // closes out the flags in one transaction. Pagination is in-memory
  // for now (the cross-sub query returns all pending; a busy instance
  // will hit thousands of rows here someday — revisit when it bites).
  const pending = pendingFlagsAcrossSubs(db, scopedSubs);
  const since = filters.date === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : null;
  const filtered = pending.filter((p) => {
    if (since != null && p.last_flagged_at <= since) return false;
    if (filters.user && p.author_handle !== filters.user) return false;
    return true;
  });

  const offset = (filters.page - 1) * MODLOG_PAGE_SIZE;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / MODLOG_PAGE_SIZE));
  const pageRows = filtered.slice(offset, offset + MODLOG_PAGE_SIZE);

  const breakdowns = flagBreakdownsForTargets(db, pageRows);
  const allFlaggers = new Set();
  for (const list of breakdowns.values()) {
    for (const f of list) allFlaggers.add(f.flagger_handle);
  }
  const userHandles = [
    ...new Set(pageRows.map((p) => p.author_handle).filter((h) => h != null)),
    ...allFlaggers,
  ];
  if (filters.user) userHandles.push(filters.user);
  const pseudonyms = pseudonymsByHandle(db, userHandles);

  // Batch-load target bodies so the expansion can show the post or
  // comment in-line — no navigate-away. Posts: re-use getPostPreview
  // (markdown rendered, ~600 chars, truncated) so the body is XSS-safe
  // through the same allow-list pipeline as a post page. Comments:
  // body column directly, escaped, with newlines preserved.
  const postIds = [...new Set(pageRows.filter((p) => p.target_type === 'post').map((p) => p.target_id))];
  const commentIds = [...new Set(pageRows.filter((p) => p.target_type === 'comment').map((p) => p.target_id))];
  const postRows = new Map();
  const commentBodies = new Map();
  if (postIds.length > 0) {
    const ph = postIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id, file_path, title FROM posts WHERE id IN (${ph})`).all(...postIds)) {
      postRows.set(r.id, r);
    }
  }
  if (commentIds.length > 0) {
    const ph = commentIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id, body, post_id FROM comments WHERE id IN (${ph})`).all(...commentIds)) {
      commentBodies.set(r.id, r);
    }
  }
  const bodyExcerpt = (p) => {
    if (p.target_type === 'post') {
      const row = postRows.get(p.target_id);
      if (!row) return html`<p class="muted">[post body unavailable]</p>`;
      const preview = getPostPreview(row, postsDir, { maxChars: 600 });
      return html`<p class="muted"><strong>${row.title}</strong></p>${raw(preview.html)}`;
    }
    if (p.target_type === 'comment') {
      const row = commentBodies.get(p.target_id);
      if (!row) return html`<p class="muted">[comment body unavailable]</p>`;
      return html`<blockquote class="modlog-body-excerpt">${row.body}</blockquote>`;
    }
    return html``;
  };

  const filterToggle = (key, value, label, currentValue) => {
    const isActive = currentValue === value;
    const next = isActive
      ? { ...filters, [key]: null, page: null }
      : { ...filters, [key]: value, page: null };
    const cls = isActive ? 'filter-toggle filter-toggle-active' : 'filter-toggle';
    return html`<a class="${cls}" href="${modlogHref(next)}">${label}</a>`;
  };
  const userCell = (p) => {
    if (!p.author_handle) return html`<span class="muted">—</span>`;
    const label = pseudonyms.get(p.author_handle) ?? p.author_handle.slice(0, 8);
    return filterToggle('user', p.author_handle, label, filters.user);
  };
  const targetLink = (p) => {
    if (p.target_type === 'post') {
      return html`<a href="/sub/${p.sub_name}/post/${p.target_id}">post ${p.target_id.slice(0, 12)}</a>`;
    }
    if (p.target_type === 'comment') {
      // Comment → parent post lookup is one row; do it inline (n=1 per
      // expanded row, fine for a 50/page surface).
      const row = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(p.target_id);
      return row
        ? html`<a href="/sub/${p.sub_name}/post/${row.post_id}#comment-${p.target_id}">comment ${p.target_id.slice(0, 12)}</a>`
        : html`<span class="muted">comment ${p.target_id.slice(0, 12)}</span>`;
    }
    return html`<span class="muted">${p.target_type} ${p.target_id.slice(0, 12)}</span>`;
  };

  const breakdownLine = (key) => {
    const flags = breakdowns.get(key) ?? [];
    if (flags.length === 0) return html`<span class="muted">no flag detail</span>`;
    const counts = new Map();
    for (const f of flags) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    const cats = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => `${cat} (${n})`)
      .join(', ');
    const flaggers = [...new Set(flags.map((f) => f.flagger_handle))]
      .map((h) => pseudonyms.get(h) ?? h.slice(0, 8))
      .join(', ');
    return html`<span class="muted">flagged for: ${cats} · by ${flaggers}</span>`;
  };

  const pageHref = (n) => modlogHref({ ...filters, page: n > 1 ? n : null });
  const pager = totalPages > 1
    ? html`<nav class="pager muted">
        ${filters.page > 1 ? html`<a href="${pageHref(filters.page - 1)}">← previous</a>` : html`<span class="pager-disabled">← previous</span>`}
        ${filters.page < totalPages ? html`<a href="${pageHref(filters.page + 1)}">more →</a>` : html`<span class="pager-disabled">end</span>`}
      </nav>`
    : html`<p class="muted">${total} pending.</p>`;

  // Open-mode rows are vertical <details> blocks rather than a table —
  // the entire summary line is the click target so the expand affordance
  // is the row itself, not a tiny "decide" cell. Each summary lays out
  // sub · when · user · target · pending count, then expands into the
  // flag breakdown + decision form. Native <details>; no JS.
  const rowsView = pageRows.length === 0
    ? html`<p class="muted">no pending flags.</p>`
    : html`<div class="modlog-open-list">${pageRows.map((p) => {
        const key = `${p.target_type}:${p.target_id}`;
        const returnTo = modlogHref({ ...filters });
        return html`<details class="modlog-open-row">
          <summary>
            <span class="open-row-sub"><a href="/sub/${p.sub_name}/modlog">${p.sub_name}</a></span>
            <span class="open-row-when muted">${relativeTime(p.last_flagged_at)}</span>
            <span class="open-row-user">${userCell(p)}</span>
            <span class="open-row-target">${targetLink(p)}</span>
            <span class="open-row-count"><span class="event-count">${p.pending}× flags</span></span>
            <span class="open-row-chevron muted">▾</span>
          </summary>
          <div class="modlog-resolve-body">
            <div class="modlog-body-wrap">${bodyExcerpt(p)}</div>
            <p>${breakdownLine(key)}</p>
            <form method="post" action="/modlog/resolve" class="modlog-resolve-form">
              <input type="hidden" name="target_type" value="${p.target_type}">
              <input type="hidden" name="target_id" value="${p.target_id}">
              <input type="hidden" name="sub_name" value="${p.sub_name}">
              <input type="hidden" name="return_to" value="${returnTo}">
              <label>reason (required for hard removal):
                <input type="text" name="reason" placeholder="why?" maxlength="200">
              </label>
              <div class="modlog-resolve-buttons">
                <button type="submit" name="decision" value="uphold-soft">soft remove</button>
                <button type="submit" name="decision" value="uphold-hard" class="warn">hard remove</button>
                <button type="submit" name="decision" value="dismiss">dismiss flags</button>
              </div>
            </form>
          </div>
        </details>`;
      })}</div>`;

  const subControl = subFilterControl(modSubs, filters);

  send(res, 200, pageView({
    db, currentHandle,
    title: 'modlog',
    description: `every moderation action on ${branding.forumName}, public and audited.`,
    canonical: `${siteMeta.baseUrl}/modlog`,
  }, html`
    <p><a href="/">← home</a> · my modlog</p>
    <h2>// my modlog</h2>
    ${modlogModeBar(filters)}
    ${modlogFilterBar(filters, currentHandle, subControl.inline, true)}
    ${subControl.strip ?? ''}
    ${modlogActiveSummary(filters, pseudonyms, null)}
    <p class="muted">user-flagged content awaiting your decision. expand a row to see who flagged it and why, then rule.</p>
    ${rowsView}
    ${pager}
  `));
}

function renderModlogInbox(res, { currentHandle, db, modSubs, scopedSubs, filters, modHandle }) {
  // Mirrors renderModlogAudit but queries the deduped inbox view and
  // adds an event-count badge per row. Will share more code with audit
  // once step 4 (open mode) lands and row-expansion forces a refactor.
  const since = filters.date === '24h' ? Date.now() - 24 * 60 * 60 * 1000 : null;
  const actionFilter = MODLOG_TYPES[filters.type] ?? null;
  const queryOpts = {
    since: since ?? undefined,
    actions: actionFilter ?? undefined,
    modHandle: modHandle ?? undefined,
    targetHandle: filters.user ?? undefined,
  };

  const offset = (filters.page - 1) * MODLOG_PAGE_SIZE;
  const total = countInboxAcrossSubs(db, scopedSubs, queryOpts);
  const totalPages = Math.max(1, Math.ceil(total / MODLOG_PAGE_SIZE));
  const actions = listInboxAcrossSubs(db, scopedSubs, {
    ...queryOpts, limit: MODLOG_PAGE_SIZE, offset,
  });

  const { commentToPost, targetAuthor } = batchTargetLookups(db, actions);
  const modHandles = [...new Set(actions.map((a) => a.mod_handle).filter((h) => h != null))];
  const userHandles = [...new Set([
    ...actions.filter((a) => a.target_type === 'handle').map((a) => a.target_id),
    ...targetAuthor.values(),
  ])];
  const pseudonyms = pseudonymsByHandle(db, [...modHandles, ...userHandles]);

  const targetCell = (a) => {
    if (a.target_type === 'post') {
      return html`<a href="/sub/${a.sub_name}/post/${a.target_id}">post ${a.target_id.slice(0, 12)}</a>`;
    }
    if (a.target_type === 'comment') {
      const postId = commentToPost.get(a.target_id);
      return postId
        ? html`<a href="/sub/${a.sub_name}/post/${postId}#comment-${a.target_id}">comment ${a.target_id.slice(0, 12)}</a>`
        : html`<span class="muted">comment ${a.target_id.slice(0, 12)}</span>`;
    }
    if (a.target_type === 'handle') {
      return html`<span class="muted">${pseudonyms.get(a.target_id) ?? a.target_id.slice(0, 8)}</span>`;
    }
    return html`<span class="muted">${a.target_type} ${a.target_id.slice(0, 12)}</span>`;
  };

  const filterToggle = (key, value, label, currentValue) => {
    const isActive = currentValue === value;
    const next = isActive
      ? { ...filters, [key]: null, page: null }
      : { ...filters, [key]: value, page: null };
    const cls = isActive ? 'filter-toggle filter-toggle-active' : 'filter-toggle';
    return html`<a class="${cls}" href="${modlogHref(next)}">${label}</a>`;
  };
  const modCell = (a) => {
    if (a.mod_handle === SYSTEM_HANDLE) {
      return filterToggle('mod', 'system', html`<em>system</em>`, filters.mod);
    }
    // Auto-uncollapse-community rows store mod_handle = NULL — the
    // event isn't a moderator decision, it's the community threshold
    // firing. Surface that distinctly so a viewer doesn't read the
    // empty cell as a missing mod.
    if (a.mod_handle == null) {
      return html`<em class="muted">community</em>`;
    }
    const label = pseudonyms.get(a.mod_handle) ?? a.mod_handle.slice(0, 8);
    return filterToggle('mod', a.mod_handle, label, filters.mod);
  };
  const userCell = (a) => {
    const handle = a.target_type === 'handle' ? a.target_id : targetAuthor.get(a.target_id);
    if (!handle) return html`<span class="muted">—</span>`;
    const label = pseudonyms.get(handle) ?? handle.slice(0, 8);
    return filterToggle('user', handle, label, filters.user);
  };

  const pageHref = (n) => modlogHref({ ...filters, page: n > 1 ? n : null });
  const pager = totalPages > 1
    ? html`<nav class="pager muted">
        ${filters.page > 1 ? html`<a href="${pageHref(filters.page - 1)}">← previous</a>` : html`<span class="pager-disabled">← previous</span>`}
        ${filters.page < totalPages ? html`<a href="${pageHref(filters.page + 1)}">more →</a>` : html`<span class="pager-disabled">end</span>`}
      </nav>`
    : html`<p class="muted">${total} target${total === 1 ? '' : 's'}.</p>`;

  const rowsView = actions.length === 0
    ? html`<p class="muted">no targets match.</p>`
    : html`<table class="modlog">
        <thead><tr><th>sub</th><th>last event</th><th>mod</th><th>user</th><th>action</th><th>target</th><th>events</th><th>reason</th></tr></thead>
        <tbody>${actions.map((a) => html`<tr>
          <td><a href="/sub/${a.sub_name}/modlog">${a.sub_name}</a></td>
          <td class="muted">${relativeTime(a.created_at)}</td>
          <td>${modCell(a)}</td>
          <td>${userCell(a)}</td>
          <td><span class="mod-action mod-action-${a.action}">${MOD_ACTION_LABELS[a.action] ?? a.action}</span></td>
          <td>${targetCell(a)}</td>
          <td class="muted">${a.event_count > 1 ? html`<span class="event-count">${a.event_count}×</span>` : ''}</td>
          <td class="muted">${a.reason ?? ''}</td>
        </tr>`)}</tbody>
      </table>`;

  const subControl = subFilterControl(modSubs, filters);

  send(res, 200, pageView({
    db, currentHandle,
    title: 'modlog',
    description: `every moderation action on ${branding.forumName}, public and audited.`,
    canonical: `${siteMeta.baseUrl}/modlog`,
  }, html`
    <p><a href="/">← home</a> · my modlog</p>
    <h2>// my modlog</h2>
    ${modlogModeBar(filters)}
    ${modlogFilterBar(filters, currentHandle, subControl.inline, true)}
    ${subControl.strip ?? ''}
    ${modlogActiveSummary(filters, pseudonyms, modHandle)}
    <p class="muted">deduped — one row per affected user or piece of content. click ${actions.length === 0 ? 'audit' : 'a row'} for the per-target history (coming with row expansion in next step).</p>
    ${rowsView}
    ${pager}
  `));
}

// Sub filter rendering. Two layouts share one entry point:
//
//  - ≤ MODLOG_SUB_CHIP_LIMIT subs → returns { strip } : the chip strip
//    renders on its own line below the filter bar (current behavior).
//    Chips read better at a glance for small instances.
//
//  - > MODLOG_SUB_CHIP_LIMIT subs → returns { inline } : a labelled
//    <select> form rendered INSIDE the filter bar (next to date / type /
//    my-decisions chips). The chip row would wrap into a wall of names
//    above the limit, so collapse to a dropdown. Default option "all"
//    (value="") drops the ?sub= param. Hidden inputs preserve the other
//    active filters when the form GETs back to /modlog. JS-on path
//    auto-submits on change; JS-off path uses the explicit filter button.
const MODLOG_SUB_CHIP_LIMIT = 15;

function subFilterControl(modSubs, filters) {
  if (modSubs.length === 0) return { inline: null, strip: null };
  if (modSubs.length <= MODLOG_SUB_CHIP_LIMIT) {
    const strip = html`<p class="mod-subs muted">${modSubs.map((s, i) => {
      const isActive = filters.sub === s;
      const href = modlogHref({ ...filters, sub: isActive ? null : s, page: null });
      const cls = isActive ? 'sub-toggle sub-toggle-active' : 'sub-toggle';
      return html`${i > 0 ? raw(' · ') : raw('')}<a class="${cls}" href="${href}">${s}</a>`;
    })}</p>`;
    return { inline: null, strip };
  }
  const passthroughKeys = ['mode', 'date', 'type', 'mod', 'user'];
  const hidden = passthroughKeys
    .filter((k) => filters[k] != null && filters[k] !== '')
    .map((k) => html`<input type="hidden" name="${k}" value="${filters[k]}">`);
  const inline = html`<form class="mod-subs-form" method="GET" action="/modlog">
    ${hidden}
    <label>sub:
      <select name="sub" class="mod-subs-select" onchange="this.form.submit()">
        <option value=""${filters.sub ? raw('') : raw(' selected')}>all (${modSubs.length})</option>
        ${modSubs.map((s) => html`<option value="${s}"${filters.sub === s ? raw(' selected') : raw('')}>${s}</option>`)}
      </select>
    </label>
    <button class="filter-btn" type="submit">filter</button>
  </form>`;
  return { inline, strip: null };
}

function modlogModeBar(filters) {
  // Three-way mode toggle. Clicking the active mode is a no-op (kept
  // visually distinct). Switching mode resets pagination.
  const btn = (mode, label) => {
    const isActive = filters.mode === mode;
    const cls = isActive ? 'mode-btn mode-btn-active' : 'mode-btn';
    const href = modlogHref({ ...filters, mode, page: null });
    return html`<a class="${cls}" href="${href}">${label}</a>`;
  };
  return html`<p class="modlog-modes">
    ${btn('open', 'open')} ${btn('inbox', 'inbox')} ${btn('audit', 'audit')}
  </p>`;
}

function modlogFilterBar(filters, currentHandle, inlineSubControl = null, isMod = false) {
  const dateBtn = (val, label) => {
    const isActive = filters.date === val;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${modlogHref({ ...filters, date: val === 'all' ? null : val, page: null })}">${label}</a>`;
  };
  const typeBtn = (val, label) => {
    const isActive = filters.type === val;
    const cls = isActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    return html`<a class="${cls}" href="${modlogHref({ ...filters, type: val === 'all' ? null : val, page: null })}">${label}</a>`;
  };
  // "my decisions" is mod-only — non-mods (logged-out or logged-in
  // without any sub) have no actions to filter to. Render disabled
  // rather than letting them click into an always-empty result.
  let myDecisions;
  if (isMod) {
    const meIsActive = filters.mod === 'me' || filters.mod === currentHandle;
    const meHref = modlogHref({ ...filters, mod: meIsActive ? null : 'me', page: null });
    const meCls = meIsActive ? 'filter-btn filter-btn-active' : 'filter-btn';
    myDecisions = html`<a class="${meCls}" href="${meHref}" title="filter to your own decisions">my decisions</a>`;
  } else {
    myDecisions = html`<span class="filter-btn filter-btn-disabled" title="mod-only: you have no actions to filter">my decisions</span>`;
  }
  // <div> (not <p>) so the inline sub-filter <form> is valid HTML — a
  // <form> inside <p> auto-closes the paragraph at parse time.
  return html`<div class="modlog-filters muted">
    ${inlineSubControl ? html`${inlineSubControl}<span class="filter-sep">·</span>` : html``}
    ${dateBtn('24h', 'new (24h)')} ${dateBtn('all', 'all-time')}
    <span class="filter-sep">·</span>
    ${typeBtn('flagged', 'flagged')} ${typeBtn('banned', 'banned')} ${typeBtn('removed', 'removed')} ${typeBtn('all', 'all')}
    <span class="filter-sep">·</span>
    ${myDecisions}
  </div>`;
}

function modlogActiveSummary(filters, pseudonyms, resolvedModHandle) {
  // Reads back the active filters in plain English under the bar. Only
  // shown when something is scoped — silent when wide-open.
  const parts = [];
  if (filters.sub) parts.push(`sub=${filters.sub}`);
  if (filters.mod) {
    if (filters.mod === 'system') {
      parts.push('mod=system');
    } else if (filters.mod === 'me') {
      parts.push('mod=me');
    } else {
      const label = pseudonyms.get(resolvedModHandle) ?? resolvedModHandle?.slice(0, 8) ?? filters.mod;
      parts.push(`mod=${label}`);
    }
  }
  if (filters.user) {
    const label = pseudonyms.get(filters.user) ?? filters.user.slice(0, 8);
    parts.push(`user=${label}`);
  }
  if (filters.date === '24h') parts.push('last 24h');
  if (filters.type !== 'all') parts.push(`type=${filters.type}`);
  if (parts.length === 0) return html``;
  return html`<p class="muted modlog-summary">showing: ${parts.join(', ')} · <a href="/modlog">clear all</a></p>`;
}

const SUB_NAME_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})$/;
const SUB_EDIT_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/edit$/;
const SUB_MOD_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/mod$/;
const SUB_MODLOG_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/modlog$/;
const SUB_POST_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})$/;
const SUB_POST_EDIT_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})\/edit$/;
const SUB_POST_COMMENT_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})\/comment$/;
const SUB_POST_COMMENT_EDIT_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})\/comment\/([0-9a-f]{16})\/edit$/;

// Login + logout wrappers around knowless. Knowless's own /login renders
// its built-in "thanks, link is on the way" page which doesn't match
// plato's look (and recently surfaced an empty <strong></strong> when
// the email field was missing). The wrappers below reuse plato's check-
// your-email layout for login, and redirect logout to / so the user
// lands on a useful page instead of a blank 200.
function renderLogin(req, res, { db, auth }, searchParams) {
  // Knowless ships its own bare /login form, but it has no plato chrome —
  // header, footer, branding, all missing. Land users here whenever they
  // navigate to /login deliberately or land here from a sham-token
  // failureRedirect (anti-enumeration: every failure mode redirects to
  // loginPath). Same form fields as the popover; the `next` param is
  // forwarded back through return_to so post-login lands the user where
  // they were trying to go.
  const next = searchParams?.get('next') ?? '';
  const handle = auth.handleFromRequest(req);
  if (handle) {
    return send(res, 200, pageView({ db, currentHandle: handle, title: 'already logged in' }, html`
      <p class="muted">you're already signed in. <a href="/">go home</a>.</p>
    `));
  }
  return send(res, 200, pageView({ db, currentHandle: null, title: 'log in' }, html`
    <p class="muted">enter your email — we'll send a magic link. no password, no PII stored.</p>
    <form method="POST" action="/login" class="login-form-page">
      <input name="email" type="email" placeholder="your email" required autofocus>
      <input type="hidden" name="return_to" value="${next}">
      <button>send link</button>
    </form>
    <p class="muted">same email always becomes the same pseudonym + avatar on this instance — that's how identity works here.</p>
  `));
}

async function handleLogin(req, res, { db, auth, baseUrl, disposableDomains }) {
  const body = await readBody(req);
  const form = parseForm(body);
  const { email, return_to: returnTo } = form;
  if (!email) {
    return send(res, 400, quickPage(req, { db, auth }, 'login', html`<p class="muted">email required. <a href="/">back</a></p>`));
  }
  if (isDisposableEmail(email, disposableDomains)) {
    return send(
      res,
      400,
      quickPage(req, { db, auth }, 'login rejected', html`<p class="muted">disposable email domains aren't accepted. <a href="/">back</a></p>`)
    );
  }
  const landing = safeLocalRedirect(returnTo, '/');
  await auth.startLogin({
    email,
    nextUrl: `${baseUrl}${landing}`,
    sourceIp: req.socket?.remoteAddress,
  });
  send(
    res,
    200,
    pageView({ db: null, currentHandle: null, title: html`${branding.forumName} · check your email`, subtitle: branding.tagline }, html`
      <p>We sent a magic link to <code>${email}</code>. Click it within 15 minutes to sign in.</p>
      <p class="muted">No account needed. The same email always becomes the same pseudonym + avatar on this instance — that's how identity works here. We never store the email itself, only a one-way hash of it.</p>
      <p class="muted">If you don't get the email, <a href="/">try again</a>.</p>
    `)
  );
}

async function handleLogout(req, res, { db, auth }) {
  // Capture knowless's clearing Set-Cookie via a thin response proxy,
  // then drop a 302 to / so the user lands somewhere useful. Without
  // this, knowless's logout returns a 200 with empty body — looks like
  // a broken page even though it's working.
  let setCookieValue = null;
  let blocked403 = false;
  const proxy = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === 'set-cookie') setCookieValue = value;
    },
    end() {},
    set statusCode(v) {
      // Knowless returns 403 if the Origin/Referer check fails. Surface
      // that to the caller; otherwise swallow the 200 it would set.
      if (v === 403) blocked403 = true;
    },
    get statusCode() { return 200; },
  };
  await auth.logout(req, proxy);
  if (blocked403) {
    return send(res, 403, quickPage(req, { db, auth }, 'logout failed', html`<p class="muted">request blocked (origin check). <a href="/">back</a></p>`));
  }
  if (setCookieValue) res.setHeader('Set-Cookie', setCookieValue);
  redirect(res, '/');
}


// Display-only knob (no security floor). Bare auto-linked URLs longer than
// this many characters render with a `…` ellipsis. Operators set it via
// config.json:urlDisplayMax. Bounds keep the value sane: too small breaks
// even short URLs; too large defeats the purpose.
function resolveUrlDisplayMax(override) {
  if (override === undefined || override === null) return 30;
  if (!Number.isInteger(override)) {
    throw new Error('urlDisplayMax must be an integer');
  }
  if (override < 10 || override > 200) {
    throw new Error('urlDisplayMax must be between 10 and 200');
  }
  return override;
}

// Operator-tunable feed page size. Default 50; bounded [10, 200]. Smaller
// pages = more "pause" beats but more click friction; larger pages strain
// previews + buildLinkBadges per render. Throws at boot on bad input.
function resolveFeedPageSize(override) {
  if (override === undefined || override === null) return 50;
  if (!Number.isInteger(override)) {
    throw new Error('feedPageSize must be an integer');
  }
  if (override < 10 || override > 200) {
    throw new Error('feedPageSize must be between 10 and 200');
  }
  return override;
}

export function createApp({ db, auth, disposableDomains, postsDir, baseUrl, rateLimits = {}, spamPatternsFile = null, linkCaps = {}, urlhausCacheFile = null, branding: brandingOverrides = {}, urlDisplayMax = undefined, feedPageSize = undefined }) {
  // Operator-replaceable branding: forum name (top wordmark), top
  // tagline (subtitle under the wordmark on the home page), and
  // hostedBy (the @-handle shown in the footer's
  // "a plato instance hosted by ..." line). When hostedBy is unset,
  // the footer falls back to "@<forumName>". The logo (3-blue-dot
  // mark), the literal "plato" attribution in the footer, and the
  // project quote are LOCKED across forks.
  // See docs/01-product/build-plan.md §Locked.
  branding.forumName     = (brandingOverrides.forumName ?? 'plato').trim() || 'plato';
  branding.tagline       = (brandingOverrides.tagline   ?? 'a forum that lives at one URL').trim();
  branding.hostedBy      = (brandingOverrides.hostedBy  ?? '').trim() || null;
  branding.colors        = resolveBrandingColors(brandingOverrides.colors ?? {});
  branding.feedbackEmail   = resolveBrandingFeedbackEmail(brandingOverrides.feedbackEmail);
  branding.rules           = resolveBrandingRules(brandingOverrides.rules);
  branding.metaDescription = resolveBrandingMetaDescription(brandingOverrides.metaDescription);
  // Strip trailing slash so canonical concatenation produces a single
  // slash between origin and path (`https://x.test` + `/about`).
  siteMeta.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  setUrlDisplayMax(resolveUrlDisplayMax(urlDisplayMax));
  FEED_PAGE_SIZE = resolveFeedPageSize(feedPageSize);
  // Resolve operator overrides against the floor at boot. Bad config
  // throws here, so the operator sees the error before serving any
  // request rather than at the moment a user happens to trip a check.
  const rateLimitConfig = resolveRateLimitConfig(rateLimits);
  const linkCapConfig = resolveLinkCapConfig(linkCaps);
  // Spam patterns: load once at boot. File path is operator-supplied;
  // when missing or empty, the matcher returns no matches (a no-op).
  const spamPatterns = loadSpamPatterns(spamPatternsFile);
  // URLhaus blocklist host set: pulled hourly by bin/refresh-urlhaus.js
  // and read fresh at app boot. Restart picks up new entries; an empty
  // cache means the matcher is a no-op (safe default for fresh installs).
  const urlhausHosts = loadUrlhausCache(urlhausCacheFile);
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, baseUrl);
      const path = url.pathname;
      const method = req.method;

      if (await applyStaticRoute(req, res)) return;

      if (path === '/robots.txt' && method === 'GET') return renderRobots(res);
      if (path === '/sitemap.xml' && method === 'GET') return renderSitemap(res, { db });
      if (path === '/login' && method === 'GET') return renderLogin(req, res, { db, auth }, url.searchParams);
      if (path === '/login' && method === 'POST') return handleLogin(req, res, { db, auth, baseUrl, disposableDomains });
      if (path === '/auth/callback') return auth.callback(req, res);
      if (path === '/verify') return auth.verify(req, res);
      if (path === '/logout' && method === 'POST') return handleLogout(req, res, { db, auth });

      if (path === '/' && method === 'GET') return renderHome(req, res, { db, auth, postsDir }, url.searchParams);
      if (path === '/about' && method === 'GET') return renderAbout(req, res, { db, auth });
      if (path === '/subs' && method === 'GET') return renderCommunities(req, res, { db, auth }, url.searchParams);
      if (path === '/draft' && method === 'POST') {
        return handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir, rateLimitConfig, spamPatterns, linkCapConfig, urlhausHosts });
      }
      if (path === '/vote' && method === 'POST') return handleVote(req, res, { db, auth });
      if (path === '/flag' && method === 'POST') return handleFlag(req, res, { db, auth });
      if (path === '/sub/create' && method === 'GET') return renderSubCreate(req, res, { db, auth });
      if (path === '/sub/create' && method === 'POST') return handleSubCreate(req, res, { db, auth });

      let m;
      if ((m = path.match(SUB_POST_COMMENT_EDIT_PATH_RE)) && method === 'GET') {
        return renderCommentEditPage(req, res, { db, auth }, m[1], m[2], m[3]);
      }
      if ((m = path.match(SUB_POST_COMMENT_EDIT_PATH_RE)) && method === 'POST') {
        return handleCommentEdit(req, res, { db, auth }, m[1], m[2], m[3]);
      }
      if ((m = path.match(SUB_POST_EDIT_PATH_RE)) && method === 'GET') {
        return renderPostEditPage(req, res, { db, auth, postsDir }, m[1], m[2]);
      }
      if ((m = path.match(SUB_POST_EDIT_PATH_RE)) && method === 'POST') {
        return handlePostEdit(req, res, { db, auth, postsDir }, m[1], m[2]);
      }
      if ((m = path.match(SUB_POST_COMMENT_PATH_RE)) && method === 'POST') {
        return handleAddComment(req, res, { db, auth, rateLimitConfig, spamPatterns, urlhausHosts }, m[1], m[2]);
      }
      if ((m = path.match(SUB_MOD_PATH_RE)) && method === 'POST') {
        return handleModAction(req, res, { db, auth }, m[1]);
      }
      if ((m = path.match(SUB_MODLOG_PATH_RE)) && method === 'GET') {
        return renderModLog(req, res, { db, auth }, m[1], url.searchParams);
      }
      if (path === '/modlog' && method === 'GET') {
        return renderMyModLog(req, res, { db, auth, postsDir }, url.searchParams);
      }
      if (path === '/modlog/resolve' && method === 'POST') {
        return handleModlogResolve(req, res, { db, auth });
      }
      if (path === '/memlog' && method === 'GET') {
        return renderMemlog(req, res, { db, auth }, url.searchParams);
      }
      if (path === '/memlog/mark-read' && method === 'POST') {
        return handleMemlogMarkRead(req, res, { db, auth });
      }
      if ((m = path.match(/^\/memlog\/go\/(\d+)$/)) && method === 'GET') {
        return handleMemlogGo(req, res, { db, auth }, m[1]);
      }
      if ((m = path.match(SUB_POST_PATH_RE)) && method === 'GET') {
        return renderPostPage(req, res, { db, auth, postsDir }, m[1], m[2], url.searchParams.get('sort'));
      }
      if ((m = path.match(SUB_EDIT_PATH_RE)) && method === 'GET') {
        return renderSubEdit(req, res, { db, auth }, m[1]);
      }
      if ((m = path.match(SUB_EDIT_PATH_RE)) && method === 'POST') {
        return handleSubEdit(req, res, { db, auth }, m[1]);
      }
      if ((m = path.match(SUB_NAME_PATH_RE)) && method === 'GET') {
        return renderSubPage(req, res, { db, auth, postsDir }, m[1], url.searchParams.get('sort'), url.searchParams);
      }
      if ((m = path.match(/^\/draft\/([0-9a-f]{16})\/finalize$/)) && method === 'GET') {
        return handleFinalize(req, res, { db, auth, postsDir, rateLimitConfig, spamPatterns, linkCapConfig, urlhausHosts }, m[1]);
      }
      if ((m = path.match(/^\/post\/([0-9a-f]{16})$/)) && method === 'GET') {
        return redirectLegacyPost(req, res, { db, auth }, m[1]);
      }
      if ((m = path.match(/^\/avatar\/([0-9a-f]+)\.svg$/)) && method === 'GET') {
        return renderAvatar(res, m[1]);
      }

      send(res, 404, quickPage(req, { db, auth }, 'not found', html`<p class="muted">not found</p>`));
    } catch (err) {
      console.error(err);
      send(res, 500, '<pre>500</pre>');
    }
  };
}
