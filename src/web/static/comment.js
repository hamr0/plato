// Progressive-enhancement comment submit.
//
// Without JS, comment forms POST normally and the server redirects to
// /sub/<name>/post/<id>#comment-<new-id> — the page reloads, anchor scroll
// lands the user on their comment. With JS, we fetch with Accept: JSON,
// the server returns the rendered comment fragment, and we splice it into
// the tree without a page reload. The loading-dots wave (the only
// animation in the app) plays during the round-trip.
//
// PRD §Technical Stack rules out client-side JS in v1; this file is a
// scoped exception alongside vote.js. Keep it under ~80 lines; if it
// grows, reconsider.

(function () {
  if (!window.fetch || !document.addEventListener) return;

  const COMMENT_ACTION_RE = /\/sub\/[^/]+\/post\/[^/]+\/comment$/;
  const PENDING_KEY = 'plato:pendingComment';
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

  function readStash() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.body !== 'string' || typeof obj.postPath !== 'string') return null;
      if (!obj.ts || Date.now() - obj.ts > PENDING_TTL_MS) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return obj;
    } catch (_) { return null; }
  }
  function writeStash(obj) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(obj)); return true; }
    catch (_) { return false; }
  }
  function clearStash() {
    try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
  }

  function loadingMarkSvg() {
    return '<svg class="logo-mark" width="22" height="7" viewBox="0 0 24 8" aria-hidden="true" data-loading><circle cx="3" cy="4" r="3" opacity="0.4"/><circle cx="12" cy="4" r="3" opacity="0.7"/><circle cx="21" cy="4" r="3"/></svg>';
  }

  function htmlToElement(htmlString) {
    const tpl = document.createElement('template');
    tpl.innerHTML = htmlString.trim();
    return tpl.content.firstElementChild;
  }

  function findInsertionPoint(parentId) {
    if (parentId) {
      const parent = document.getElementById('comment-' + parentId);
      if (!parent) return null;
      let replies = parent.querySelector(':scope > .replies');
      if (!replies) {
        replies = document.createElement('div');
        replies.className = 'replies';
        parent.appendChild(replies);
      }
      return { container: replies, mode: 'append' };
    }
    let tree = document.querySelector('.comment-tree');
    if (!tree) {
      // First comment on the post: replace the empty-state paragraph.
      const empty = Array.from(document.querySelectorAll('p.muted'))
        .find((p) => /no comments yet/.test(p.textContent || ''));
      if (empty) {
        tree = document.createElement('div');
        tree.className = 'comment-tree';
        empty.replaceWith(tree);
      } else {
        return null;
      }
    }
    return { container: tree, mode: 'append' };
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute('action') || '';
    if (!COMMENT_ACTION_RE.test(action)) return;

    // Guest composer: stash to localStorage, nudge user to the header
    // login affordance, and never hit the server. The auto-submit on
    // page load (after magic-link confirm) replays the stash via the
    // logged-in path below.
    if (form.dataset.guest === '1') {
      e.preventDefault();
      const textarea = form.querySelector('textarea[name="body"]');
      const body = textarea ? textarea.value.trim() : '';
      if (!body) return;
      const stashed = writeStash({ postPath: location.pathname, body, ts: Date.now() });
      const notice = form.querySelector('.guest-notice');
      if (notice) {
        notice.textContent = stashed
          ? 'saved — sign in above to post it. we’ll submit it for you when you confirm.'
          : 'your browser is blocking storage, so we can’t hold the draft. sign in first, then comment.';
        notice.hidden = false;
      }
      const trigger = document.querySelector('details.login-trigger');
      if (trigger) {
        trigger.open = true;
        const emailInput = trigger.querySelector('input[name="email"]');
        if (emailInput) {
          emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => emailInput.focus(), 250);
        }
      }
      return;
    }

    e.preventDefault();
    const button = form.querySelector('button');
    const originalLabel = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = loadingMarkSvg();
    }

    try {
      const body = new URLSearchParams(new FormData(form));
      const res = await fetch(action, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('comment: HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok || !data.html) throw new Error('comment: malformed response');

      const insertion = findInsertionPoint(data.parentId);
      if (!insertion) throw new Error('comment: no insertion point');
      const node = htmlToElement(data.html);
      if (!node) throw new Error('comment: bad fragment');
      insertion.container.appendChild(node);

      form.reset();

      // Bump the "// comments (N) · sort:" header so the count stays
      // accurate without a reload. The textContent is the only thing the
      // server rendered; we splice the number in place.
      const header = document.getElementById('comments');
      if (header) {
        header.textContent = header.textContent.replace(
          /comments \((\d+)\)/,
          (_, n) => `comments (${parseInt(n, 10) + 1})`
        );
      }
      // Top-level forms (composer + sticky bar) shouldn't toggle closed.
      // Reply forms live inside <details> — collapse them after success.
      const replyDetails = form.closest('details.reply');
      if (replyDetails) replyDetails.removeAttribute('open');

      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief flash highlight so the user sees the new comment land.
      node.classList.add('comment-just-added');
      setTimeout(() => node.classList.remove('comment-just-added'), 1500);
    } catch (err) {
      // Fail safe: hand back to the browser's native submit. Worst case
      // the page reloads to the new comment via the server's redirect.
      if (button) {
        button.disabled = false;
        button.innerHTML = originalLabel;
      }
      form.submit();
      return;
    }

    if (button) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  });

  // Fill the header login form's return_to so the magic-link nextUrl
  // lands the user back on the page they tried to comment from.
  function fillLoginReturnTo() {
    const inputs = document.querySelectorAll('form.login-form input[name="return_to"]');
    inputs.forEach((el) => { el.value = location.pathname + location.search; });
  }

  // Auto-submit a stashed guest comment after the user signs in. We
  // detect "logged in on this post" by finding a comment composer form
  // without data-guest. Replay reuses the existing JSON splice path.
  function maybeReplayStash() {
    const stash = readStash();
    if (!stash) return;
    if (stash.postPath !== location.pathname) return;
    const form = Array.from(document.querySelectorAll('form'))
      .find((f) => COMMENT_ACTION_RE.test(f.getAttribute('action') || '') && f.dataset.guest !== '1');
    if (!form) return;
    const textarea = form.querySelector('textarea[name="body"]');
    if (!textarea) return;
    textarea.value = stash.body;
    clearStash();
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  // Anchor expand-on-jump: when the URL hash names a comment (typical
  // path is /memlog/go/<id> → 302 to /sub/x/post/y#comment-z), open every
  // enclosing <details> so a long-collapsed, score-collapsed, or
  // depth-folded body becomes visible. Without this the anchor scrolls
  // to the right slot but the user sees a collapsed summary.
  function expandToHash() {
    if (!location.hash || location.hash.length < 2) return;
    let target;
    try { target = document.querySelector(location.hash); }
    catch (_) { return; }
    if (!target) return;
    let el = target.parentElement;
    while (el && el !== document.body) {
      if (el.tagName === 'DETAILS' && !el.open) el.open = true;
      el = el.parentElement;
    }
    target.scrollIntoView({ block: 'center' });
    target.classList.add('comment-just-added');
    setTimeout(() => target.classList.remove('comment-just-added'), 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      fillLoginReturnTo();
      maybeReplayStash();
      expandToHash();
    });
  } else {
    fillLoginReturnTo();
    maybeReplayStash();
    expandToHash();
  }
  window.addEventListener('hashchange', expandToHash);
})();
