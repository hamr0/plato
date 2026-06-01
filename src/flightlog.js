// Adopter glue for flightlog — the error flight-recorder. flightlog owns the
// mechanism (global uncaught/rejection net + capture/captureSync + the JSONL
// sink with rotation); this module only chooses the *policy*: where the sink
// lives and what static context every record carries. Per flightlog's contract
// we log only what we pass here — it never auto-harvests, so nothing sensitive
// leaks unless we put it in `context`/`extra`.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { install } from 'flightlog';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Version stamps every record's `release`. Best-effort: a missing/unreadable
// manifest must not stop a process from booting.
let release = 'unknown';
try {
  release = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version ?? 'unknown';
} catch { /* keep 'unknown' */ }

// Sink path: data/logs/errors.jsonl under the gitignored data/ dir (install()
// mkdir -p's the parent and probes a write at boot, so a bad path fails loudly
// at startup). Overridable for ops.
export function sinkFile() {
  return process.env.PLATO_FLIGHTLOG_FILE ?? resolve(ROOT, 'data', 'logs', 'errors.jsonl');
}

// Register the global error net and return { capture, captureSync }.
//   - exitOnUncaught: true everywhere (a corrupt event loop should restart clean).
//   - exitOnRejection: false for the long-lived server (a stray un-awaited
//     rejection must not down it). Short-lived scripts that log-then-exit should
//     pass exitOnRejection:true + bootCheck:false and use captureSync.
export function initFlightlog({ proc, exitOnUncaught = true, exitOnRejection = false, bootCheck = true } = {}) {
  return install({
    file: sinkFile(),
    context: { app: 'plato', release, proc },
    exitOnUncaught,
    exitOnRejection,
    bootCheck,
  });
}
