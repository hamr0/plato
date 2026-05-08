#!/usr/bin/env node
// Curated demo content for the evaluation Docker image.
//
// Runs from bin/docker-entrypoint.sh when PLATO_EVAL_SEED=1 AND the
// `subs` table is empty (no rows). Production deploys never set the
// env var, so this script never executes there. The empty-DB guard
// also means a docker restart with a persistent volume preserves
// whatever the evaluator did — no re-seeding.
//
// What it creates:
//   - 4 personas (alice, bob, carol, dave) with deterministic handles
//     derived from KNOWLESS_SECRET (same mechanism real logins use).
//   - 2 subs: //lobby (alice, sticky note set) + //field-notes (bob,
//     with project / question / writeup flairs).
//   - 12 posts spread across the subs, with realistic-feeling content
//     that demonstrates markdown formatting, links, code blocks.
//   - Comments including 2-deep reply threads.
//   - Vote distribution (some posts at +N, some at +1, one at -1).
//   - One soft-removal so /modlog has substance to show.
//
// Idempotence: the very first SELECT on subs short-circuits if any
// sub exists. Safe to re-run from cron / restart.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { openDb } from '../src/db/index.js';
import { createSub, setSubFlairs, setSubStickyNote } from '../src/content/sub.js';
import { submitDraft, finalizeDraft } from '../src/content/post.js';
import { addComment } from '../src/content/comment.js';
import { castVote } from '../src/content/vote.js';
import { recordAction } from '../src/content/mod.js';
import { recordNotification } from '../src/content/notification.js';
import { subscribe } from '../src/content/subscription.js';
import { pseudonymFor } from '../src/identity/pseudonym.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');
const SECRET = process.env.KNOWLESS_SECRET;
if (!SECRET) {
  console.error('[eval-seed] KNOWLESS_SECRET unset; skipping seed');
  process.exit(0);
}

// Mirror knowless's deriveHandle: HMAC-SHA256(secret, normalize(email)).
// Reproduced inline so the seed has no knowless dep at runtime.
function deriveHandle(email) {
  return createHmac('sha256', SECRET).update(email.trim().toLowerCase()).digest('hex');
}

const db = openDb(DB_PATH);
// Idempotence marker: the seed creates //lobby first, so that's the
// "have we run before?" check. Migrations create a default //general
// sub, which is fine — the seed leaves it untouched.
if (db.prepare('SELECT name FROM subs WHERE name = ?').get('lobby')) {
  console.error('[eval-seed] //lobby exists — skipping (already seeded)');
  process.exit(0);
}

mkdirSync(POSTS_DIR, { recursive: true });

const ALICE = deriveHandle('alice@plato.eval');
const BOB   = deriveHandle('bob@plato.eval');
const CAROL = deriveHandle('carol@plato.eval');
const DAVE  = deriveHandle('dave@plato.eval');
for (const h of [ALICE, BOB, CAROL, DAVE]) pseudonymFor(db, h);

// Age personas so they pass the new-account thresholds (60-day export
// gate, 7-day vote-cap probation, etc.). Without this every avatar
// shows the "new account" hint and feels off in a demo.
db.prepare('UPDATE handles SET first_seen_at = ? WHERE handle IN (?, ?, ?, ?)')
  .run(Date.now() - 90 * 24 * 60 * 60 * 1000, ALICE, BOB, CAROL, DAVE);

createSub(db, {
  name: 'lobby', description: 'general chat — anything goes',
  ownerHandle: ALICE,
});
setSubStickyNote(db, 'lobby',
  'demo instance — yellow strip = eval image. log in as **alice@plato.eval** (mod, populated `/memlog`) to explore, or any email of your own.');

createSub(db, {
  name: 'field-notes',
  description: 'projects in flight, questions, writeups',
  ownerHandle: BOB,
});
setSubFlairs(db, 'field-notes', {
  flairs: [
    { slug: 'project',  label: 'project',  color: '#3b82f6' },
    { slug: 'question', label: 'question', color: '#8b5cf6' },
    { slug: 'writeup',  label: 'writeup',  color: '#10b981' },
  ],
  flairsRequired: false,
});

for (const [h, sub] of [
  [BOB, 'lobby'], [CAROL, 'lobby'], [DAVE, 'lobby'],
  [ALICE, 'field-notes'], [CAROL, 'field-notes'], [DAVE, 'field-notes'],
]) {
  subscribe(db, { handle: h, subName: sub });
}

