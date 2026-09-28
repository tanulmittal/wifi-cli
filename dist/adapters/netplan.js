import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { run, failClosed } from '../util.js';
import { decodeWpaSsid, validWpaSsid } from './wpa.js';
let startTrial = (args) => spawn('netplan', args, { stdio: ['pipe', 'ignore', 'ignore'] });
let netplanDir = '/etc/netplan';
// Test hook: network-changing trials are never run in the test process.
export function setTrialStarter(start) {
    startTrial = start ?? ((args) => spawn('netplan', args, { stdio: ['pipe', 'ignore', 'ignore'] }));
}
export function setNetplanDirForTests(dir) { netplanDir = dir ?? '/etc/netplan'; }
export function netplanCandidate(iface, ssid, password, hidden = false) {
    const profile = password ? { password, ...(hidden ? { hidden: true } : {}) } : hidden ? { hidden: true } : {};
    return JSON.stringify({ network: { version: 2, wifis: { [iface]: { 'access-points': { [ssid]: profile } } } } }, null, 2) + '\n';
}
export function parseWpaNetworks(text) {
    return text.split('\n').map(line => {
        const [id, ssid] = line.replace(/\r$/, '').split('\t');
        const decoded = decodeWpaSsid(ssid ?? '');
        return /^\d+$/.test(id ?? '') && validWpaSsid(decoded) ? { id, ssid: decoded } : null;
    }).filter((item) => item !== null);
}
export async function tryNetplanConnection(candidate, iface, ssid) {
    const trial = startTrial(['try', '--config-file', candidate, '--timeout', '90']);
    let ended = false;
    const exited = new Promise((resolve) => {
        trial.once('error', () => { ended = true; resolve(1); });
        trial.once('exit', (code) => { ended = true; resolve(code ?? 1); });
    });
    try {
        let networkId;
        for (let attempt = 0; attempt < 30 && !ended; attempt++) {
            await delay(1000);
            const networks = await wpa(iface, 'list_networks').then(parseWpaNetworks).catch(() => []);
            networkId = networks.find(n => n.ssid === ssid)?.id;
            if (networkId)
                break;
        }
        if (!networkId)
            throw new Error(`Netplan did not make "${ssid}" available. The trial will be rolled back.`);
        if (!(await wpa(iface, 'select_network', networkId)).endsWith('OK'))
            throw new Error(`Could not select "${ssid}". The trial will be rolled back.`);
        let connected = false;
        let verifiedTwice = false;
        for (let attempt = 0; attempt < 45 && !ended; attempt++) {
            await delay(1000);
            const status = await wpa(iface, 'status').catch(() => '');
            if (status.includes('wpa_state=COMPLETED') && status.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid)) {
                const address = await run('ip', ['-4', '-o', 'addr', 'show', 'dev', iface]).then(r => r.stdout).catch(() => '');
                if (/\binet\s+\d/.test(address)) {
                    if (verifiedTwice) {
                        connected = true;
                        break;
                    }
                    verifiedTwice = true;
                    continue;
                }
            }
            verifiedTwice = false;
        }
        if (!connected)
            throw new Error(`Could not confirm "${ssid}" with an IP address. The trial will be rolled back.`);
        if (!trial.kill('SIGUSR1'))
            throw new Error('Netplan trial exited before confirmation; nothing was saved.');
        const result = await exited;
        if (result !== 0)
            throw new Error('Netplan did not confirm the connection; nothing was saved.');
    }
    catch (e) {
        if (!ended) {
            trial.kill('SIGINT');
            await exited.catch(() => { });
        }
        throw e;
    }
}
async function wifiInterface(requested) {
    if (requested) {
        if (!/^[a-zA-Z0-9_-]+$/.test(requested))
            failClosed('Invalid WiFi interface name');
        return requested;
    }
    const names = await readdir('/sys/class/net');
    const wireless = (await Promise.all(names.map(async (name) => {
        try {
            await access(`/sys/class/net/${name}/wireless`);
            return name;
        }
        catch {
            return null;
        }
    }))).filter((name) => name !== null);
    if (wireless.length !== 1)
        failClosed('Choose a WiFi interface with --interface (run: ip -br link)');
    return wireless[0];
}
async function wpa(iface, command, arg) {
    const { stdout } = await run('wpa_cli', ['-i', iface, command, ...(arg ? [arg] : [])], { timeoutMs: 8000 });
    return stdout.trim();
}
function profilePath(iface, ssid) {
    return `${netplanDir}/90-openwifi-${iface}-${createHash('sha256').update(ssid).digest('hex').slice(0, 12)}.yaml`;
}
async function removableProfilePath(iface, ssid) {
    const saved = profilePath(iface, ssid);
    try {
        await access(saved);
        return saved;
    }
    catch { /* Check beta.1's escaped-SSID format. */ }
    const escaped = ssid.replace(/[^\x00-\x7f]/gu, character => [...Buffer.from(character)].map(byte => `\\x${byte.toString(16).padStart(2, '0')}`).join(''));
    if (escaped === ssid)
        return null;
    const legacy = profilePath(iface, escaped);
    try {
        const data = JSON.parse(await readFile(legacy, 'utf8'));
        return Object.hasOwn(data?.network?.wifis?.[iface]?.['access-points'] ?? {}, escaped) ? legacy : null;
    }
    catch {
        return null;
    }
}
export async function isOpenwifiProfile(ssid, iface) {
    try {
        return !!await removableProfilePath(await wifiInterface(iface), ssid);
    }
    catch {
        return false;
    }
}
export async function requireNetplanForget(ssid, iface) {
    if (process.getuid?.() !== 0)
        throw new Error('Forgetting a Netplan network requires root privileges');
    const device = await wifiInterface(iface);
    const saved = await removableProfilePath(device, ssid);
    if (!saved)
        failClosed(`"${ssid}" is managed by existing Netplan configuration. openwifi can only forget networks it added; edit its /etc/netplan YAML from the physical console`);
    const status = await wpa(device, 'status');
    if (status.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid)) {
        failClosed(`"${ssid}" is the current connection. Connect to another network before forgetting it`);
    }
    return saved;
}
export async function forgetNetplan(ssid, iface) {
    const saved = await requireNetplanForget(ssid, iface);
    await unlink(saved);
}
export async function connectNetplan(ssid, options = {}) {
    if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32 || /[\0\n\r]/.test(ssid))
        failClosed('WiFi name must be one non-empty line of at most 32 bytes');
    if (options.password && (options.password.length < 8 || options.password.length > 63 || /[\x00-\x1f\x7f]/.test(options.password)))
        failClosed('WPA password must be 8–63 printable characters');
    if (options.save === false)
        failClosed('Temporary Netplan connections are not supported');
    if (process.getuid?.() !== 0)
        throw new Error('Connecting through Netplan requires root privileges');
    const iface = await wifiInterface(options.iface);
    const { stdout: configured } = await run('netplan', ['get', `wifis.${iface}`]);
    if (!configured.trim() || configured.trim() === 'null')
        failClosed(`${iface} is not configured by Netplan`);
    const current = await wpa(iface, 'status');
    if (!current.includes('wpa_state=COMPLETED'))
        failClosed('Current WiFi is not connected; use the system console to repair it first');
    if (current.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid))
        return;
    const existing = parseWpaNetworks(await wpa(iface, 'list_networks'));
    if (existing.some(network => network.ssid === ssid)) {
        failClosed(`"${ssid}" is already configured in wpa_supplicant. openwifi cannot safely reselect a stored Netplan network during a trial; no profile was added`);
    }
    const scans = await wpa(iface, 'scan_results').catch(() => '');
    const match = scans.split('\n').slice(1).map(line => line.split('\t')).find(fields => decodeWpaSsid(fields.slice(4).join('\t')) === ssid);
    const flags = match?.[3] ?? '';
    if (/EAP|802\.1X/i.test(flags) || (/SAE/i.test(flags) && !/PSK/i.test(flags)))
        failClosed('Enterprise and WPA3-only networks need a separate authentication setup');
    if (/WPA|RSN/i.test(flags) && !options.password)
        failClosed(`"${ssid}" needs a password`);
    const saved = profilePath(iface, ssid);
    const filename = saved.slice(netplanDir.length + 1);
    try {
        await access(saved);
        failClosed(`A profile for "${ssid}" already exists; edit the saved network instead`);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const tempDir = await mkdtemp('/run/openwifi-');
    const candidate = `${tempDir}/${filename}`;
    try {
        await writeFile(candidate, netplanCandidate(iface, ssid, options.password, options.hidden), { mode: 0o600, flag: 'wx' });
        await tryNetplanConnection(candidate, iface, ssid);
        try {
            await copyFile(candidate, saved, constants.COPYFILE_EXCL);
        }
        catch (error) {
            throw new Error(`Connected to "${ssid}" but could not save it for reboot: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}
//# sourceMappingURL=netplan.js.map