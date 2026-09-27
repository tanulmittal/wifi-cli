import test from 'node:test';
import assert from 'node:assert/strict';
import { setRunner } from '../src/util.js';
import { upgradeFromGithub } from '../src/upgrade.js';

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
