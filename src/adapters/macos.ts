import { run, failClosed } from '../util.js';
import type { Net } from './linux.js';

const AIRPORT = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';

export function parseAirport(t: string): Net[] {
  const lines = t.split('\n');
  const out: Net[] = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    // SSID is first 33 cols (airport pads), then BSSID MAC, RSSI, channel, HT, CC, security
    const ssid = l.slice(0, 33).trim();
    const rest = l.slice(33).trim().split(/\s+/);
    if (!ssid) continue;
    const bssid = rest[0];
    const rssi = Number(rest[1]);
    const security = rest.slice(5).join(' ') || 'unknown';
    // map RSSI (-100..-30) to 0..100
    const signal = Math.max(0, Math.min(100, Math.round((rssi + 100) * 1.4)));
    out.push({ ssid, signal: Number.isFinite(signal) ? signal : 0, security, bssid });
  }
  return out;
}

export function defaultIface(): string { return process.env.OPENWIFI_IFACE ?? 'en0'; }

export const macos = {
  async scan(timeoutMs = 20000): Promise<Net[]> {
    const { stdout } = await run(AIRPORT, ['-s'], { timeoutMs });
    return parseAirport(stdout);
  },
  async connect(ssid: string, o: { password?: string; iface?: string; timeoutMs?: number } = {}) {
    const iface = o.iface ?? defaultIface();
    const args = ['-setairportnetwork', iface, ssid];
    if (o.password) args.push(o.password);
    return run('networksetup', args, { timeoutMs: o.timeoutMs ?? 30000 });
  },
  async list(iface?: string) {
    const { stdout } = await run('networksetup', ['-listpreferredwirelessnetworks', iface ?? defaultIface()]);
    return stdout.split('\n').map(l => l.trim()).filter(l => l && !/^Preferred/i.test(l)).map(name => ({ name }));
  },
  async status(iface?: string) {
    const i = iface ?? defaultIface();
    const [net, power] = await Promise.all([
      run('networksetup', ['-getairportnetwork', i]).then(r => r.stdout.trim()).catch(() => ''),
      run('networksetup', ['-getairportpower', i]).then(r => r.stdout.trim()).catch(() => ''),
    ]);
    return { interface: i, network: net, power };
  },
  async disconnect(iface?: string) {
    const i = iface ?? defaultIface();
    // disassociate without powering off when possible
    try { await run(AIRPORT, ['-z']); return { interface: i, method: 'disassociate' }; }
    catch { await run('networksetup', ['-setairportpower', i, 'off']); await run('networksetup', ['-setairportpower', i, 'on']); return { interface: i, method: 'power-cycle' }; }
  },
  async forget(ssid: string, iface?: string) {
    return run('networksetup', ['-removepreferredwirelessnetwork', iface ?? defaultIface(), ssid]);
  },
  async edit(ssid: string, o: { newPassword?: string; autoconnect?: 'on' | 'off'; priority?: number; rename?: string }) {
    if (o.autoconnect || o.priority !== undefined || o.rename) failClosed('macOS edit of autoconnect/priority/rename is not supported');
    if (!o.newPassword) failClosed('Nothing to edit — pass --new-password');
    // password lives in Keychain: forget then reconnect
    await macos.forget(ssid).catch(() => ({}));
    return macos.connect(ssid, { password: o.newPassword });
  },
  async radio(on: boolean, iface?: string) {
    return run('networksetup', ['-setairportpower', iface ?? defaultIface(), on ? 'on' : 'off']);
  },
  async doctor(iface?: string) {
    const i = iface ?? defaultIface();
    const checks: { name: string; ok: boolean; hint: string }[] = [];
    const st = await macos.status(i).catch(() => null);
    const powered = st ? /on/i.test(st.power) : false;
    checks.push({ name: 'power', ok: powered, hint: powered ? `WiFi on (${i}).` : `WiFi is off — run: openwifi on` });
    const connected = st ? /current wi-fi network|current airport network/i.test(st.network) : false;
    checks.push({ name: 'connection', ok: connected, hint: connected ? st!.network : 'Not connected — run: openwifi (guided) or openwifi scan' });
    const scan = await macos.scan(15000).then(n => n.length).catch(() => -1);
    checks.push({ name: 'scan', ok: scan !== -1, hint: scan === -1 ? 'Scan needs permission — allow Terminal in Location Services / grant Full Disk Access if prompted.' : `Scan works (${scan} networks).` });
    return checks;
  },
};
