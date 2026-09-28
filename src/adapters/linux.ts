import { run, which, failClosed } from '../util.js';
import { setTimeout as delay } from 'node:timers/promises';
import { connectNetplan, editNetplan, forgetNetplan, isOpenwifiProfile, parseWpaNetworks, requireNetplanForget } from './netplan.js';
import { decodeWpaSsid, validWpaSsid } from './wpa.js';
import { readlink } from 'node:fs/promises';
import { basename } from 'node:path';

export type Net = { ssid: string; signal: number; security: string; bssid?: string; freq?: string };
export type Profile = { name: string; uuid?: string; type?: string };

export async function backend(): Promise<'nmcli' | 'iwctl' | 'wpa_cli' | 'none'> {
  if (await which('nmcli')) return 'nmcli';
  if (await which('iwctl')) return 'iwctl';
  if (await which('wpa_cli')) return 'wpa_cli';
  return 'none';
}

export async function requireConnectBackend(): Promise<void> {
  const found = await backend();
  if (found === 'nmcli') return;
  if (found === 'wpa_cli' && await which('netplan')) {
    if (process.getuid?.() !== 0) throw new Error('Connecting through Netplan requires root privileges');
    return;
  }
  if (found === 'iwctl' || found === 'wpa_cli') failClosed(`Connecting needs NetworkManager (nmcli) or Netplan with wpa_cli; ${found} alone supports scan/status only`);
  failClosed('No WiFi manager found. Run openwifi doctor. Connecting needs NetworkManager (nmcli)');
}

async function requireNmcli(action: string): Promise<void> {
  if (await backend() !== 'nmcli') failClosed(`${action} needs NetworkManager (nmcli); this system's WiFi settings may be managed by Netplan or another service`);
}

function wpaArgs(iface: string | undefined, command: string): string[] {
  return iface ? ['-i', iface, command] : [command];
}

export function parseNmcliWifi(t: string): Net[] {
  return t.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [ssid = '', signal = '', security = ''] = line.split(/(?<!\\):/);
    return { ssid: ssid.replace(/\\:/g, ':'), signal: Number(signal) || 0, security: security || 'unknown' };
  }).filter(n => n.ssid);
}

export function parseIwNetworks(t: string): Net[] {
  // iwctl get-networks: rows like "  MyWifi  psk  ****  80"
  return t.split('\n').map(l => l.trim()).filter(l => l && !/^Available|Network name/i.test(l) && !/^-+/.test(l))
    .map(line => { const m = line.match(/^(\S(?:.*\S)?)\s+(open|psk|sae|owe|802\.1x.*)?\s*$/i); return m ? { ssid: m[1].trim(), signal: 0, security: (m[2] || 'unknown').trim() } : null; })
    .filter((x): x is Net => !!x && !!x.ssid);
}

export function parseWpaResults(t: string): Net[] {
  return t.split('\n').slice(1).map(line => {
    const [bssid, freq, level, flags, ...ssidParts] = line.replace(/\r$/, '').split('\t');
    const ssid = decodeWpaSsid(ssidParts.join('\t'));
    if (!validWpaSsid(ssid) || !bssid || !Number.isFinite(Number(level))) return null;
    const signal = Math.max(0, Math.min(100, 2 * (Number(level) + 100)));
    return { ssid, signal, security: flags || 'open', bssid, freq };
  }).filter((n): n is NonNullable<typeof n> => n !== null);
}