const POSTS = [
  { sub: 'lobby', author: ALICE, title: 'rules, briefly', flair: null,
    body: 'be civil. attack ideas, not people. mods are accountable — every action is in `/modlog`. if a thread is going off the rails, flag it; three flags from distinct accounts auto-collapse for review.' },
  { sub: 'lobby', author: BOB, title: 'why no algorithmic feed?', flair: null,
    body: 'because every algorithm has goals, and the goals end up not being yours. plato gives you sort + filter + the subs you subscribe to. that\'s it. you decide what surfaces.' },
  { sub: 'lobby', author: CAROL, title: 'archives are signed and dated', flair: null,
    body: 'every export is an Ed25519-signed `.tar.gz`. operators can opt into [OpenTimestamps](https://opentimestamps.org) on top — your archive then has a Bitcoin-anchored proof of when it was sealed. relevant if you ever need to show "this was the state of the conversation at time T".' },
  { sub: 'lobby', author: DAVE, title: 'what makes plato different from lemmy?', flair: null,
    body: 'lemmy bets on federation — many instances, one network. plato bets on **forking** — one instance, total operator + community sovereignty, archives portable to any other plato. different shape, same goal: not-Reddit.' },
  { sub: 'lobby', author: ALICE, title: 'this is the only outbound mail', flair: null,
    body: 'magic-link login. that\'s it. plato will never email you about replies, mod actions, or "things you missed." pull-only feeds via RSS instead — one URL per sub, one per user.' },

  { sub: 'field-notes', author: BOB, title: 'building a wood lathe from scrap', flair: 'project',
    body: 'six weeks in. headstock\'s machined, tailstock printed in PETG (will replace with steel later), motor is a 1hp washing-machine pull. tool rest is the tricky bit — square steel stock + bolts is fine for spindles but it flexes on bowls. anyone done a hardened-rail tool rest on a budget?' },
  { sub: 'field-notes', author: ALICE, title: 'how do you keep notes that survive the next refactor?', flair: 'question',
    body: 'every codebase i\'ve worked in has had a `notes/` directory that drifted into a graveyard of stale README fragments. has anyone landed on a pattern where the notes stay useful three years out, or is it just "delete everything older than 6 months and rewrite"?' },
  { sub: 'field-notes', author: CAROL, title: 'shipped: small CLI for tagging photos', flair: 'writeup',
    body: 'wrote a 200-line Go CLI that reads exif, asks ollama (local) what\'s in the photo, and writes IPTC keywords back. zero cloud calls. ~3s/photo on an M2 air, no GPU.\n\nhappy to share if anyone\'s interested. it\'s ugly but it works.' },
  { sub: 'field-notes', author: DAVE, title: 'mechanical keyboards: am i an idiot for tinkering?', flair: 'question',
    body: 'i bought a kit, soldered it, lubed switches, and the typing experience is... about the same as my $40 logitech. is the difference real and i don\'t notice it, or is the keyboard scene mostly aesthetics?' },
  { sub: 'field-notes', author: BOB, title: 'a 4-week experiment with paper notebooks', flair: 'writeup',
    body: 'put the laptop away during morning planning for 28 days. used a pocket notebook + pen.\n\nwhat surprised me: the friction of re-writing a TODO from yesterday is a useful filter. half the things i\'d been carrying for 3 weeks just... went away when i had to write them again.' },
  { sub: 'field-notes', author: CAROL, title: 'small projects, large rewards', flair: null,
    body: 'every "small weekend project" i\'ve done in the last 2 years has either died at hour 6 or shipped a thing i still use. nothing in between. anyone else have this experience? i think the lesson is just: kill it fast or finish it.' },

  // The post that gets soft-removed below — leave it last so the
  // delete order in the seed is obvious.
  { sub: 'lobby', author: DAVE, title: 'just buy bitcoin', flair: null,
    body: 'this thread is brought to you by the BUY THE DIP fund. dm me for my onlyfans.' },
];

const now = Date.now();
const HOUR = 60 * 60 * 1000;
const postIds = [];
POSTS.forEach((p, i) => {
  const { draftId } = submitDraft(db, { title: p.title, body: p.body, subName: p.sub, flairSlug: p.flair });
  const { postId } = finalizeDraft(db, { draftId, handle: p.author, postsDir: POSTS_DIR });
  // Backdate so they're not all at "0s ago" — mix recent + over-the-week.
  const createdAt = now - (POSTS.length - i) * 4 * HOUR;
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(createdAt, postId);
  postIds.push(postId);
});

