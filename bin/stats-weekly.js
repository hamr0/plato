#!/usr/bin/env node
// Weekly digest. Reads data/stats.log, groups by ISO week, keeps the
// latest snapshot per week, takes the most recent 4 weeks, renders a
// fixed-width table with WoW deltas, and emails it via /usr/sbin/sendmail
// to operator.email from config.json.
//
//   week     | users      | subs      | posts        | comments
//   2026-W18 |    35  +2  |    12     |    63   +5   |    77   +8
//   2026-W17 |    33     ...
//
// Wire via system cron:
//   0 6 * * 1 cd /opt/plato && node bin/stats-weekly.js >> /var/log/plato-stats.log 2>&1
//
// --dry-run prints the rendered email body to stdout instead of sending.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const STATS_LOG = process.env.PLATO_STATS_LOG ?? resolve(ROOT, 'data/stats.log');
const CONFIG_PATH = process.env.PLATO_CONFIG ?? resolve(ROOT, 'config.json');

const dryRun = process.argv.includes('--dry-run');

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

// ISO 8601 week-date (YYYY-Www). The "Thursday of the week" rule —
// see https://en.wikipedia.org/wiki/ISO_week_date#Algorithms. The week
// number's calendar year follows the Thursday, which is why a Dec 30
// Monday can land in next-year W01 and a Jan 1 Friday in last-year W53.
function isoWeek(iso) {
  const d = new Date(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function loadWeeks() {
  if (!existsSync(STATS_LOG)) return [];
  const byWeek = new Map();
  const raw = readFileSync(STATS_LOG, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row.snapshot_at) continue;
    const week = isoWeek(row.snapshot_at);
    const prev = byWeek.get(week);
    // String compare on snapshot_at: load-bearing assumption that
    // bin/stats.js always writes ISO 8601 with a trailing 'Z'. Lex
    // order matches chrono order under that constraint. If a future
    // change emits +00:00 or local-TZ offsets, switch to Date.parse.
    if (!prev || row.snapshot_at > prev.snapshot_at) {
      byWeek.set(week, { ...row, week });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function fmtDelta(curr, prev) {
  if (prev == null) return '';
  const d = curr - prev;
  if (d === 0) return '';
  return d > 0 ? `+${d}` : `${d}`;
}

function pad(s, n) { return String(s).padStart(n); }
function padR(s, n) { return String(s).padEnd(n); }

function renderTable(weeks) {
  if (weeks.length === 0) return '(no snapshots yet)\n';
  const last4 = weeks.slice(-4).reverse();  // newest first
  const header = `${padR('week', 8)} | ${pad('users', 6)} ${pad('Δ', 5)} | ${pad('subs', 5)} ${pad('Δ', 5)} | ${pad('posts', 6)} ${pad('Δ', 5)} | ${pad('cmnts', 6)} ${pad('Δ', 5)}`;
  const rule = '-'.repeat(header.length);
  const rows = last4.map((w, i) => {
    const prev = last4[i + 1];  // next-older row
    const cell = (curr, prev, w1, w2) => `${pad(curr, w1)} ${pad(fmtDelta(curr, prev), w2)}`;
    return [
      padR(w.week, 8),
      cell(w.users,    prev?.users,    6, 5),
      cell(w.subs,     prev?.subs,     5, 5),
      cell(w.posts,    prev?.posts,    6, 5),
      cell(w.comments, prev?.comments, 6, 5),
    ].join(' | ');
  });
  return [header, rule, ...rows].join('\n') + '\n';
}

function renderBody(weeks) {
  const newest = weeks[weeks.length - 1];
  const oldest = weeks[0];
  const span = weeks.length === 0
    ? '(no snapshots)'
    : weeks.length === 1
      ? newest.week
      : `${oldest.week} → ${newest.week}`;
  return [
    `plato weekly stats — ${span}`,
    `host: ${hostname()}`,
    `snapshots in log: ${weeks.length}`,
    '',
    renderTable(weeks),
    'Source: data/stats.log (one JSON line per daily snapshot, append-only).',
    'Δ is week-over-week against the next-older row in the table; blank when 0 or no prior week.',
  ].join('\n');
}

function send(notify, subject, body) {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('/usr/sbin/sendmail', ['-t'], { stdio: ['pipe', 'inherit', 'inherit'] });
    proc.on('error', rejectP);
    proc.on('exit', code => code === 0 ? resolveP() : rejectP(new Error(`sendmail exit ${code}`)));
    proc.stdin.end([
      `From: noreply@${hostname()}`,
      `To: ${notify}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\n'));
  });
}

const cfg = readConfig();
const notify = (cfg.operator || {}).email || '';

const weeks = loadWeeks();
const body = renderBody(weeks);
const newest = weeks[weeks.length - 1]?.week ?? '(none)';
const subject = `[plato] weekly stats — ${newest}`;

if (dryRun || !notify) {
  if (!notify && !dryRun) {
    console.error('config.json operator.email is unset; printing to stdout');
  }
  process.stdout.write(`Subject: ${subject}\n\n${body}\n`);
} else {
  await send(notify, subject, body);
  console.log(`[stats-weekly] sent to ${notify}: ${subject}`);
}
