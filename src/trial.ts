import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// A Netplan `try` applies the new WiFi config, which drops SSH on a remote host. The trial therefore
// runs in a detached worker: it outlives the losing SSH session and records its outcome here so the
// next `openwifi status` can report what happened. State lives on tmpfs, so it clears on reboot.
export type TrialPhase = 'starting' | 'trying' | 'ok' | 'rolled-back';

export type TrialState = {
  phase: TrialPhase;
  ssid: string;
  iface: string;
  pid: number;
  startedAt: string;
  finishedAt?: string;
  saved?: boolean;
  alreadyConnected?: boolean;
  error?: string;
  stateFile: string;
  logFile: string;
};

// After the worker resolves, keep waiting this long for it before reporting "still running".
export const TRIAL_FOLLOW_MS = 150_000;

let stateDir = '/run/openwifi';
let writeSeq = 0;
export function setTrialStateDirForTests(dir: string | null) { stateDir = dir ?? '/run/openwifi'; }
export function trialStateDir(): string { return stateDir; }
export function trialStateFile(): string { return join(stateDir, 'connect.json'); }
export function trialLogFile(): string { return join(stateDir, 'connect.log'); }

export function isTrialDone(state: TrialState | null): boolean {
  return !!state && (state.phase === 'ok' || state.phase === 'rolled-back');
}

// 0644 so a non-root `openwifi status` can read it: the file holds SSID names and outcomes, no secrets.
export async function readTrialState(): Promise<TrialState | null> {
  try {
    const parsed = JSON.parse(await readFile(trialStateFile(), 'utf8'));
    return parsed && typeof parsed.phase === 'string' ? parsed as TrialState : null;
  } catch { return null; }
}

export async function writeTrialState(state: TrialState): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o755 });
  // Unique per write: a stand-in or overlapping writer would otherwise rename one temp file twice
  // and fail with ENOENT. Renaming onto the final path is atomic on POSIX.
  const temp = `${trialStateFile()}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
  await rename(temp, trialStateFile());
}

// Logging must never break a trial, and the log stays root-only because it records raw tool output.
export async function appendTrialLog(line: string): Promise<void> {
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o755 });
    await appendFile(trialLogFile(), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch { /* ignore */ }
}

function entryScript(): string { return process.argv[1] ?? process.execPath; }

// The worker re-executes this CLI. Under tsx (dev) the entry is TypeScript, so load the loader too.
// Option names must not repeat a global option: commander would then reject the invocation with
// "required option not specified" before the worker could run.
export function workerArgv(entry: string, o: { iface: string; ssid: string; candidate: string }): string[] {
  const loader = entry.endsWith('.ts') ? ['--import', 'tsx'] : [];
  return [...loader, entry, '__trial', '--iface', o.iface, '--ssid', o.ssid, '--candidate', o.candidate];
}

type Spawned = { pid?: number; unref: () => void };
type Spawner = (cmd: string, argv: string[], logFd: number) => Spawned;
function defaultSpawner(cmd: string, argv: string[], logFd: number): Spawned {
  // detached: leaves sudo's use_pty session, so SSH teardown cannot reach the worker. Output goes to
  // the log file instead of a pipe or a terminal, which keeps a startup failure diagnosable.
  const child = spawn(cmd, argv, { detached: true, stdio: ['ignore', logFd, logFd], cwd: '/' });
  child.unref();
  return child;
}
let spawnDetached: Spawner = defaultSpawner;
export function setTrialSpawnerForTests(spawner: Spawner | null) {
  spawnDetached = spawner ?? defaultSpawner;
}

export async function startDetachedTrial(o: { iface: string; ssid: string; candidate: string }, opts: { startTimeoutMs?: number } = {}): Promise<TrialState> {
  const state: TrialState = {
    phase: 'starting', ssid: o.ssid, iface: o.iface, pid: 0, startedAt: new Date().toISOString(),
    stateFile: trialStateFile(), logFile: trialLogFile(),
  };
  await writeTrialState(state);
  await mkdir(stateDir, { recursive: true, mode: 0o755 });
  const logFd = openSync(trialLogFile(), 'a', 0o600);
  try {
    const child = spawnDetached(process.execPath, workerArgv(entryScript(), o), logFd);
    state.pid = child.pid ?? 0;
  } finally { closeSync(logFd); }
  // The worker records its own pid and phases, so the caller does not write again here: a second
  // write could clobber the worker's first update and look like a worker that never started.
  // A worker that dies at startup would otherwise leave the caller polling a state file that never
  // moves, and that looks like a trial still in progress instead of a failure.
  if (!await workerStarted(opts.startTimeoutMs ?? 10_000)) {
    throw new Error('The trial worker did not start; nothing was changed. See ' + trialLogFile());
  }
  return state;
}

async function workerStarted(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await readTrialState();
    if (state && state.phase !== 'starting') return true;
    if (Date.now() >= deadline) return false;
    await delay(250);
  }
}

export async function followTrial(o: { timeoutMs?: number } = {}): Promise<{ state: TrialState | null; timedOut: boolean }> {
  const deadline = Date.now() + (o.timeoutMs ?? TRIAL_FOLLOW_MS);
  for (;;) {
    const state = await readTrialState();
    if (isTrialDone(state)) return { state, timedOut: false };
    if (Date.now() >= deadline) return { state, timedOut: true };
    await delay(1000);
  }
}
