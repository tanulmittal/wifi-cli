import { run, which, failClosed } from '../util.js';
export async function backend() {
    if (await which('nmcli'))
        return 'nmcli';
    if (await which('iwctl'))
        return 'iwctl';
    return 'none';
}
export function parseNmcliWifi(t) {
    return t.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [ssid = '', signal = '', security = '', bssid = '', freq = ''] = line.split(':');
        return { ssid, signal: Number(signal) || 0, security: security || 'unknown', bssid: bssid || undefined, freq: freq || undefined };
    }).filter(n => n.ssid);
}
export function parseIwNetworks(t) {
    // iwctl get-networks: rows like "  MyWifi  psk  ****  80"
    return t.split('\n').map(l => l.trim()).filter(l => l && !/^Available|Network name/i.test(l) && !/^-+/.test(l))
        .map(line => { const m = line.match(/^(\S(?:.*\S)?)\s+(open|psk|sae|owe|802\.1x.*)?\s*$/i); return m ? { ssid: m[1].trim(), signal: 0, security: (m[2] || 'unknown').trim() } : null; })
        .filter((x) => !!x && !!x.ssid);
}
export const linux = {
    async scan(iface, timeoutMs = 20000) {
        const b = await backend();
        if (b === 'nmcli') {
            const args = ['-t', '-f', 'SSID,SIGNAL,SECURITY,BSSID,FREQ', 'device', 'wifi', 'list', '--rescan', 'yes'];
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
        failClosed('No supported Linux WiFi backend found (need NetworkManager nmcli or iwd iwctl)');
    },
    async connect(ssid, o = {}) {
        if (await backend() !== 'nmcli')
            failClosed('Connect needs NetworkManager (nmcli); iw-only systems are scan/status only in v1');
        const args = ['device', 'wifi', 'connect', ssid];
        if (o.password)
            args.push('password', o.password);
        if (o.hidden)
            args.push('hidden', 'yes');
        if (o.iface)
            args.push('ifname', o.iface);
        return run('nmcli', args, { timeoutMs: o.timeoutMs ?? 30000 });
    },
    async list() {
        const { stdout } = await run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show']);
        return stdout.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const [name = '', uuid = '', type = ''] = l.split(':');
            return { name, uuid, type };
        }).filter(p => p.name && /wireless|wifi/i.test(p.type));
    },
    async status(iface) {
        const b = await backend();
        if (b === 'iwctl' || !(await which('nmcli'))) {
            const dev = iface ?? await defaultStation().catch(() => iface ?? 'wlan0');
            const { stdout } = await run('iwctl', ['station', dev, 'show']);
            return { backend: 'iwctl', detail: stdout.trim() };
        }
        const [active, dev] = await Promise.all([
            run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show', '--active']).then(r => r.stdout).catch(() => ''),
            run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']).then(r => r.stdout).catch(() => ''),
        ]);
        return { backend: 'nmcli', active: active.trim(), devices: dev.trim() };
    },
    async disconnect(iface) {
        if (iface)
            return run('nmcli', ['device', 'disconnect', iface]);
        const { stdout } = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device', 'status']);
        const wifi = stdout.split('\n').find(l => /:wifi:/i.test(l))?.split(':')[0];
        if (!wifi)
            failClosed('No WiFi device found');
        return run('nmcli', ['device', 'disconnect', wifi]);
    },
    async forget(name) { return run('nmcli', ['connection', 'delete', 'id', name]); },
    async edit(name, o) {
        if (o.newPassword)
            await run('nmcli', ['connection', 'modify', 'id', name, 'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', o.newPassword]);
        if (o.autoconnect)
            await run('nmcli', ['connection', 'modify', 'id', name, 'connection.autoconnect', o.autoconnect === 'on' ? 'yes' : 'no']);
        if (o.priority !== undefined)
            await run('nmcli', ['connection', 'modify', 'id', name, 'connection.autoconnect-priority', String(o.priority)]);
        if (o.rename)
            await run('nmcli', ['connection', 'modify', 'id', name, 'connection.id', o.rename]);
    },
    async radio(on, iface) {
        void iface;
        return run('nmcli', ['radio', 'wifi', on ? 'on' : 'off']);
    },
    async doctor() {
        const checks = [];
        const b = await backend();
        checks.push({ name: 'backend', ok: b !== 'none', hint: b === 'none' ? 'Install NetworkManager (nmcli) or iwd (iwctl).' : `Using ${b}.` });
        if (b === 'nmcli') {
            const g = await run('nmcli', ['general', 'status']).then(r => r.stdout).catch(() => '');
            const radioOff = /disabled/i.test(g);
            checks.push({ name: 'radio', ok: !radioOff, hint: radioOff ? 'WiFi radio is off — run: openwifi on' : 'Radio enabled.' });
            const dev = await run('nmcli', ['device', 'status']).then(r => r.stdout).catch(() => '');
            const hasWifi = /wifi/i.test(dev);
            checks.push({ name: 'adapter', ok: hasWifi, hint: hasWifi ? 'WiFi adapter present.' : 'No WiFi adapter seen. Check hardware switch / USB / VM passthrough.' });
            const scan = await linux.scan().then(n => n.length).catch(() => -1);
            checks.push({ name: 'scan', ok: scan > 0, hint: scan > 0 ? `Scan works (${scan} networks).` : scan === 0 ? 'Scan works but sees nothing — move closer to the router.' : 'Scan failed — try: sudo openwifi scan' });
            const dns = await run('sh', ['-c', 'getent hosts archlinux.org || getent hosts example.com || nslookup example.com 2>&1 | head -5']).then(() => true).catch(() => false);
            checks.push({ name: 'dns', ok: dns, hint: dns ? 'DNS resolves.' : 'Connected but no internet/DNS — restart router, check captive portal, or run: nmcli connection show --active' });
        }
        else if (b === 'iwctl') {
            checks.push({ name: 'note', ok: true, hint: 'iw-only system: scan/status supported; connect/edit need NetworkManager in v1.' });
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