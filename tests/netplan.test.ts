import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { forgetNetplan, netplanCandidate, parseWpaNetworks, requireNetplanForget, setNetplanDirForTests, setTrialStarter, tryNetplanConnection } from '../src/adapters/netplan.js';
import { setRunner } from '../src/util.js';

test('Netplan candidate contains one target AP and WPA credentials in system format', () => {
  const candidate = JSON.parse(netplanCandidate('wlp2s0', "Tanul's iPhone", 'secret123', true));
  assert.deepEqual(candidate, { network: { version: 2, wifis: { wlp2s0: { 'access-points': { "Tanul's iPhone": { password: 'secret123', hidden: true } } } } } });
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
    throw new Error('Unexpected command');
  });
  try {
    await assert.rejects(requireNetplanForget('Unmanaged', 'wlp2s0'), /only forget networks it added/);
    await writeFile(file, 'test', { mode: 0o600 });
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
