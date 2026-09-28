import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNmcliWifi, parseIwNetworks, parseWpaResults } from '../src/adapters/linux.js';
import { parseAirport } from '../src/adapters/macos.js';
import { redact, isAuthError, sudoHint } from '../src/util.js';

test('nmcli parse keeps SSID with spaces, drops empty', () => {
  const nets = parseNmcliWifi('My Home:75:WPA2:AA:BB:CC:2412\n:0:::');
  assert.equal(nets.length, 1);
  assert.equal(nets[0].ssid, 'My Home');
  assert.equal(nets[0].signal, 75);
});

test('airport parse maps RSSI to 0-100', () => {
  const ssid = 'Cafe'.padEnd(33, ' ');
  const nets = parseAirport(`SSID BSSID RSSI CHANNEL HT CC SECURITY\n${ssid} aa:bb:cc:dd:ee:ff -60  6  Y  US WPA2(PSK/AES/AES)`);
  assert.equal(nets[0].ssid, 'Cafe');
  assert.ok(nets[0].signal >= 0 && nets[0].signal <= 100);
});

test('iw parse basic', () => {
  const nets = parseIwNetworks('MyWifi psk\nOpenNet open');
  assert.equal(nets.length, 2);
});

test('wpa scan results keep SSIDs with spaces and security flags', () => {
  const nets = parseWpaResults('bssid / frequency / signal level / flags / ssid\naa:bb:cc:dd:ee:ff\t2412\t-55\t[WPA2-PSK-CCMP][ESS]\tMy Home WiFi\n');
  assert.deepEqual(nets, [{ ssid: 'My Home WiFi', signal: 90, security: '[WPA2-PSK-CCMP][ESS]', bssid: 'aa:bb:cc:dd:ee:ff', freq: '2412' }]);
});

test('wpa scan decodes UTF-8 SSIDs and hides invalid all-NUL entries', () => {
  const nets = parseWpaResults('bssid / frequency / signal level / flags / ssid\naa:bb:cc:dd:ee:ff\t2412\t-55\t[WPA2-PSK]\tTanul\\xe2\\x80\\x99s iPhone\naa:bb:cc:dd:ee:00\t2412\t-90\t[WPA2-PSK]\t\\x00\\x00\n');
  assert.deepEqual(nets.map(n => n.ssid), ['Tanul’s iPhone']);
});

test('redact + auth detection + sudo hint', () => {
  assert.match(redact('connect --password secret123'), /\*\*\*/);
  assert.equal(isAuthError(new Error('Not authorized')), true);
  assert.match(sudoHint(['connect', 'My Wifi']), /sudo openwifi/);
});

import { linux, requireConnectBackend } from '../src/adapters/linux.js';
import { macos, parseSystemProfiler } from '../src/adapters/macos.js';
import { setRunner } from '../src/util.js';

test('mac scan falls back when airport is missing and uses selected interface', async () => {
  const calls: string[] = [];
  setRunner(async (cmd, args) => {
    calls.push(cmd);
    if (cmd.includes('airport')) { const e: any = new Error('missing'); e.code = 'ENOENT'; throw e; }
    return { stdout: JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [
      { _name: 'en0', spairport_airport_other_local_wireless_networks: [{ _name: 'Other' }] },
      { _name: 'en9', spairport_airport_other_local_wireless_networks: [{ _name: 'Cafe', spairport_security_mode: 'wpa2' }] },
    ] }] }), stderr: '' };
  });
  try { assert.deepEqual((await macos.scan('en9')).map(n => n.ssid), ['Cafe']); assert.equal(calls[1], 'system_profiler'); }
  finally { setRunner(null); }
});

test('mac password edit and disconnect fail before changing radio/profile', async () => {
  const calls: string[] = [];
  setRunner(async (cmd) => { calls.push(cmd); const e: any = new Error('missing'); e.code = 'ENOENT'; throw e; });
  try {
    await assert.rejects(macos.edit('Cafe', { newPassword: 'secret' }), /not supported/);
    await assert.rejects(macos.disconnect(), /Use openwifi off/);
    assert.deepEqual(calls, ['/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport']);
  } finally { setRunner(null); }
});

