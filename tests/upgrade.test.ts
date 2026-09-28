import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setRunner } from '../src/util.js';
import { compareVersions, newestTag, upgradeFromGithub, UPGRADE_SLUG } from '../src/upgrade.js';
import { VERSION } from '../src/version.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Git installs use the committed bundle without npm preparation', () => {
  for (const name of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
    assert.equal(pkg.scripts?.[name], undefined, `${name} triggers Git dependency preparation`);
  }
  assert.equal(pkg.bin.openwifi, './dist/openwifi.cjs');
  assert.equal(VERSION, pkg.version, 'src/version.ts must track package.json');
  const bundle = readFileSync(new URL('../dist/openwifi.cjs', import.meta.url), 'utf8');
  assert.ok(bundle.includes(pkg.version), 'committed bundle must match package version');
  assert.ok(bundle.includes('Netplan has no per-profile autoconnect or priority setting'), 'committed bundle must include Netplan editing');
});

test('upgrade installs the newest tagged release instead of the default branch', async () => {
  const calls: unknown[][] = [];
  setRunner(async (cmd, args, opts) => {
    calls.push([cmd, args, opts]);
    if (cmd === 'git') return { stdout: 'aaa\trefs/tags/v0.2.0-beta.6\nbbb\trefs/tags/v0.2.0-beta.8\nccc\trefs/tags/v0.1.4\n', stderr: '' };
    return { stdout: 'updated', stderr: '' };
  });
  try {
    const result = await upgradeFromGithub({ current: '0.2.0-beta.7' });
    assert.equal(result.updated, true);
    assert.equal(result.to, 'v0.2.0-beta.8');
    assert.deepEqual(calls[1], ['npm', ['install', '-g', `${UPGRADE_SLUG}#v0.2.0-beta.8`, '--install-links'], { timeoutMs: 300000 }]);
  } finally { setRunner(null); }
});

test('upgrade refuses to replace a newer installed version without --force', async () => {
  const calls: string[] = [];
  setRunner(async (cmd) => { calls.push(cmd); return { stdout: 'aaa\trefs/tags/v0.1.4\n', stderr: '' }; });
  try {
    const result = await upgradeFromGithub({ current: '0.2.0-beta.8' });
    assert.equal(result.updated, false);
    assert.deepEqual(calls, ['git'], 'npm must not run when nothing is newer');
  } finally { setRunner(null); }
});

test('upgrade fails clearly when releases cannot be listed', async () => {
  setRunner(async (cmd) => {
    if (cmd === 'git') throw new Error('git not found');
    throw new Error('npm must not run');
  });
  try { await assert.rejects(upgradeFromGithub(), /Install manually/); }
  finally { setRunner(null); }
});

test('upgrade reports npm failure instead of claiming success', async () => {
  setRunner(async (cmd) => {
    if (cmd === 'git') return { stdout: 'aaa\trefs/tags/v9.9.9\n', stderr: '' };
    throw new Error('npm install failed');
  });
  try { await assert.rejects(upgradeFromGithub(), /npm install failed/); }
  finally { setRunner(null); }
});

test('tag selection orders prereleases below their release and ignores non-versions', () => {
  assert.ok(compareVersions('0.2.0', '0.2.0-beta.8') > 0);
  assert.ok(compareVersions('0.2.0-beta.8', '0.2.0-beta.7') > 0);
  assert.ok(compareVersions('0.2.0-beta.10', '0.2.0-beta.9') > 0);
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(newestTag('x\trefs/tags/v0.1.0\ny\trefs/tags/latest\n'), 'v0.1.0');
  assert.equal(newestTag(''), null);
});
