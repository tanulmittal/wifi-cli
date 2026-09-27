import { run } from './util.js';

export async function upgradeFromGithub(): Promise<void> {
  await run('npm', ['install', '-g', 'github:tanulmittal/wifi-cli', '--install-links'], { timeoutMs: 300000 });
}
