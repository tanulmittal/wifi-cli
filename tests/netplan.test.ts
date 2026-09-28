import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { connectNetplan, editNetplan, forgetNetplan, isOpenwifiProfile, netplanCandidate, parseConfSsids, parseWpaNetworks, removeNewTrialCopies, repairGeneratedConf, requireNetplanForget, runConnectTrial, setGeneratedConfDirForTests, setNetplanDirForTests, setNetplanTempRootForTests, setTrialStarter, tryNetplanConnection, ungeneratedSsids, useNetplan } from '../src/adapters/netplan.js';
import { readTrialState, setTrialSpawnerForTests, setTrialStateDirForTests, startDetachedTrial, trialLogFile, trialStateFile, writeTrialState } from '../src/trial.js';
import { setRunner } from '../src/util.js';

test('Netplan candidate contains one target AP and WPA credentials in system format', () => {
  const candidate = JSON.parse(netplanCandidate('wlp2s0', "Tanul's iPhone", 'secret123', true));
  assert.deepEqual(candidate, { network: { version: 2, wifis: { wlp2s0: { 'access-points': { "Tanul's iPhone": { password: 'secret123', hidden: true } } } } } });
  assert.deepEqual(Object.keys(JSON.parse(netplanCandidate('wlp2s0', 'Tanul’s iPhone', 'secret123')).network.wifis.wlp2s0['access-points']), ['Tanul’s iPhone']);
  assert.deepEqual(parseWpaNetworks('network id / ssid / bssid / flags\n0\tCurrent\tany\t[CURRENT]\n1\tNew WiFi\tany\t\n2\tTanul\\xe2\\x80\\x99s iPhone\tany\t\n3\t\\x00\\x00\tany\t\n'), [{ id: '0', ssid: 'Current' }, { id: '1', ssid: 'New WiFi' }, { id: '2', ssid: 'Tanul’s iPhone' }]);
});

test('Netplan trial selects the target only after rollback is armed and confirms on connection', async () => {
  const calls: string[] = [];
  const signals: string[] = [];
  const trial = new EventEmitter() as ChildProcess;
  (trial as any).kill = (signal: string) => { signals.push(signal); queueMicrotask(() => trial.emit('exit', signal === 'SIGUSR1' ? 0 : 1)); return true; };
  setTrialStarter((args) => { calls.push(`netplan ${args.join(' ')}`); return trial; });
  setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tCurrent\tany\t[CURRENT]\n1\tNew WiFi\tany\t\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) return { stdout: 'OK\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=New WiFi\n', stderr: '' };
    if (cmd === 'ip') return { stdout: '3: wlp2s0 inet 192.168.1.25/24\n', stderr: '' };
    throw new Error('Unexpected command');
  });
  try {
    await tryNetplanConnection('/run/openwifi-test/candidate.yaml', 'wlp2s0', 'New WiFi');
    assert.equal(signals.join(','), 'SIGUSR1');
    assert.ok(calls[0].startsWith('netplan try --config-file'));
    assert.ok(calls.some(c => c.includes('select_network 1')));
  } finally { setRunner(null); setTrialStarter(null); }
});

test('Netplan trial rejects and leaves current profile untouched if selection fails', async () => {
  const signals: string[] = [];
  const trial = new EventEmitter() as ChildProcess;
  (trial as any).kill = (signal: string) => { signals.push(signal); queueMicrotask(() => trial.emit('exit', 1)); return true; };
  setTrialStarter(() => trial);
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n1\tNew WiFi\tany\t\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) return { stdout: 'FAIL\n', stderr: '' };
    throw new Error('Unexpected command');
  });
  try {
    await assert.rejects(tryNetplanConnection('/run/openwifi-test/candidate.yaml', 'wlp2s0', 'New WiFi'), /Could not select/);
    assert.deepEqual(signals, ['SIGINT']);
  } finally { setRunner(null); setTrialStarter(null); }
});