const COMMENTS = [
  { post: 0, author: BOB,   body: 'pinning this in my head: "attack ideas, not people". hard rule.' },
  { post: 0, author: CAROL, body: 'the public modlog is the bit that does the work for me — i can see if a mod is trigger-happy.' },
  { post: 1, author: DAVE,  body: 'i\'ll add: every algorithm has a goal *you didn\'t pick*.' },
  { post: 1, author: ALICE, parent: 'last', body: 'right — the optimization target is what people miss. "engagement" ≠ "what i wanted to read."' },
  { post: 5, author: ALICE, body: 'on the tool rest: bolt-down a piece of 1/2" cold-rolled to a square steel block. cheap and stiff enough for 8" bowls.' },
  { post: 5, author: BOB,   parent: 'last', body: 'oh, smart. i was thinking i needed a hardened rail but you\'re right — flexure is the real enemy, not surface hardness.' },
  { post: 6, author: CAROL, body: 'i write a `decisions.md` that\'s append-only. when i hit a fork, i log: choice + alternatives considered + why. doesn\'t replace docs but it survives refactors because it\'s about the *thinking*, not the code.' },
  { post: 7, author: DAVE,  body: 'cool, would read the writeup with code link.' },
];
let lastCommentId = null;
for (const c of COMMENTS) {
  const parentId = c.parent === 'last' ? lastCommentId : null;
  const { commentId } = addComment(db, { postId: postIds[c.post], parentId, handle: c.author, body: c.body });
  lastCommentId = commentId;
}

// Vote distribution: nudge most posts up, downvote the spam post so
// /modlog has a row that aligns with community sentiment. castVote
// auto-creates the handle row, runs the ban check, and rejects self-
// votes; we always vote with a different persona than the author.
const votes = [
  [0, BOB, 'up'], [0, CAROL, 'up'], [0, DAVE, 'up'],
  [1, ALICE, 'up'], [1, CAROL, 'up'], [1, DAVE, 'up'], [1, BOB, 'up'],
  [2, ALICE, 'up'], [2, BOB, 'up'],
  [5, ALICE, 'up'], [5, CAROL, 'up'], [5, DAVE, 'up'], [5, BOB, 'up'],
  [7, ALICE, 'up'], [7, BOB, 'up'], [7, DAVE, 'up'],
  [11, ALICE, 'down'],
];
for (const [postIdx, voter, direction] of votes) {
  castVote(db, { targetType: 'post', targetId: postIds[postIdx], voterHandle: voter, direction });
}

// Mod soft-removal: collapsed_at stamped, body still expandable on
// click. Soft = "the community can overrule via upvotes."
const SPAM_POST = postIds[11];
db.prepare('UPDATE posts SET collapsed_at = ? WHERE id = ?').run(now, SPAM_POST);
recordAction(db, {
  subName: 'lobby', modHandle: ALICE,
  action: 'collapse', targetType: 'post', targetId: SPAM_POST,
  reason: 'low-effort spam',
});

// Mod hard-removal: removed_at stamped, body replaced with stub.
// Hard = community CANNOT auto-overrule (only the mod, via unremove).
// Reason is required at the handler layer; the seed mirrors that.
const HARD_POST_BODY = 'making fast money trading crypto signals — DM me for the channel link, dont miss out!';
const { draftId: hardDraft } = submitDraft(db, {
  title: 'easy 10x — limited slots', body: HARD_POST_BODY, subName: 'lobby',
});
const { postId: HARD_POST } = finalizeDraft(db, { draftId: hardDraft, handle: DAVE, postsDir: POSTS_DIR });
db.prepare('UPDATE posts SET created_at = ?, removed_at = ? WHERE id = ?')
  .run(now - 2 * HOUR, now, HARD_POST);
recordAction(db, {
  subName: 'lobby', modHandle: ALICE,
  action: 'remove', targetType: 'post', targetId: HARD_POST,
  reason: 'targeted scam — DMs claiming financial signals',
});

// Imported sub: //ham-archive demonstrates the [imported] chip on
// the sub link, the imported-banner on the sub page, and the
// imported-author italic on each post. Real imports go through
// `bin/run-import-queue.js`; the seed sets the same columns the
// importer would set.
const IMPORT_FP = 'eval-image-fixture-2026';
const IMPORT_URL = 'https://archive.example/plato/lobby-2024.tar.gz';
const importedAt = now - 3 * 24 * HOUR;
const importedAtSource = now - 30 * 24 * HOUR;

createSub(db, {
  name: 'ham-archive',
  description: 'imported snapshot from another plato instance',
  ownerHandle: ALICE,
});
db.prepare(
  `UPDATE subs SET imported_from_url = ?, imported_from_fingerprint = ?,
                   imported_at = ?, imported_at_source = ?
   WHERE name = ?`
).run(IMPORT_URL, IMPORT_FP, importedAt, importedAtSource, 'ham-archive');