export const linux = {
  async scan(iface?: string, timeoutMs = 20000): Promise<Net[]> {
    const b = await backend();
    if (b === 'nmcli') {
      const args = ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'];
      if (iface) args.push('--ifname', iface);
      const { stdout } = await run('nmcli', args, { timeoutMs });
      return parseNmcliWifi(stdout);
    }
    if (b === 'iwctl') {
      const dev = iface ?? await defaultStation();
      await run('iwctl', ['station', dev, 'scan'], { timeoutMs }).catch(() => ({}));
      const { stdout } = await run('iwctl', ['station', dev, 'get-networks'], { timeoutMs });
      return parseIwNetworks(stdout);
    }
    if (b === 'wpa_cli') {
      const { stdout: requested } = await run('wpa_cli', wpaArgs(iface, 'scan'), { timeoutMs });
      if (!requested.trim().endsWith('OK')) throw new Error('WiFi scan was refused by wpa_supplicant. Try again after the current scan finishes.');
      await delay(1500);
      const { stdout } = await run('wpa_cli', wpaArgs(iface, 'scan_results'), { timeoutMs });
      return parseWpaResults(stdout);
    }
    failClosed('No supported Linux WiFi backend found (need nmcli, iwctl, or wpa_cli)');
  },
  async connect(ssid: string, o: { password?: string; hidden?: boolean; iface?: string; timeoutMs?: number; save?: boolean } = {}) {
    await requireConnectBackend();
    if (await backend() === 'wpa_cli') return connectNetplan(ssid, o);
    const args = ['device', 'wifi', 'connect', ssid];
    if (o.password) args.push('password', o.password);
    if (o.hidden) args.push('hidden', 'yes');
    if (o.iface) args.push('ifname', o.iface);
    if (o.save === false) failClosed('--no-save on Linux (nmcli would save the connection)');
    return run('nmcli', args, { timeoutMs: o.timeoutMs ?? 30000, secrets: o.password ? [o.password] : [] });
  },
  async list(iface?: string): Promise<Profile[]> {
    if (await backend() === 'wpa_cli') {
      const { stdout } = await run('wpa_cli', wpaArgs(iface, 'list_networks'));
      return Promise.all(parseWpaNetworks(stdout).map(async n => ({ name: n.ssid, type: await isOpenwifiProfile(n.ssid, iface) ? 'openwifi-netplan' : 'wpa_supplicant' })));
    }
    await requireNmcli('Listing saved networks');
    const { stdout } = await run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show']);
    return stdout.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [name = '', uuid = '', type = ''] = l.split(/(?<!\\):/);
      return { name, uuid, type };
    }).filter(p => p.name && /wireless|wifi/i.test(p.type));
  },
  async status(iface?: string) {
    const b = await backend();
    if (b === 'iwctl') {
      const dev = iface ?? await defaultStation().catch(() => iface ?? 'wlan0');
      const { stdout } = await run('iwctl', ['station', dev, 'show']);
      return { backend: 'iwctl' as const, detail: stdout.trim() };
    }
    if (b === 'wpa_cli') {
      const { stdout } = await run('wpa_cli', wpaArgs(iface, 'status'));
      const values = Object.fromEntries(stdout.split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)).filter(pair => pair.length === 2));
      if (!values.wpa_state) throw new Error('Could not read wpa_supplicant status. Try: sudo openwifi status --interface <WiFi interface>');
      return { backend: 'wpa_cli' as const, state: values.wpa_state, ssid: decodeWpaSsid(values.ssid ?? ''), bssid: values.bssid ?? '', frequency: values.freq ?? '' };
    }
    if (b === 'none') failClosed('No Linux WiFi backend found (install NetworkManager or iwd)');
    const [active, dev] = await Promise.all([
      run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show', '--active']).then(r => r.stdout).catch(() => ''),
      run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']).then(r => r.stdout).catch(() => ''),
    ]);
    return { backend: 'nmcli' as const, active: active.trim(), devices: dev.trim() };
  },
  async disconnect(iface?: string) {
    if (await backend() === 'wpa_cli') {
      if (process.getuid?.() !== 0) throw new Error('Disconnecting through wpa_supplicant requires root privileges');
      const { stdout } = await run('wpa_cli', wpaArgs(iface, 'disconnect'));
      if (stdout.trim() !== 'OK') throw new Error('wpa_supplicant refused to disconnect');
      return;
    }
    await requireNmcli('Disconnect');
    if (iface) return run('nmcli', ['device', 'disconnect', iface]);
    const { stdout } = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device', 'status']);
    const wifi = stdout.split('\n').find(l => /:wifi:/i.test(l))?.split(':')[0];
    if (!wifi) failClosed('No WiFi device found');
    return run('nmcli', ['device', 'disconnect', wifi]);
  },
  async requireForget(name: string, iface?: string) {
    if (await backend() === 'wpa_cli' && await which('netplan')) return requireNetplanForget(name, iface);
    await requireNmcli('Forget');
  },
  async forget(name: string, iface?: string) {
    if (await backend() === 'wpa_cli' && await which('netplan')) return forgetNetplan(name, iface);
    await requireNmcli('Forget'); return run('nmcli', ['connection', 'delete', 'id', name]);
  },
  async edit(name: string, o: { newPassword?: string; autoconnect?: 'on' | 'off'; priority?: number; rename?: string }, iface?: string) {
    if (await backend() === 'wpa_cli' && await which('netplan')) return editNetplan(name, o, iface);
    if (await backend() !== 'nmcli') failClosed('Edit needs NetworkManager (nmcli) or Netplan with wpa_cli');
    const changes: string[] = [];
    if (o.newPassword) changes.push('wifi-sec.psk', o.newPassword);
    if (o.autoconnect) changes.push('connection.autoconnect', o.autoconnect === 'on' ? 'yes' : 'no');
    if (o.priority !== undefined) changes.push('connection.autoconnect-priority', String(o.priority));
    if (o.rename) changes.push('connection.id', o.rename);
    if (!changes.length) failClosed('Nothing to edit');
    await run('nmcli', ['connection', 'modify', 'id', name, ...changes], { secrets: o.newPassword ? [o.newPassword] : [] });
  },
  async radio(on: boolean, iface?: string) {
    if (await backend() === 'wpa_cli') {
      if (!await which('rfkill')) failClosed('Radio control requires the installed rfkill command');
      if (process.getuid?.() !== 0) throw new Error('Changing WiFi radio power requires root privileges');
      let radioName: string | undefined;
      if (iface) {
        if (!/^[a-zA-Z0-9_-]+$/.test(iface)) failClosed('Invalid WiFi interface name');
        radioName = basename(await readlink(`/sys/class/net/${iface}/phy80211`));
      }
      const { stdout: before } = await run('rfkill', ['--output', 'ID,TYPE,DEVICE,SOFT,HARD']);
      const radios = before.split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(fields => fields[1] === 'wlan' && (!radioName || fields[2] === radioName));
      if (radios.length !== 1) failClosed('Choose one WiFi radio with --interface');
      const entry = radios[0];
      if (!entry || !/^\d+$/.test(entry[0])) failClosed('Could not identify this WiFi radio with rfkill');
      if (entry[4] === 'blocked' && on) failClosed('WiFi is blocked by a hardware switch; turn it on physically');
      await run('rfkill', [on ? 'unblock' : 'block', entry[0]]);
      const { stdout: after } = await run('rfkill', ['--output', 'ID,TYPE,DEVICE,SOFT,HARD']);
      const updated = after.split('\n').slice(1).map(line => line.trim().split(/\s+/)).find(fields => fields[0] === entry[0]);
      if (!updated || updated[3] !== (on ? 'unblocked' : 'blocked')) throw new Error('Could not verify the WiFi radio state after rfkill');
      return;
    }
    await requireNmcli('Changing radio power');
    void iface;
    return run('nmcli', ['radio', 'wifi', on ? 'on' : 'off']);
  },
  async doctor(iface?: string) {
    const checks: { name: string; ok: boolean; hint: string }[] = [];
    const b = await backend();
    checks.push({ name: 'backend', ok: b !== 'none', hint: b === 'none' ? 'No WiFi manager found. Check for a WiFi adapter with: ip -br link. Connecting needs NetworkManager (nmcli). On a remote server, check its network configuration before installing or starting a network service.' : `Using ${b}.` });
    if (b === 'nmcli') {
      const g = await run('nmcli', ['general', 'status']).then(r => r.stdout).catch(() => '');
      const radioOff = /disabled/i.test(g);
      checks.push({ name: 'radio', ok: !radioOff, hint: radioOff ? 'WiFi radio is off — run: openwifi on' : 'Radio enabled.' });
      const dev = await run('nmcli', ['device', 'status']).then(r => r.stdout).catch(() => '');
      const hasWifi = /wifi/i.test(dev);
      checks.push({ name: 'adapter', ok: hasWifi, hint: hasWifi ? 'WiFi adapter present.' : 'No WiFi adapter seen. Check hardware switch / USB / VM passthrough.' });
      const scan = await linux.scan().then(n => n.length).catch(() => -1);
      checks.push({ name: 'scan', ok: scan > 0, hint: scan > 0 ? `Scan works (${scan} networks).` : scan === 0 ? 'Scan works but sees nothing — move closer to the router.' : 'Scan failed — try: sudo openwifi scan' });
      const dns = await run('getent', ['hosts', 'example.com']).then(r => !!r.stdout.trim()).catch(() => false);
      checks.push({ name: 'dns', ok: dns, hint: dns ? 'DNS resolves.' : 'Connected but no internet/DNS — restart router, check captive portal, or run: nmcli connection show --active' });
    } else if (b === 'iwctl') {
      checks.push({ name: 'note', ok: true, hint: 'iw-only system: scan/status supported; connect/edit need NetworkManager in v1.' });
    } else if (b === 'wpa_cli') {
      const connected = await linux.status(iface).then(s => 'state' in s && s.state === 'COMPLETED').catch(() => false);
      checks.push({ name: 'connection', ok: connected, hint: connected ? 'WiFi is connected through wpa_supplicant.' : 'Could not confirm WiFi status. Try: sudo openwifi doctor --interface <WiFi interface>' });
      const hasNetplan = await which('netplan');
      checks.push({ name: 'note', ok: hasNetplan, hint: hasNetplan ? 'Netplan can trial new networks with sudo and physical console access. Edit supports password and SSID changes; forget supports inactive profiles.' : 'Scan/status supported. Connecting needs Netplan or NetworkManager.' });
    }
    return checks;
  },
};

async function defaultStation(): Promise<string> {
  const { stdout } = await run('iwctl', ['device', 'list']);
  const m = stdout.match(/^(\S+)\s+.*station/im) || stdout.match(/(wlan\d*)/i);
  if (!m) failClosed('No wireless station device found for iwctl');
  return m[1].trim();
}
