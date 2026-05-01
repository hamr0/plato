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
})();
