import { run } from './util.js';
export async function upgradeFromGithub() {
    await run('npm', ['install', '-g', 'github:tanulmittal/wifi-cli', '--install-links'], { timeoutMs: 300000 });
}
//# sourceMappingURL=upgrade.js.map