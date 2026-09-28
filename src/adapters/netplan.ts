import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import { setTimeout as delay } from 'node:timers/promises';
import { run, failClosed } from '../util.js';
import { decodeWpaSsid, validWpaSsid } from './wpa.js';

let startTrial = (args: string[]): ChildProcess => spawn('netplan', args, { stdio: ['pipe', 'ignore', 'ignore'] });
let netplanDir = '/etc/netplan';
let tempRoot = '/run';
// Test hook: network-changing trials are never run in the test process.
export function setTrialStarter(start: typeof startTrial | null) {
  startTrial = start ?? ((args) => spawn('netplan', args, { stdio: ['pipe', 'ignore', 'ignore'] }));
}
export function setNetplanDirForTests(dir: string | null) { netplanDir = dir ?? '/etc/netplan'; }
export function setNetplanTempRootForTests(dir: string | null) { tempRoot = dir ?? '/run'; }

export function netplanCandidate(iface: string, ssid: string, password?: string, hidden = false): string {
  const profile = password ? { password, ...(hidden ? { hidden: true } : {}) } : hidden ? { hidden: true } : {};
  return JSON.stringify({ network: { version: 2, wifis: { [iface]: { 'access-points': { [ssid]: profile } } } } }, null, 2) + '\n';
}

export function parseWpaNetworks(text: string): { id: string; ssid: string }[] {
  return text.split('\n').map(line => {
    const [id, ssid] = line.replace(/\r$/, '').split('\t');
    const decoded = decodeWpaSsid(ssid ?? '');
    return /^\d+$/.test(id ?? '') && validWpaSsid(decoded) ? { id, ssid: decoded } : null;
  }).filter((item): item is { id: string; ssid: string } => item !== null);
}

export async function tryNetplanConnection(candidate: string, iface: string, ssid: string, forceReconnect = false, expectedPassword?: string): Promise<void> {
  const trial = startTrial(['try', '--config-file', candidate, '--timeout', '90']);
  let ended = false;
  const exited = new Promise<number>((resolve) => {
    trial.once('error', () => { ended = true; resolve(1); });
    trial.once('exit', (code) => { ended = true; resolve(code ?? 1); });
  });
  try {
    let networkId: string | undefined;
    for (let attempt = 0; attempt < 30 && !ended; attempt++) {
      await delay(1000);
      const networks = await wpa(iface, 'list_networks').then(parseWpaNetworks).catch(() => []);
      const matches = networks.filter(n => n.ssid === ssid);
      if (forceReconnect && matches.length > 1) throw new Error(`Netplan created duplicate entries for "${ssid}"; the trial will be rolled back.`);
      networkId = matches[0]?.id;
      if (networkId && expectedPassword) {
        const configuredPsk = await wpa(iface, 'get_network', networkId, 'psk').catch(() => '');
        const hex = pbkdf2Sync(expectedPassword, ssid, 4096, 32, 'sha1').toString('hex');
        if (configuredPsk !== `"${expectedPassword}"` && configuredPsk.toLowerCase() !== hex) networkId = undefined;
      }
      if (networkId) break;
    }
    if (!networkId) throw new Error(`Netplan did not make "${ssid}" available. The trial will be rolled back.`);
    if (forceReconnect && (await wpa(iface, 'disconnect')) !== 'OK') throw new Error('Could not force a fresh WiFi authentication; the trial will be rolled back.');
    if (!(await wpa(iface, 'select_network', networkId)).endsWith('OK')) throw new Error(`Could not select "${ssid}". The trial will be rolled back.`);

    let connected = false;
    let verifiedTwice = false;
    for (let attempt = 0; attempt < 45 && !ended; attempt++) {
      await delay(1000);
      const status = await wpa(iface, 'status').catch(() => '');
      if (status.includes('wpa_state=COMPLETED') && status.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid)) {
        const address = await run('ip', ['-4', '-o', 'addr', 'show', 'dev', iface]).then(r => r.stdout).catch(() => '');
        if (/\binet\s+\d/.test(address)) {
          if (verifiedTwice) { connected = true; break; }
          verifiedTwice = true;
          continue;
        }
      }
      verifiedTwice = false;
    }
    if (!connected) throw new Error(`Could not confirm "${ssid}" with an IP address. The trial will be rolled back.`);
    if (!trial.kill('SIGUSR1')) throw new Error('Netplan trial exited before confirmation; nothing was saved.');
    const result = await exited;
    if (result !== 0) throw new Error('Netplan did not confirm the connection; nothing was saved.');
  } catch (e) {
    if (!ended) { trial.kill('SIGINT'); await exited.catch(() => {}); }
    throw e;
  }
}