test('Netplan forget removes only an openwifi-owned inactive profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-test-'));
  const ssid = 'Old WiFi';
  const file = join(dir, `90-openwifi-wlp2s0-${createHash('sha256').update(ssid).digest('hex').slice(0, 12)}.yaml`);
  const getuid = process.getuid;
  setNetplanDirForTests(dir);
  (process as any).getuid = () => 0;
  let current = 'Current WiFi';
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: `wpa_state=COMPLETED\nssid=${current}\n`, stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tOld WiFi\tany\t[DISABLED]\n1\tCurrent WiFi\tany\t[CURRENT]\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('remove_network')) return { stdout: 'OK\n', stderr: '' };
    throw new Error('Unexpected command');
  });
  try {
    await assert.rejects(requireNetplanForget('Unmanaged', 'wlp2s0'), /only forget networks it added/);
    await writeFile(file, netplanCandidate('wlp2s0', ssid, 'secret123'), { mode: 0o600 });
    current = ssid;
    await assert.rejects(forgetNetplan(ssid, 'wlp2s0'), /current connection/);
    await access(file);
    current = 'Current WiFi';
    await forgetNetplan(ssid, 'wlp2s0');
    await assert.rejects(access(file), { code: 'ENOENT' });
  } finally {
    setRunner(null);
    setNetplanDirForTests(null);
    (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Netplan connect refuses an already configured UTF-8 SSID before starting a trial', async () => {
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  const calls: string[] = [];
  setTrialStarter(() => { throw new Error('Trial must not start'); });
  setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'netplan' && args[0] === 'get') return { stdout: 'access-points: {}\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=Airtel_tanu_0405\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tAirtel_tanu_0405\tany\t[CURRENT]\n1\tTanul\\xe2\\x80\\x99s iPhone\tany\t\n', stderr: '' };
    throw new Error('Unexpected command');
  });
  try {
    await assert.rejects(connectNetplan('Tanul’s iPhone', { iface: 'wlp2s0', password: 'secret123' }), /already a saved network/);
    assert.deepEqual(calls.map(call => call.split(' ')[0]), ['netplan', 'wpa_cli', 'wpa_cli']);
  } finally { setRunner(null); setTrialStarter(null); (process as any).getuid = getuid; }
});

test('Netplan forget recognizes and removes a beta.1 escaped-SSID profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-legacy-test-'));
  const ssid = 'Tanul’s iPhone';
  const escaped = 'Tanul\\xe2\\x80\\x99s iPhone';
  const file = join(dir, `90-openwifi-wlp2s0-${createHash('sha256').update(escaped).digest('hex').slice(0, 12)}.yaml`);
  const stamped = `${file}.1790580022.1488316.yaml`;
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  setNetplanDirForTests(dir);
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=Airtel_tanu_0405\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tTanul\\xe2\\x80\\x99s iPhone\tany\t[DISABLED]\n1\tAirtel_tanu_0405\tany\t[CURRENT]\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('remove_network')) { assert.equal(args.at(-1), '0'); return { stdout: 'OK\n', stderr: '' }; }
    throw new Error('Unexpected command');
  });
  try {
    await writeFile(file, netplanCandidate('wlp2s0', escaped, 'secret123'), { mode: 0o600 });
    await writeFile(stamped, netplanCandidate('wlp2s0', escaped, 'secret123'), { mode: 0o600 });
    assert.equal(await isOpenwifiProfile(ssid, 'wlp2s0'), true);
    await forgetNetplan(ssid, 'wlp2s0');
    await assert.rejects(access(file), { code: 'ENOENT' });
    await assert.rejects(access(stamped), { code: 'ENOENT' });
    await writeFile(stamped, netplanCandidate('wlp2s0', escaped, 'secret123'), { mode: 0o600 });
    assert.equal(await isOpenwifiProfile(ssid, 'wlp2s0'), true);
    await forgetNetplan(ssid, 'wlp2s0');
    await assert.rejects(access(stamped), { code: 'ENOENT' });
  } finally {
    setRunner(null);
    setNetplanDirForTests(null);
    (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Netplan trial cleanup removes only newly generated matching timestamp YAML', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-trial-test-'));
  const saved = join(dir, '90-openwifi-wlp2s0-abc123.yaml');
  const old = saved.replace(/\.yaml$/, '.1790580000.100.yaml');
  const created = `${saved}.1790580001.200.yaml`;
  const unrelated = saved.replace(/\.yaml$/, '.1790580002.300.yaml');
  setNetplanDirForTests(dir);
  try {
    await writeFile(old, 'candidate', { mode: 0o600 });
    await writeFile(created, 'candidate', { mode: 0o600 });
    await writeFile(unrelated, 'different', { mode: 0o600 });
    await removeNewTrialCopies(saved, 'candidate', new Set([old]));
    await access(old);
    await access(unrelated);
    await assert.rejects(access(created), { code: 'ENOENT' });
  } finally { setNetplanDirForTests(null); await rm(dir, { recursive: true, force: true }); }
});

