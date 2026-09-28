import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { netplanCandidate, parseWpaNetworks, setTrialStarter, tryNetplanConnection } from '../src/adapters/netplan.js';
import { setRunner } from '../src/util.js';

test('Netplan candidate contains one target AP and WPA credentials in system format', () => {
  const candidate = JSON.parse(netplanCandidate('wlp2s0', "Tanul's iPhone", 'secret123', true));
  assert.deepEqual(candidate, { network: { version: 2, wifis: { wlp2s0: { 'access-points': { "Tanul's iPhone": { password: 'secret123', hidden: true } } } } } });
  assert.deepEqual(parseWpaNetworks('network id / ssid / bssid / flags\n0\tCurrent\tany\t[CURRENT]\n1\tNew WiFi\tany\t\n'), [{ id: '0', ssid: 'Current' }, { id: '1', ssid: 'New WiFi' }]);
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
