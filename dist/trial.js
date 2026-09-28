import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
// After the worker resolves, keep waiting this long for it before reporting "still running".
export const TRIAL_FOLLOW_MS = 150_000;
let stateDir = '/run/openwifi';
export function setTrialStateDirForTests(dir) { stateDir = dir ?? '/run/openwifi'; }
export function trialStateDir() { return stateDir; }
export function trialStateFile() { return join(stateDir, 'connect.json'); }
export function trialLogFile() { return join(stateDir, 'connect.log'); }
export function isTrialDone(state) {
    return !!state && (state.phase === 'ok' || state.phase === 'rolled-back');
}
// 0644 so a non-root `openwifi status` can read it: the file holds SSID names and outcomes, no secrets.
export async function readTrialState() {
    try {
        const parsed = JSON.parse(await readFile(trialStateFile(), 'utf8'));
        return parsed && typeof parsed.phase === 'string' ? parsed : null;
    }
    catch {
        return null;
    }
}
export async function writeTrialState(state) {
    await mkdir(stateDir, { recursive: true, mode: 0o755 });
    const temp = `${trialStateFile()}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
    await rename(temp, trialStateFile());
}
// Logging must never break a trial, and the log stays root-only because it records raw tool output.
export async function appendTrialLog(line) {
    try {
        await mkdir(stateDir, { recursive: true, mode: 0o755 });
        await appendFile(trialLogFile(), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    }
    catch { /* ignore */ }
}
function entryScript() { return process.argv[1] ?? process.execPath; }
// The worker re-executes this CLI. Under tsx (dev) the entry is TypeScript, so load the loader too.
export function workerArgv(entry, o) {
    const loader = entry.endsWith('.ts') ? ['--import', 'tsx'] : [];
    return [...loader, entry, '__trial', '--interface', o.iface, '--ssid', o.ssid, '--candidate', o.candidate];
}
function defaultSpawner(cmd, argv) {
    // detached + stdio ignore: leaves sudo's use_pty session, so SSH teardown cannot reach the worker.
    const child = spawn(cmd, argv, { detached: true, stdio: 'ignore', cwd: '/' });
    child.unref();
    return child;
}
let spawnDetached = defaultSpawner;
export function setTrialSpawnerForTests(spawner) {
    spawnDetached = spawner ?? defaultSpawner;
}
export async function startDetachedTrial(o) {
    const state = {
        phase: 'starting', ssid: o.ssid, iface: o.iface, pid: 0, startedAt: new Date().toISOString(),
        stateFile: trialStateFile(), logFile: trialLogFile(),
    };
    await writeTrialState(state);
    const child = spawnDetached(process.execPath, workerArgv(entryScript(), o));
    state.pid = child.pid ?? 0;
    await writeTrialState(state);
    return state;
}
export async function followTrial(o = {}) {
    const deadline = Date.now() + (o.timeoutMs ?? TRIAL_FOLLOW_MS);
    for (;;) {
        const state = await readTrialState();
        if (isTrialDone(state))
            return { state, timedOut: false };
        if (Date.now() >= deadline)
            return { state, timedOut: true };
        await delay(1000);
    }
}
//# sourceMappingURL=trial.js.map