async function wifiInterface(requested?: string): Promise<string> {
  if (requested) {
    if (!/^[a-zA-Z0-9_-]+$/.test(requested)) failClosed('Invalid WiFi interface name');
    return requested;
  }
  const names = await readdir('/sys/class/net');
  const wireless = (await Promise.all(names.map(async name => {
    try { await access(`/sys/class/net/${name}/wireless`); return name; } catch { return null; }
  }))).filter((name): name is string => name !== null);
  if (wireless.length !== 1) failClosed('Choose a WiFi interface with --interface (run: ip -br link)');
  return wireless[0];
}

async function wpa(iface: string, command: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('wpa_cli', ['-i', iface, command, ...args], { timeoutMs: 8000 });
  return stdout.trim();
}

function profilePath(iface: string, ssid: string): string {
  return `${netplanDir}/90-openwifi-${iface}-${createHash('sha256').update(ssid).digest('hex').slice(0, 12)}.yaml`;
}

function trialName(saved: string, name: string): boolean {
  const basename = saved.slice(netplanDir.length + 1);
  const stem = basename.slice(0, -'.yaml'.length);
  return [basename, stem].some(prefix => name.startsWith(`${prefix}.`) && /^\d+\.\d+\.yaml$/.test(name.slice(prefix.length + 1)));
}

async function trialCopies(saved: string): Promise<string[]> {
  return (await readdir(netplanDir)).filter(name => trialName(saved, name)).map(name => `${netplanDir}/${name}`);
}

export async function removeNewTrialCopies(saved: string, content: string, previous: Set<string>): Promise<void> {
  for (const path of await trialCopies(saved)) {
    if (!previous.has(path) && await readFile(path, 'utf8') === content) await unlink(path);
  }
}

async function removableProfilePaths(iface: string, ssid: string): Promise<string[]> {
  const escaped = ssid.replace(/[^\x00-\x7f]/gu, character => [...Buffer.from(character)].map(byte => `\\x${byte.toString(16).padStart(2, '0')}`).join(''));
  const profiles = [ssid, ...(escaped === ssid ? [] : [escaped])];
  const paths: string[] = [];
  for (const name of profiles) {
    const saved = profilePath(iface, name);
    for (const path of [saved, ...await trialCopies(saved)]) {
      try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        if (Object.hasOwn(data?.network?.wifis?.[iface]?.['access-points'] ?? {}, name)) paths.push(path);
      } catch { /* Ignore unrelated or unreadable files. */ }
    }
  }
  return paths;
}

export async function isOpenwifiProfile(ssid: string, iface?: string): Promise<boolean> {
  try { return (await removableProfilePaths(await wifiInterface(iface), ssid)).length > 0; }
  catch { return false; }
}

export async function requireNetplanForget(ssid: string, iface?: string): Promise<string[]> {
  if (process.getuid?.() !== 0) throw new Error('Forgetting a Netplan network requires root privileges');
  const device = await wifiInterface(iface);
  const saved = await removableProfilePaths(device, ssid);
  if (!saved.length) failClosed(`"${ssid}" is managed by existing Netplan configuration. openwifi can only forget networks it added; edit its /etc/netplan YAML from the physical console`);
  const status = await wpa(device, 'status');
  if (status.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid)) {
    failClosed(`"${ssid}" is the current connection. Connect to another network before forgetting it`);
  }
  return saved;
}