test('Netplan edit preserves unrelated settings, protects permissions, and rejects unsupported fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-edit-test-'));
  const source = join(dir, '50-existing.yaml');
  const redundant = join(dir, '50-existing.yaml.1790580159.4213564.yaml');
  const original = '# Keep this comment\nnetwork:\n  version: 2\n  wifis:\n    wlp2s0:\n      dhcp4: true\n      access-points:\n        Old WiFi:\n          password: oldpass12\n';
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  setNetplanDirForTests(dir);
  setNetplanTempRootForTests(dir);
  const calls: string[] = [];
  setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'netplan' && args[0] === 'generate') return { stdout: '', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=Current WiFi\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tCurrent WiFi\tany\t[CURRENT]\n', stderr: '' };
    throw new Error(`Unexpected command: ${cmd}`);
  });
  try {
    await writeFile(source, original, { mode: 0o600 });
    await writeFile(redundant, original, { mode: 0o600 });
    await assert.rejects(editNetplan('Old WiFi', { priority: 2, newPassword: 'newpass123' }, 'wlp2s0'), /no per-profile/);
    assert.equal(await readFile(source, 'utf8'), original);
    await editNetplan('Old WiFi', { newPassword: 'newpass123', rename: 'New WiFi' }, 'wlp2s0');
    const edited = await readFile(source, 'utf8');
    assert.match(edited, /# Keep this comment/);
    assert.match(edited, /dhcp4: true/);
    assert.match(edited, /New WiFi:/);
    assert.match(edited, /password: newpass123/);
    assert.doesNotMatch(edited, /Old WiFi:/);
    assert.equal((await stat(source)).mode & 0o777, 0o600);
    await assert.rejects(access(redundant), { code: 'ENOENT' });
    assert.ok(calls.some(call => call.startsWith('netplan generate --root-dir=')));
  } finally { setRunner(null); setNetplanDirForTests(null); setNetplanTempRootForTests(null); (process as any).getuid = getuid; await rm(dir, { recursive: true, force: true }); }
});

test('active Netplan edit forces fresh authentication under trial before saving', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-active-edit-'));
  const source = join(dir, '50-existing.yaml');
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  setNetplanDirForTests(dir);
  setNetplanTempRootForTests(dir);
  const signals: string[] = [];
  const calls: string[] = [];
  const trial = new EventEmitter() as ChildProcess;
  (trial as any).kill = (signal: string) => { signals.push(signal); queueMicrotask(() => trial.emit('exit', signal === 'SIGUSR1' ? 0 : 1)); return true; };
  setTrialStarter(args => { calls.push(`netplan ${args.join(' ')}`); return trial; });
  setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'netplan' && args[0] === 'generate') return { stdout: '', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=Old WiFi\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tOld WiFi\tany\t[CURRENT]\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('get_network')) return { stdout: '"newpass123"\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('disconnect')) return { stdout: 'OK\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) return { stdout: 'OK\n', stderr: '' };
    if (cmd === 'ip') return { stdout: '3: wlp2s0 inet 192.168.1.5/24\n', stderr: '' };
    throw new Error(`Unexpected command: ${cmd}`);
  });
  try {
    await writeFile(source, netplanCandidate('wlp2s0', 'Old WiFi', 'oldpass12'), { mode: 0o600 });
    await editNetplan('Old WiFi', { newPassword: 'newpass123' }, 'wlp2s0');
    assert.deepEqual(signals, ['SIGUSR1']);
    assert.ok(calls.findIndex(call => call.includes('disconnect')) < calls.findIndex(call => call.includes('select_network')));
    assert.match(await readFile(source, 'utf8'), /newpass123/);
  } finally { setRunner(null); setTrialStarter(null); setNetplanDirForTests(null); setNetplanTempRootForTests(null); (process as any).getuid = getuid; await rm(dir, { recursive: true, force: true }); }
});