const ZED  = deriveHandle('zed@elsewhere.example');
const YANN = deriveHandle('yann@elsewhere.example');
for (const h of [ZED, YANN]) {
  pseudonymFor(db, h);
  db.prepare('UPDATE handles SET imported_from_fingerprint = ?, first_seen_at = ? WHERE handle = ?')
    .run(IMPORT_FP, importedAtSource, h);
}

const IMPORTED_POSTS = [
  { author: ZED,  title: 'first contact via packet radio',
    body: 'a portable rig + a battery + dipole strung between two trees. heard a station from 2,300km away on 20m and answered with 5W.\n\n*imported from elsewhere — the original post predates this instance.*' },
  { author: YANN, title: 'a quiet net is a healthy net',
    body: 'we kept ours under 8 check-ins per evening. people stopped reflexively keying up to fill silence. the silence itself is the protocol.' },
  { author: ZED,  title: 'long-wire vs vertical: results from one weekend',
    body: 'long-wire wins on receive in low bands; vertical edges out on transmit when the band is short. nothing surprising — but having the numbers is calming.' },
];
const importedPostIds = [];
IMPORTED_POSTS.forEach((p, i) => {
  const { draftId } = submitDraft(db, { title: p.title, body: p.body, subName: 'ham-archive' });
  const { postId } = finalizeDraft(db, { draftId, handle: p.author, postsDir: POSTS_DIR });
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?')
    .run(importedAtSource - i * 7 * 24 * HOUR, postId);
  importedPostIds.push(postId);
});

// /memlog activity rows for the seeded personas come "for free" —
// listActivityForHandle reads posts.handle + comments.handle, both
// of which are populated. So we only need to write notification
// rows for the *received* side: comments on alice's posts, replies
// to her comments, mod actions on her account, etc.
//
// The visitor who logs in as alice@plato.eval (KNOWLESS_SECRET is
// stable within a container so deriveHandle is stable too) sees:
//   /memlog?mode=notifications  → these rows
//   /memlog?mode=activity       → her own posts + comments
//   /memlog?mode=all            → both
//
// We seed alice's notifications to ~5 rows so the unread chip in
// the header is visibly non-zero on first view.

const aliceLobbyPosts = postIds.filter((id, i) => POSTS[i].author === ALICE && POSTS[i].sub === 'lobby');

if (aliceLobbyPosts.length > 0) {
  const target = aliceLobbyPosts[0];
  recordNotification(db, {
    recipientHandle: ALICE, kind: 'comment_on_post',
    subName: 'lobby', targetType: 'post', targetId: target,
    actorHandle: BOB,
    snippet: 'pinning this in my head: "attack ideas, not people". hard rule.',
    now: now - 3 * HOUR,
  });
  recordNotification(db, {
    recipientHandle: ALICE, kind: 'comment_on_post',
    subName: 'lobby', targetType: 'post', targetId: target,
    actorHandle: CAROL,
    snippet: 'the public modlog is the bit that does the work for me — i can see if a mod is trigger-happy.',
    now: now - 2 * HOUR,
  });
}

// Reply notification on the algorithmic-feed post (alice did
// reply to dave's comment on it; reverse a fake one for demo).
const algoPost = postIds[1];
recordNotification(db, {
  recipientHandle: ALICE, kind: 'reply_to_comment',
  subName: 'lobby', targetType: 'comment', targetId: algoPost + ':reply',
  actorHandle: DAVE,
  snippet: 'right — the optimization target is what people miss.',
  now: now - HOUR,
});

// mod_action notification on bob's content. actorHandle = null
// because community-overrule actions don't have a single mod author —
// the system did it (recordNotification self-suppresses when actor
// matches recipient, so we can't reuse a persona here).
recordNotification(db, {
  recipientHandle: BOB, kind: 'mod_action',
  subName: 'field-notes', targetType: 'post', targetId: postIds[5],
  actorHandle: null,
  snippet: 'auto-uncollapsed by community vote',
  now: now - 30 * 60 * 1000,
});

// import_ready: visible record that an import landed for alice.
recordNotification(db, {
  recipientHandle: ALICE, kind: 'import_ready',
  subName: 'ham-archive', targetType: 'sub', targetId: 'ham-archive',
  actorHandle: null,
  snippet: 'imported as //ham-archive — 3 posts, 2 handles',
  now: importedAt,
});

console.error(`[eval-seed] seeded 3 subs (1 imported), ${POSTS.length + IMPORTED_POSTS.length + 1} posts, ${COMMENTS.length} comments, ${votes.length} votes, 2 mod actions, ~5 notifications`);
db.close();
