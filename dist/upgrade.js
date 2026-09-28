import { run } from './util.js';
import { VERSION } from './version.js';
export const UPGRADE_REPO = 'https://github.com/tanulmittal/wifi-cli.git';
export const UPGRADE_SLUG = 'github:tanulmittal/wifi-cli';
export const MANUAL_INSTALL = `sudo npm install -g ${UPGRADE_SLUG} --install-links`;
export function parseVersion(value) {
    const match = value.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match)
        return null;
    return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}
// Semver precedence: compare numbers first, then let a release outrank its own prereleases.
export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right)
        return 0;
    for (let i = 0; i < 3; i++)
        if (left.parts[i] !== right.parts[i])
            return left.parts[i] - right.parts[i];
    if (left.pre && !right.pre)
        return -1;
    if (!left.pre && right.pre)
        return 1;
    if (!left.pre && !right.pre)
        return 0;
    return comparePrerelease(left.pre, right.pre);
}
function comparePrerelease(a, b) {
    const left = a.split('.');
    const right = b.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i];
        const r = right[i];
        if (l === undefined)
            return -1;
        if (r === undefined)
            return 1;
        const lNumeric = /^\d+$/.test(l);
        const rNumeric = /^\d+$/.test(r);
        if (lNumeric && rNumeric) {
            if (Number(l) !== Number(r))
                return Number(l) - Number(r);
            continue;
        }
        if (lNumeric)
            return -1;
        if (rNumeric)
            return 1;
        if (l !== r)
            return l < r ? -1 : 1;
    }
    return 0;
}
export function newestTag(lsRemoteOutput) {
    const tags = lsRemoteOutput.split('\n')
        .map(line => (line.split('\t')[1] ?? '').trim())
        .filter(ref => ref.startsWith('refs/tags/') && !ref.endsWith('^{}'))
        .map(ref => ref.slice('refs/tags/'.length))
        .filter(tag => parseVersion(tag) !== null);
    if (!tags.length)
        return null;
    return tags.reduce((best, tag) => (compareVersions(tag, best) > 0 ? tag : best));
}
// Releases are GitHub tags. Installing the default branch would silently replace a newer beta with
// whatever main happens to be, so resolve the newest tag and refuse to move backwards.
export async function upgradeFromGithub(opts = {}) {
    const current = opts.current ?? VERSION;
    let listing;
    try {
        listing = (await run('git', ['ls-remote', '--tags', UPGRADE_REPO], { timeoutMs: 60000 })).stdout;
    }
    catch (error) {
        throw new Error(`Could not list releases from GitHub (${error instanceof Error ? error.message : String(error)}). Install manually:\n  ${MANUAL_INSTALL}`);
    }
    const target = newestTag(listing);
    if (!target)
        throw new Error(`No tagged release found for ${UPGRADE_SLUG}. Install the tested commit manually:\n  sudo npm install -g ${UPGRADE_SLUG}#<commit> --install-links`);
    if (!opts.force && compareVersions(target, current) <= 0)
        return { updated: false, from: current, to: target, manual: MANUAL_INSTALL };
    await run('npm', ['install', '-g', `${UPGRADE_SLUG}#${target}`, '--install-links'], { timeoutMs: 300000 });
    return { updated: true, from: current, to: target, manual: MANUAL_INSTALL };
}
//# sourceMappingURL=upgrade.js.map