test('linux command paths build expected nmcli invocations', async () => {
  const calls: string[][] = [];
  setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'which') return { stdout: '/usr/bin/nmcli', stderr: '' };
    if (args.includes('list')) return { stdout: 'Cafe:70:WPA2\n', stderr: '' };
    if (args.includes('status')) return { stdout: 'wlan0:wifi:connected:Cafe\n', stderr: '' };
    if (args.includes('show')) return { stdout: 'Cafe:uuid:802-11-wireless\n', stderr: '' };
    return { stdout: '', stderr: '' };
  });
  try {
    assert.equal((await linux.scan())[0].ssid, 'Cafe');
    await linux.connect('Cafe', { password: 'secret' });
    assert.equal((await linux.list())[0].name, 'Cafe');
    await linux.status();
    await linux.disconnect();
    await linux.forget('Cafe');
    await linux.edit('Cafe', { autoconnect: 'off', priority: 1, rename: 'New' });
    await linux.radio(true); await linux.radio(false); await linux.doctor();
    assert.ok(calls.some(c => c.includes('connect')));
    assert.ok(calls.some(c => c.includes('delete')));
    assert.ok(calls.some(c => c.includes('modify')));
    assert.ok(calls.some(c => c.includes('radio')));
    await assert.rejects(linux.connect('Cafe', { save: false }), /not supported/);
  } finally { setRunner(null); }
});

test('mac command paths build expected networksetup invocations', async () => {
  const calls: string[][] = [];
  setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { stdout: cmd === 'networksetup' && args.includes('-listpreferredwirelessnetworks') ? 'Preferred networks on en0:\n\tCafe\n' : 'Wi-Fi Power (en0): On', stderr: '' };
  });
  try {
    assert.equal((await macos.list())[0].name, 'Cafe');
    await macos.status();
    await macos.connect('Cafe', { password: 'secret' });
    await macos.forget('Cafe');
    await macos.radio(true); await macos.radio(false);
    assert.ok(calls.some(c => c.includes('-setairportnetwork')));
    assert.ok(calls.some(c => c.includes('-removepreferredwirelessnetwork')));
    await assert.rejects(macos.connect('Cafe', { save: false }), /not supported/);
    await assert.rejects(macos.connect('Cafe', { hidden: true }), /not supported/);
  } finally { setRunner(null); }
});

test('system profiler ignores redacted SSIDs', () => {
  const input = JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [{ _name: 'en0', spairport_airport_other_local_wireless_networks: [{ _name: '<redacted>' }] }] }] });
  assert.deepEqual(parseSystemProfiler(input, 'en0'), []);
});

test('missing Linux backend blocks connection before asking for credentials or changing state', async () => {
  const calls: string[] = [];
  setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    throw new Error('command not found');
  });
  try {
    await assert.rejects(requireConnectBackend(), /No WiFi manager found/);
    await assert.rejects(linux.connect('Example', { password: 'secret' }), /No WiFi manager found/);
    assert.ok(calls.every(c => c.startsWith('which ')));
  } finally { setRunner(null); }
});

test('wpa_supplicant is detected for status/scan and writes fail before changing state', async () => {
  const calls: string[][] = [];
  setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'which') {
      if (args[0] === 'wpa_cli') return { stdout: '/usr/sbin/wpa_cli', stderr: '' };
      throw new Error('missing');
    }
    if (args.includes('status')) return { stdout: 'ssid=My Home\nwpa_state=COMPLETED\n', stderr: '' };
    if (args.includes('list_networks')) return { stdout: 'network id / ssid / bssid / flags\n0\tMy Home\tany\t[CURRENT]\n', stderr: '' };
    if (args.includes('scan_results')) return { stdout: 'bssid / frequency / signal level / flags / ssid\naa:bb:cc:dd:ee:ff\t2412\t-60\t[WPA2-PSK]\tMy Home\n', stderr: '' };
    if (args.includes('scan')) return { stdout: 'OK\n', stderr: '' };
    throw new Error(`Unexpected command: ${cmd}`);
  });
  try {
    assert.deepEqual(await linux.status('wlp2s0'), { backend: 'wpa_cli', state: 'COMPLETED', ssid: 'My Home', bssid: '', frequency: '' });
    assert.equal((await linux.scan('wlp2s0'))[0].ssid, 'My Home');
    const checks = await linux.doctor('wlp2s0');
    assert.equal(checks.find(c => c.name === 'connection')?.ok, true);
    await assert.rejects(linux.connect('Other', { password: 'secret' }), /Connecting needs NetworkManager/);
    assert.equal((await linux.list('wlp2s0'))[0].name, 'My Home');
    await assert.rejects(linux.disconnect('wlp2s0'), /Disconnect needs NetworkManager/);
    await assert.rejects(linux.forget('My Home'), /Forget needs NetworkManager/);
    await assert.rejects(linux.radio(false), /Changing radio power needs NetworkManager/);
    assert.equal(calls.filter(([cmd]) => cmd !== 'which' && cmd !== 'wpa_cli').length, 0);
  } finally { setRunner(null); }
});
