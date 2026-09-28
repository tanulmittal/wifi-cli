import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setRunner } from '../src/util.js';
import { upgradeFromGithub } from '../src/upgrade.js';

test('Git installs use the committed bundle without npm preparation', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
    assert.equal(pkg.scripts?.[name], undefined, `${name} triggers Git dependency preparation`);
  }
  assert.equal(pkg.bin.openwifi, './dist/openwifi.cjs');
  const bundle = readFileSync(new URL('../dist/openwifi.cjs', import.meta.url), 'utf8');
  assert.ok(bundle.includes(pkg.version), 'committed bundle must match package version');
  assert.ok(bundle.includes('Netplan has no per-profile autoconnect or priority setting'), 'committed bundle must include Netplan editing');
});

test('upgrade installs the GitHub package globally with durable links', async () => {
  const calls: unknown[][] = [];
  setRunner(async (cmd, args, opts) => {
    calls.push([cmd, args, opts]);
    return { stdout: 'updated', stderr: '' };
  });
  try {
    await upgradeFromGithub();
    assert.deepEqual(calls, [['npm', ['install', '-g', 'github:tanulmittal/wifi-cli', '--install-links'], { timeoutMs: 300000 }]]);
  } finally { setRunner(null); }
});

test('upgrade reports npm failure instead of claiming success', async () => {
  setRunner(async () => { throw new Error('npm install failed'); });
  try { await assert.rejects(upgradeFromGithub(), /npm install failed/); }
  finally { setRunner(null); }
});