test('Netplan connect starts a detached trial worker and keeps the password out of its arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-detach-test-'));
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  setNetplanDirForTests(dir);
  setNetplanTempRootForTests(dir);
  setTrialStateDirForTests(join(dir, 'state'));
  const spawned: string[][] = [];
  setTrialSpawnerForTests((cmd, argv) => {
    spawned.push([cmd, ...argv]);
    // Stand-in for the real worker: move the state off 'starting' so the caller can return.
    void writeTrialState({ phase: 'trying', ssid: 'New WiFi', iface: 'wlp2s0', pid: 4242, startedAt: new Date().toISOString(), stateFile: trialStateFile(), logFile: trialLogFile() });
    return { pid: 4242, unref: () => {} };
  });
  setRunner(async (cmd, args) => {
    if (cmd === 'netplan' && args[0] === 'get') return { stdout: 'wlp2s0:\n  access-points:\n    Airtel_tanu_0405: {}\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=Airtel_tanu_0405\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tAirtel_tanu_0405\tany\t[CURRENT]\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('scan_results')) return { stdout: 'bssid / frequency / signal level / flags / ssid\naa:bb:cc:dd:ee:ff\t2412\t-55\t[WPA2-PSK-CCMP][ESS]\tNew WiFi\n', stderr: '' };
    throw new Error('Unexpected command: ' + cmd);
  });
  try {
    const state = await connectNetplan('New WiFi', { iface: 'wlp2s0', password: 'p@ssw0rd123' });
    assert.equal(state.phase, 'starting');
    assert.equal(state.pid, 4242);
    assert.equal(spawned.length, 1);
    assert.ok(spawned[0].includes('__trial'), 'the worker runs the hidden trial command');
    assert.ok(spawned[0].includes('--iface'), 'the worker must not reuse the global --interface option');
    assert.ok(!spawned[0].join(' ').includes('p@ssw0rd123'), 'the password must never reach the worker arguments');
    const candidate = spawned[0][spawned[0].indexOf('--candidate') + 1];
    assert.ok(candidate.startsWith(join(dir, 'openwifi')));
    assert.equal((await stat(candidate)).mode & 0o777, 0o600);
    assert.match(await readFile(candidate, 'utf8'), /p@ssw0rd123/);
    assert.equal((await readTrialState())?.ssid, 'New WiFi');
  } finally {
    setRunner(null); setTrialSpawnerForTests(null); setTrialStateDirForTests(null);
    setNetplanDirForTests(null); setNetplanTempRootForTests(null); (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});

test('the detached worker saves the profile on success and always deletes the candidate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-worker-test-'));
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  const ssid = 'New WiFi';
  const filename = '90-openwifi-wlp2s0-' + createHash('sha256').update(ssid).digest('hex').slice(0, 12) + '.yaml';
  const candidate = join(dir, 'openwifi', filename);
  await mkdir(join(dir, 'openwifi'), { recursive: true });
  await writeFile(candidate, netplanCandidate('wlp2s0', ssid, 'secret123'), { mode: 0o600 });
  setNetplanDirForTests(dir);
  setNetplanTempRootForTests(dir);
  setTrialStateDirForTests(join(dir, 'state'));
  await writeTrialState({ phase: 'starting', ssid, iface: 'wlp2s0', pid: 1, startedAt: new Date().toISOString(), stateFile: trialStateFile(), logFile: trialLogFile() });
  const trial = new EventEmitter() as ChildProcess;
  (trial as any).kill = (signal: string) => { queueMicrotask(() => trial.emit('exit', signal === 'SIGUSR1' ? 0 : 1)); return true; };
  setTrialStarter(() => trial);
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tCurrent\tany\t[CURRENT]\n1\tNew WiFi\tany\t\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) return { stdout: 'OK\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=New WiFi\n', stderr: '' };
    if (cmd === 'ip') return { stdout: '3: wlp2s0 inet 10.0.0.9/24\n', stderr: '' };
    throw new Error('Unexpected command: ' + cmd);
  });
  try {
    assert.equal(await runConnectTrial({ iface: 'wlp2s0', ssid, candidate }), 0);
    const state = await readTrialState();
    assert.equal(state?.phase, 'ok');
    assert.equal(state?.saved, true);
    await assert.rejects(access(candidate), { code: 'ENOENT' });
    assert.match(await readFile(join(dir, filename), 'utf8'), /secret123/);
  } finally {
    setRunner(null); setTrialStarter(null); setTrialStateDirForTests(null);
    setNetplanDirForTests(null); setNetplanTempRootForTests(null); (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});

