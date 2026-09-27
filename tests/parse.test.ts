import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNmcliWifi, parseIwNetworks } from '../src/adapters/linux.js';
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

test('redact + auth detection + sudo hint', () => {
  assert.match(redact('connect --password secret123'), /\*\*\*/);
  assert.equal(isAuthError(new Error('Not authorized')), true);
  assert.match(sudoHint(['connect', 'My Wifi']), /sudo openwifi/);
});
