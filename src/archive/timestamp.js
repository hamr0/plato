// OpenTimestamps anchor (M7/B6).
//
// Thin wrapper that shells out to the official `ots` CLI (the python
// `opentimestamps-client`). Zero new npm dependencies; plato keeps its
// "five runtime deps" posture intact. Operators who want Bitcoin-
// anchored archive proofs install ots-cli once
// (`apt install opentimestamps-client` or pipx); operators who don't
// care: nothing happens, exports still ship .tar.gz + .sig as before.
//
// Pattern lifted from gitdone (~/PycharmProjects/gitdone/app/src/ots.js).
// Same ENOENT-tolerant posture: if the binary is missing, return a soft
// `{ error: 'ots not found' }` so the export worker can log and proceed.
// Stamping is best-effort polish, not load-bearing for the archive.
//
// Two operations:
//   - stampFile(absPath)   — submit the file's sha256 to free OTS
//                            calendars, write `<absPath>.ots` next to it.
//                            The proof is "calendar-pending" until
//                            Bitcoin confirms the calendar's commitment.
//   - upgradeFile(absPath) — refresh a pending proof in place. Detected
//                            via sha256 change before/after — when the
//                            calendar's Bitcoin attestation has been
//                            merged in, the file's bytes change.

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

// Operator-configurable binary path; defaults to the typical install
// locations (env first, then PATH lookup via bare name).
function defaultOtsBin() {
  return process.env.OTS_BIN ?? 'ots';
}

const STAMP_TIMEOUT_MS = 30_000;
const UPGRADE_TIMEOUT_MS = 60_000;

function runOts(args, { cwd, timeoutMs, bin }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(bin, args, { cwd });
    } catch (err) {
      // Synchronous spawn errors (rare; mostly options-shape issues).
      return resolve({ code: -1, stdout, stderr, error: err.message });
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ code: -1, stdout, stderr, error: 'ots timeout' });
    }, timeoutMs);
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      // ENOENT → operator hasn't installed ots-cli. Surface as a soft
      // error string so callers can log without crashing the export.
      const reason = err.code === 'ENOENT' ? 'ots not found' : err.message;
      resolve({ code: -1, stdout, stderr, error: reason });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Stamp `absPath` via `ots stamp`. The CLI writes `<absPath>.ots` next
// to the input. Returns:
//   { proofPath: '<absPath>.ots' } on success
//   { error: '<reason>' } on failure (binary missing, network down,
//                          calendar timeout, etc.)
//
// Failure does NOT throw; the caller (export worker) treats stamp as
// best-effort polish so a flaky ots-cli or offline calendar can't take
// down the export pipeline.
export async function stampFile(absPath, opts = {}) {
  const bin = opts.bin ?? defaultOtsBin();
  const timeoutMs = opts.timeoutMs ?? STAMP_TIMEOUT_MS;
  const res = await runOts(['stamp', absPath], { cwd: opts.cwd, timeoutMs, bin });
  if (res.error) return { error: res.error };
  if (res.code !== 0) {
    return { error: `ots stamp exit ${res.code}: ${(res.stderr || '').trim().slice(0, 200)}` };
  }
  const proofPath = `${absPath}.ots`;
  try {
    const st = await stat(proofPath);
    if (!st.isFile()) return { error: 'ots proof file missing after stamp' };
    return { proofPath };
  } catch {
    return { error: 'ots proof file missing after stamp' };
  }
}

// Run `ots upgrade <absProofPath>`. Returns:
//   { ok: true, stdout, stderr } on exit 0 (upgrade succeeded OR
//       was a no-op — caller compares pre/post sha256 for the real
//       "got anchored" signal, mirroring gitdone's approach)
//   { error: '<reason>', stdout, stderr } on any failure
//
// `ots upgrade` exits 0 in two cases:
//   - The proof was upgraded (Bitcoin attestation merged in).
//   - The proof was already fully upgraded (no-op).
// And exits non-zero when the calendar isn't ready yet OR the binary
// failed. We don't try to disambiguate from the exit code; the bytes-
// changed signal is the authoritative truth.
export async function upgradeFile(absProofPath, opts = {}) {
  const bin = opts.bin ?? defaultOtsBin();
  const timeoutMs = opts.timeoutMs ?? UPGRADE_TIMEOUT_MS;
  const res = await runOts(['upgrade', absProofPath], { cwd: opts.cwd, timeoutMs, bin });
  if (res.error) return { error: res.error, stdout: res.stdout, stderr: res.stderr };
  if (res.code !== 0) {
    return {
      error: `ots upgrade exit ${res.code}`,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }
  return { ok: true, stdout: res.stdout, stderr: res.stderr };
}