test('the detached worker records a rollback and saves nothing when the trial cannot select the network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-worker-fail-test-'));
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  const ssid = 'Blocked WiFi';
  const filename = '90-openwifi-wlp2s0-' + createHash('sha256').update(ssid).digest('hex').slice(0, 12) + '.yaml';
  const candidate = join(dir, 'openwifi', filename);
  await mkdir(join(dir, 'openwifi'), { recursive: true });
  await writeFile(candidate, netplanCandidate('wlp2s0', ssid, 'secret123'), { mode: 0o600 });
  setNetplanDirForTests(dir);
  setNetplanTempRootForTests(dir);
  setTrialStateDirForTests(join(dir, 'state'));
  await writeTrialState({ phase: 'starting', ssid, iface: 'wlp2s0', pid: 1, startedAt: new Date().toISOString(), stateFile: trialStateFile(), logFile: trialLogFile() });
  const trial = new EventEmitter() as ChildProcess;
  (trial as any).kill = () => { queueMicrotask(() => trial.emit('exit', 1)); return true; };
  setTrialStarter(() => trial);
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tCurrent\tany\t[CURRENT]\n1\tBlocked WiFi\tany\t\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) return { stdout: 'FAIL\n', stderr: '' };
    throw new Error('Unexpected command: ' + cmd);
  });
  try {
    assert.equal(await runConnectTrial({ iface: 'wlp2s0', ssid, candidate }), 1);
    const state = await readTrialState();
    assert.equal(state?.phase, 'rolled-back');
    assert.equal(state?.saved, false);
    assert.match(state?.error ?? '', /Could not select/);
    await assert.rejects(access(candidate), { code: 'ENOENT' });
    await assert.rejects(access(join(dir, filename)), { code: 'ENOENT' });
  } finally {
    setRunner(null); setTrialStarter(null); setTrialStateDirForTests(null);
    setNetplanDirForTests(null); setNetplanTempRootForTests(null); (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});

