import { run, which, failClosed } from '../util.js';
import { setTimeout as delay } from 'node:timers/promises';
export async function backend() {
    if (await which('nmcli'))
        return 'nmcli';
    if (await which('iwctl'))
        return 'iwctl';
    if (await which('wpa_cli'))
        return 'wpa_cli';
    return 'none';
}
export async function requireConnectBackend() {
    const found = await backend();
    if (found === 'nmcli')
        return;
    if (found === 'iwctl' || found === 'wpa_cli')
        failClosed(`Connecting needs NetworkManager (nmcli); ${found} supports scan/status only. If this is a remote server, do not replace its active network manager over SSH`);
    failClosed('No WiFi manager found. Run openwifi doctor. Connecting needs NetworkManager (nmcli)');
}
async function requireNmcli(action) {
    if (await backend() !== 'nmcli')
        failClosed(`${action} needs NetworkManager (nmcli); this system's WiFi settings may be managed by Netplan or another service`);
}
function wpaArgs(iface, command) {
    return iface ? ['-i', iface, command] : [command];
}
export function parseNmcliWifi(t) {
    return t.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [ssid = '', signal = '', security = ''] = line.split(/(?<!\\):/);
        return { ssid: ssid.replace(/\\:/g, ':'), signal: Number(signal) || 0, security: security || 'unknown' };
    }).filter(n => n.ssid);
}
export function parseIwNetworks(t) {
    // iwctl get-networks: rows like "  MyWifi  psk  ****  80"
    return t.split('\n').map(l => l.trim()).filter(l => l && !/^Available|Network name/i.test(l) && !/^-+/.test(l))
        .map(line => { const m = line.match(/^(\S(?:.*\S)?)\s+(open|psk|sae|owe|802\.1x.*)?\s*$/i); return m ? { ssid: m[1].trim(), signal: 0, security: (m[2] || 'unknown').trim() } : null; })
        .filter((x) => !!x && !!x.ssid);
}
export function parseWpaResults(t) {
    return t.split('\n').slice(1).map(line => {
        const [bssid, freq, level, flags, ...ssidParts] = line.replace(/\r$/, '').split('\t');
        const ssid = ssidParts.join('\t');
        if (!ssid || !bssid || !Number.isFinite(Number(level)))
            return null;
        const signal = Math.max(0, Math.min(100, 2 * (Number(level) + 100)));
        return { ssid, signal, security: flags || 'open', bssid, freq };
    }).filter((n) => n !== null);
}
export const linux = {
    async scan(iface, timeoutMs = 20000) {
        const b = await backend();
        if (b === 'nmcli') {
            const args = ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'];
            if (iface)
                args.push('--ifname', iface);
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
            if (!requested.trim().endsWith('OK'))
                throw new Error('WiFi scan was refused by wpa_supplicant. Try again after the current scan finishes.');
            await delay(1500);
            const { stdout } = await run('wpa_cli', wpaArgs(iface, 'scan_results'), { timeoutMs });
            return parseWpaResults(stdout);
        }
        failClosed('No supported Linux WiFi backend found (need nmcli, iwctl, or wpa_cli)');
    },
    async connect(ssid, o = {}) {
        await requireConnectBackend();
        const args = ['device', 'wifi', 'connect', ssid];
        if (o.password)
            args.push('password', o.password);
        if (o.hidden)
            args.push('hidden', 'yes');
        if (o.iface)
            args.push('ifname', o.iface);
        if (o.save === false)
            failClosed('--no-save on Linux (nmcli would save the connection)');
        return run('nmcli', args, { timeoutMs: o.timeoutMs ?? 30000, secrets: o.password ? [o.password] : [] });
    },
    async list() {
        await requireNmcli('Listing saved networks');
        const { stdout } = await run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show']);
        return stdout.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const [name = '', uuid = '', type = ''] = l.split(/(?<!\\):/);
            return { name, uuid, type };
        }).filter(p => p.name && /wireless|wifi/i.test(p.type));
    },
    async status(iface) {
        const b = await backend();
        if (b === 'iwctl') {
            const dev = iface ?? await defaultStation().catch(() => iface ?? 'wlan0');
            const { stdout } = await run('iwctl', ['station', dev, 'show']);
            return { backend: 'iwctl', detail: stdout.trim() };
        }
        if (b === 'wpa_cli') {
            const { stdout } = await run('wpa_cli', wpaArgs(iface, 'status'));
            const values = Object.fromEntries(stdout.split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)).filter(pair => pair.length === 2));
            if (!values.wpa_state)
                throw new Error('Could not read wpa_supplicant status. Try: sudo openwifi status --interface <WiFi interface>');
            return { backend: 'wpa_cli', state: values.wpa_state, ssid: values.ssid ?? '', bssid: values.bssid ?? '', frequency: values.freq ?? '' };
        }
        if (b === 'none')
            failClosed('No Linux WiFi backend found (install NetworkManager or iwd)');
        const [active, dev] = await Promise.all([
            run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show', '--active']).then(r => r.stdout).catch(() => ''),
            run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']).then(r => r.stdout).catch(() => ''),
        ]);
        return { backend: 'nmcli', active: active.trim(), devices: dev.trim() };
    },
    async disconnect(iface) {
        await requireNmcli('Disconnect');
        if (iface)
            return run('nmcli', ['device', 'disconnect', iface]);
        const { stdout } = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device', 'status']);
        const wifi = stdout.split('\n').find(l => /:wifi:/i.test(l))?.split(':')[0];
        if (!wifi)
            failClosed('No WiFi device found');
        return run('nmcli', ['device', 'disconnect', wifi]);
    },
    async forget(name) { await requireNmcli('Forget'); return run('nmcli', ['connection', 'delete', 'id', name]); },
    async edit(name, o) {
        if (await backend() !== 'nmcli')
            failClosed('Edit needs NetworkManager (nmcli)');
        const changes = [];
        if (o.newPassword)
            changes.push('wifi-sec.psk', o.newPassword);
        if (o.autoconnect)
            changes.push('connection.autoconnect', o.autoconnect === 'on' ? 'yes' : 'no');
        if (o.priority !== undefined)
            changes.push('connection.autoconnect-priority', String(o.priority));
        if (o.rename)
            changes.push('connection.id', o.rename);
        if (!changes.length)
            failClosed('Nothing to edit');
        await run('nmcli', ['connection', 'modify', 'id', name, ...changes], { secrets: o.newPassword ? [o.newPassword] : [] });
    },
    async radio(on, iface) {
        await requireNmcli('Changing radio power');
        void iface;
        return run('nmcli', ['radio', 'wifi', on ? 'on' : 'off']);
    },
    async doctor(iface) {
        const checks = [];
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
        }
        else if (b === 'iwctl') {
            checks.push({ name: 'note', ok: true, hint: 'iw-only system: scan/status supported; connect/edit need NetworkManager in v1.' });
        }
        else if (b === 'wpa_cli') {
            const connected = await linux.status(iface).then(s => 'state' in s && s.state === 'COMPLETED').catch(() => false);
            checks.push({ name: 'connection', ok: connected, hint: connected ? 'WiFi is connected through wpa_supplicant.' : 'Could not confirm WiFi status. Try: sudo openwifi doctor --interface <WiFi interface>' });
            checks.push({ name: 'note', ok: true, hint: 'Scan/status supported. Connect, saved networks, edit, and forget need NetworkManager; do not replace the active network service over SSH.' });
        }
        return checks;
    },
};
async function defaultStation() {
    const { stdout } = await run('iwctl', ['device', 'list']);
    const m = stdout.match(/^(\S+)\s+.*station/im) || stdout.match(/(wlan\d*)/i);
    if (!m)
        failClosed('No wireless station device found for iwctl');
    return m[1].trim();
}
//# sourceMappingURL=linux.js.map