import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { connectNetplan, forgetNetplan, isOpenwifiProfile, netplanCandidate, parseWpaNetworks, removeNewTrialCopies, requireNetplanForget, setNetplanDirForTests, setTrialStarter, tryNetplanConnection } from '../src/adapters/netplan.js';
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
    await assert.rejects(connectNetplan('Tanul’s iPhone', { iface: 'wlp2s0', password: 'secret123' }), /already configured/);
    assert.deepEqual(calls.map(call => call.split(' ')[0]), ['netplan', 'wpa_cli', 'wpa_cli']);
  } finally { setRunner(null); setTrialStarter(null); (process as any).getuid = getuid; }
});

test('Netplan forget recognizes and removes a beta.1 escaped-SSID profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openwifi-legacy-test-'));
  const ssid = 'Tanul’s iPhone';
  const escaped = 'Tanul\\xe2\\x80\\x99s iPhone';
  const file = join(dir, `90-openwifi-wlp2s0-${createHash('sha256').update(escaped).digest('hex').slice(0, 12)}.yaml`);
  const stamped = file.replace(/\.yaml$/, '.1790580022.1488316.yaml');
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
  const created = saved.replace(/\.yaml$/, '.1790580001.200.yaml');
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