test('use selects an existing runtime network without writing configuration', async () => {
test('a trial worker that never starts is reported instead of looking like a running trial', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-worker-start-test-'));
  setTrialStateDirForTests(dir);
  setTrialSpawnerForTests(() => ({ pid: 7, unref: () => {} }));
  try {
    await assert.rejects(
      startDetachedTrial({ iface: 'wlp2s0', ssid: 'X', candidate: join(dir, 'candidate.yaml') }, { startTimeoutMs: 400 }),
      /did not start/);
  } finally { setTrialSpawnerForTests(null); setTrialStateDirForTests(null); await rm(dir, { recursive: true, force: true }); }
});

  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  const selected: string[] = [];
  let active = 'Airtel_tanu_0405';
  setRunner(async (cmd, args) => {
    if (cmd === 'wpa_cli' && args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tAirtel_tanu_0405\tany\t[CURRENT]\n1\tTanul\\xe2\\x80\\x99s iPhone\tany\t\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('status')) return { stdout: 'wpa_state=COMPLETED\nssid=' + (active === 'Airtel_tanu_0405' ? active : 'Tanul\\xe2\\x80\\x99s iPhone') + '\n', stderr: '' };
    if (cmd === 'wpa_cli' && args.includes('select_network')) { selected.push(args[args.length - 1]); active = 'Tanul\u2019s iPhone'; return { stdout: 'OK\n', stderr: '' }; }
    if (cmd === 'ip') return { stdout: '3: wlp2s0 inet 172.20.10.4/28\n', stderr: '' };
    throw new Error('Unexpected command: ' + cmd);
  });
  try {
    assert.deepEqual(await useNetplan('Airtel_tanu_0405', 'wlp2s0'), { ssid: 'Airtel_tanu_0405', id: '0' });
    assert.deepEqual(selected, [], 'an already-connected network needs no selection');
    assert.deepEqual(await useNetplan('Tanul\u2019s iPhone', 'wlp2s0'), { ssid: 'Tanul\u2019s iPhone', id: '1' });
    assert.deepEqual(selected, ['1']);
    await assert.rejects(useNetplan('Unknown Net', 'wlp2s0'), /not a saved network/);
  } finally { setRunner(null); (process as any).getuid = getuid; }
});

test('generated Netplan conf parsing reads netplan quoting and escaped SSID bytes', () => {
  const conf = 'ctrl_interface=/run/wpa_supplicant\n\nnetwork={\n  ssid=P"Airtel_tanu_0405"\n}\nnetwork={\n  ssid="Plain Net"\n}\nnetwork={\n  ssid=P"Tanul\\xe2\\x80\\x99s iPhone"\n}\n';
  assert.deepEqual(parseConfSsids(conf), ['Airtel_tanu_0405', 'Plain Net', 'Tanul\u2019s iPhone']);
});

test('doctor detects a generated conf left behind by an unfinished trial and --fix regenerates it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-generated-test-'));
  const getuid = process.getuid;
  (process as any).getuid = () => 0;
  setNetplanDirForTests(dir);
  setGeneratedConfDirForTests(dir);
  setNetplanTempRootForTests(dir);
  const generated = join(dir, 'wpa-wlp2s0.conf');
  await writeFile(generated, 'network={\n  ssid=P"Airtel_tanu_0405"\n}\nnetwork={\n  ssid=P"Tanul\\xe2\\x80\\x99s iPhone"\n}\n', { mode: 0o600 });
  let regenerated = false;
  setRunner(async (cmd, args) => {
    if (cmd === 'netplan' && args[0] === 'get') return { stdout: 'Airtel_tanu_0405:\n  auth:\n    key-management: psk\n    password: not-a-real-secret\n', stderr: '' };
    if (cmd === 'netplan' && args[0] === 'generate') {
      regenerated = true;
      await writeFile(generated, 'network={\n  ssid=P"Airtel_tanu_0405"\n}\n', { mode: 0o600 });
      return { stdout: '', stderr: '' };
    }
    throw new Error('Unexpected command: ' + cmd);
  });
  try {
    assert.deepEqual(await ungeneratedSsids('wlp2s0'), ['Tanul\u2019s iPhone']);
    const result = await repairGeneratedConf('wlp2s0');
    assert.equal(regenerated, true);
    assert.deepEqual(result.removed, ['Tanul\u2019s iPhone']);
    assert.deepEqual(result.remaining, []);
    assert.deepEqual(await ungeneratedSsids('wlp2s0'), []);
  } finally {
    setRunner(null); setGeneratedConfDirForTests(null); setNetplanDirForTests(null);
    setNetplanTempRootForTests(null); (process as any).getuid = getuid;
    await rm(dir, { recursive: true, force: true });
  }
});