export async function forgetNetplan(ssid: string, iface?: string): Promise<void> {
  const device = await wifiInterface(iface);
  for (const saved of await requireNetplanForget(ssid, device)) await unlink(saved);
  try {
    const listed = await wpa(device, 'list_networks');
    for (const line of listed.split('\n')) {
      const [id, rawSsid, , flags] = line.split('\t');
      if (/^\d+$/.test(id ?? '') && decodeWpaSsid(rawSsid ?? '') === ssid) {
        if (flags?.includes('[CURRENT]')) throw new Error('the network became active');
        if (!(await wpa(device, 'remove_network', id)).endsWith('OK')) throw new Error('wpa_supplicant refused to remove the entry');
      }
    }
  } catch (error) {
    throw new Error(`Saved Netplan files were removed, but the runtime entry may remain: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function connectNetplan(ssid: string, options: { password?: string; hidden?: boolean; iface?: string; save?: boolean } = {}): Promise<void> {
  if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32 || /[\0\n\r]/.test(ssid)) failClosed('WiFi name must be one non-empty line of at most 32 bytes');
  if (options.password && (options.password.length < 8 || options.password.length > 63 || /[\x00-\x1f\x7f]/.test(options.password))) failClosed('WPA password must be 8–63 printable characters');
  if (options.save === false) failClosed('Temporary Netplan connections are not supported');
  if (process.getuid?.() !== 0) throw new Error('Connecting through Netplan requires root privileges');

  const iface = await wifiInterface(options.iface);
  const { stdout: configured } = await run('netplan', ['get', `wifis.${iface}`]);
  if (!configured.trim() || configured.trim() === 'null') failClosed(`${iface} is not configured by Netplan`);
  const current = await wpa(iface, 'status');
  if (!current.includes('wpa_state=COMPLETED')) failClosed('Current WiFi is not connected; use the system console to repair it first');
  if (current.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid)) return;
  const existing = parseWpaNetworks(await wpa(iface, 'list_networks'));
  if (existing.some(network => network.ssid === ssid)) {
    failClosed(`"${ssid}" is already configured in wpa_supplicant. openwifi cannot safely reselect a stored Netplan network during a trial; no profile was added`);
  }
  const scans = await wpa(iface, 'scan_results').catch(() => '');
  const match = scans.split('\n').slice(1).map(line => line.split('\t')).find(fields => decodeWpaSsid(fields.slice(4).join('\t')) === ssid);
  const flags = match?.[3] ?? '';
  if (/EAP|802\.1X/i.test(flags) || (/SAE/i.test(flags) && !/PSK/i.test(flags))) failClosed('Enterprise and WPA3-only networks need a separate authentication setup');
  if (/WPA|RSN/i.test(flags) && !options.password) failClosed(`"${ssid}" needs a password`);

  const saved = profilePath(iface, ssid);
  const filename = saved.slice(netplanDir.length + 1);
  try { await access(saved); failClosed(`A profile for "${ssid}" already exists; edit the saved network instead`); }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; }

  const candidateContent = netplanCandidate(iface, ssid, options.password, options.hidden);
  const previous = new Set(await trialCopies(saved));
  const tempDir = await mkdtemp('/run/openwifi-');
  const candidate = `${tempDir}/${filename}`;
  try {
    await writeFile(candidate, candidateContent, { mode: 0o600, flag: 'wx' });
    await tryNetplanConnection(candidate, iface, ssid);
    try { await copyFile(candidate, saved, constants.COPYFILE_EXCL); }
    catch (error) { throw new Error(`Connected to "${ssid}" but could not save it for reboot: ${error instanceof Error ? error.message : String(error)}`); }
  } finally {
    try { await removeNewTrialCopies(saved, candidateContent, previous); }
    finally { await rm(tempDir, { recursive: true, force: true }); }
  }
}

async function prepareEditedYaml(dir: string, iface: string, ssid: string, changes: { newPassword?: string; rename?: string }): Promise<{ source: string; original: string; content: string; redundant: string[] }> {
  const matches: { source: string; original: string; doc: ReturnType<typeof parseDocument> }[] = [];
  const path = ['network', 'wifis', iface, 'access-points'];
  let duplicateTarget = false;
  for (const name of (await readdir(dir)).filter(name => /\.ya?ml$/.test(name))) {
    const source = join(dir, name);
    if (!(await lstat(source)).isFile()) continue;
    const original = await readFile(source, 'utf8');
    const doc = parseDocument(original, { uniqueKeys: true });
    if (doc.errors.length) failClosed(`Cannot parse Netplan source ${name}`);
    if (doc.hasIn([...path, ssid])) matches.push({ source, original, doc });
    if (changes.rename && changes.rename !== ssid && doc.hasIn([...path, changes.rename])) duplicateTarget = true;
  }
  if (duplicateTarget) failClosed(`"${changes.rename}" already exists in Netplan configuration`);
  const stable = matches.find(item => !matches.some(other => other !== item && trialName(other.source, item.source.slice(dir.length + 1))));
  if (!stable || !matches.length) failClosed(`Expected an editable Netplan source for "${ssid}"`);
  const redundant = matches.filter(item => item !== stable);
  if (redundant.some(item => item.original !== stable.original || !trialName(stable.source, item.source.slice(dir.length + 1)))) {
    failClosed(`"${ssid}" appears in multiple different Netplan files; edit it from the physical console`);
  }
  const { source, original, doc } = stable;
  const points = doc.getIn(path, true);
  if (!isMap(points)) failClosed('The Netplan access-points setting is not a mapping');
  const target = changes.rename ?? ssid;
  if (target !== ssid) {
    if (points.has(target)) failClosed(`"${target}" already exists in the Netplan source`);
    const pair = points.items.find(item => isScalar(item.key) && item.key.value === ssid);
    if (!pair || !isScalar(pair.key)) failClosed('Cannot safely rename this Netplan access point');
    pair.key.value = target;
  }
  if (changes.newPassword !== undefined) {
    if (!isMap(points.get(target, true))) failClosed('Cannot safely edit this Netplan access point');
    doc.setIn([...path, target, 'password'], changes.newPassword);
  }
  return { source, original, content: String(doc), redundant: redundant.map(item => item.source) };
}

export async function editNetplan(ssid: string, changes: { newPassword?: string; autoconnect?: 'on' | 'off'; priority?: number; rename?: string }, requestedIface?: string): Promise<void> {
  if (changes.autoconnect !== undefined || changes.priority !== undefined) failClosed('Netplan has no per-profile autoconnect or priority setting');
  if (!changes.newPassword && !changes.rename) failClosed('Nothing to edit');
  if (changes.newPassword && (changes.newPassword.length < 8 || changes.newPassword.length > 63 || /[\x00-\x1f\x7f]/.test(changes.newPassword))) failClosed('WPA password must be 8–63 printable characters');
  if (changes.rename && (!changes.rename.trim() || Buffer.byteLength(changes.rename, 'utf8') > 32 || /[\0\n\r]/.test(changes.rename))) failClosed('WiFi name must be one non-empty line of at most 32 bytes');
  if (process.getuid?.() !== 0) throw new Error('Editing a Netplan profile requires root privileges');
  const iface = await wifiInterface(requestedIface);
  const target = changes.rename ?? ssid;
  if (target !== ssid) {
    const existing = parseWpaNetworks(await wpa(iface, 'list_networks'));
    if (existing.some(network => network.ssid === target)) failClosed('The new SSID is already configured');
  }
  const tempDir = await mkdtemp(join(tempRoot, 'openwifi-edit-'));
  const candidate = join(tempDir, `zzzz-openwifi-edit-${process.pid}.yaml`);
  try {
    const { source, original, content, redundant } = await prepareEditedYaml(netplanDir, iface, ssid, changes);
    const info = await stat(source);
    if ((info.mode & 0o077) !== 0) failClosed('Netplan source permissions are too broad for a password edit');
    await writeFile(candidate, content, { mode: 0o600, flag: 'wx' });
    await chmod(candidate, info.mode & 0o777);
    const checkDir = join(tempDir, 'etc/netplan');
    await mkdir(checkDir, { recursive: true, mode: 0o700 });
    for (const filename of (await readdir(netplanDir)).filter(name => name.endsWith('.yaml') && !redundant.includes(join(netplanDir, name)))) {
      await copyFile(join(netplanDir, filename), join(checkDir, filename));
    }
    await copyFile(candidate, join(checkDir, source.slice(netplanDir.length + 1)));
    await run('netplan', ['generate', `--root-dir=${tempDir}`], { secrets: changes.newPassword ? [changes.newPassword] : [] });
    for (const file of redundant) {
      if (await readFile(file, 'utf8') !== original) throw new Error('A duplicate Netplan profile changed during validation; no edit was applied');
      await unlink(file);
    }
    const { stdout: current } = await run('wpa_cli', ['-i', iface, 'status']);
    const active = current.split('\n').some(line => line.startsWith('ssid=') && decodeWpaSsid(line.slice(5)) === ssid);
    const trialPath = join(netplanDir, `zzzz-openwifi-edit-${process.pid}.yaml`);
    const before = new Set(await trialCopies(trialPath));
    try {
      if (active) await tryNetplanConnection(candidate, iface, target, true, changes.newPassword);
      if (await readFile(source, 'utf8') !== original) throw new Error('The Netplan source changed during the edit; review it before retrying');
      const staged = `${source}.openwifi-${process.pid}`;
      try { await copyFile(candidate, staged, constants.COPYFILE_EXCL); await chmod(staged, info.mode & 0o777); await rename(staged, source); }
      finally { await rm(staged, { force: true }); }
    } finally { if (active) await removeNewTrialCopies(trialPath, content, before); }
  } finally { await rm(tempDir, { recursive: true, force: true }); }
}
