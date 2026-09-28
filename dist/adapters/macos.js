import { run, failClosed } from '../util.js';
const AIRPORT = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
export function parseAirport(t) {
    const lines = t.split('\n');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim())
            continue;
        // SSID is first 33 cols (airport pads), then BSSID MAC, RSSI, channel, HT, CC, security
        const ssid = l.slice(0, 33).trim();
        const rest = l.slice(33).trim().split(/\s+/);
        if (!ssid)
            continue;
        const bssid = rest[0];
        const rssi = Number(rest[1]);
        const security = rest.slice(5).join(' ') || 'unknown';
        // map RSSI (-100..-30) to 0..100
        const signal = Math.max(0, Math.min(100, Math.round((rssi + 100) * 1.4)));
        out.push({ ssid, signal: Number.isFinite(signal) ? signal : 0, security, bssid });
    }
    return out;
}
export function defaultIface() { return process.env.OPENWIFI_IFACE ?? 'en0'; }
export function parseSystemProfiler(t, iface) {
    const data = JSON.parse(t).SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? [];
    const networks = data.find((i) => i._name === iface)?.spairport_airport_other_local_wireless_networks ?? [];
    return networks.filter((n) => n._name && n._name !== '<redacted>').map((n) => ({
        ssid: n._name,
        signal: Number.isFinite(Number.parseInt(n.spairport_signal_noise)) ? Math.max(0, Math.min(100, (Number.parseInt(n.spairport_signal_noise) + 100) * 1.4)) : 0,
        security: n.spairport_security_mode ?? 'unknown',
    }));
}
export const macos = {
    async scan(iface, timeoutMs = 20000) {
        try {
            const { stdout } = await run(AIRPORT, ['-s'], { timeoutMs });
            return parseAirport(stdout);
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
            const { stdout } = await run('system_profiler', ['SPAirPortDataType', '-json', '-detailLevel', 'full'], { timeoutMs });
            const nets = parseSystemProfiler(stdout, iface ?? defaultIface());
            if (!nets.length && stdout.includes('<redacted>'))
                throw new Error('macOS hides nearby network names from this terminal. Allow Location Services for Terminal (or the app running openwifi), then retry.');
            return nets;
        }
    },
    async connect(ssid, o = {}) {
        if (o.save === false)
            failClosed('--no-save on macOS (networksetup stores the connection)');
        if (o.hidden)
            failClosed('Connecting to a hidden network on macOS');
        const iface = o.iface ?? defaultIface();
        const args = ['-setairportnetwork', iface, ssid];
        if (o.password)
            args.push(o.password);
        return run('networksetup', args, { timeoutMs: o.timeoutMs ?? 30000, secrets: o.password ? [o.password] : [] });
    },
    async list(iface) {
        const { stdout } = await run('networksetup', ['-listpreferredwirelessnetworks', iface ?? defaultIface()]);
        return stdout.split('\n').map(l => l.trim()).filter(l => l && !/^Preferred/i.test(l)).map(name => ({ name }));
    },
    // networksetup joins a preferred network with the password already in the Keychain, so this writes
    // no profile: it is the macOS equivalent of switching back to something you saved earlier.
    async use(ssid, iface) {
        const i = iface ?? defaultIface();
        await run('networksetup', ['-setairportnetwork', i, ssid], { timeoutMs: 30000 });
        const st = await macos.status(i).catch(() => null);
        if (!st)
            return { ssid, verified: false };
        if (st.network === 'Connected (network name hidden by macOS)')
            return { ssid, verified: false };
        if (!st.connected || !st.network.includes(ssid))
            throw new Error(`macOS did not connect to "${ssid}" (now: ${st.network})`);
        return { ssid, verified: true };
    },
    // Netplan trial artifacts do not exist on macOS, so there is never generated config to repair.
    async repair() { return { removed: [], remaining: [], files: [] }; },
    async status(iface) {
        const i = iface ?? defaultIface();
        const [net, power] = await Promise.all([
            run('networksetup', ['-getairportnetwork', i]).then(r => r.stdout.trim()).catch(() => ''),
            run('networksetup', ['-getairportpower', i]).then(r => r.stdout.trim()).catch(() => ''),
        ]);
        let connected = !/not associated/i.test(net) && /current (wi-fi|airport) network/i.test(net);
        if (!connected && /not associated/i.test(net)) {
            const profiler = await run('system_profiler', ['SPAirPortDataType', '-json', '-detailLevel', 'mini']).then(r => JSON.parse(r.stdout)).catch(() => null);
            const devices = profiler?.SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? [];
            connected = devices.some((d) => d._name === i && d.spairport_status_information === 'spairport_status_connected');
        }
        return { interface: i, network: connected && /not associated/i.test(net) ? 'Connected (network name hidden by macOS)' : net, connected, power };
    },
    async disconnect(iface) {
        if (iface && iface !== defaultIface())
            failClosed('Disconnect on a non-default macOS WiFi interface');
        try {
            await run(AIRPORT, ['-z']);
            return { method: 'disassociate' };
        }
        catch (e) {
            throw new Error(`macOS cannot disconnect without turning off WiFi: ${e.message}. Use openwifi off if you want to disable WiFi.`);
        }
    },
    async forget(ssid, iface) {
        return run('networksetup', ['-removepreferredwirelessnetwork', iface ?? defaultIface(), ssid]);
    },
    async edit(ssid, o) {
        if (o.autoconnect || o.priority !== undefined || o.rename)
            failClosed('macOS edit of autoconnect/priority/rename is not supported');
        if (!o.newPassword)
            failClosed('Nothing to edit — pass --new-password');
        failClosed('macOS password editing without deleting the saved network; use openwifi connect with the new password');
    },
    async radio(on, iface) {
        return run('networksetup', ['-setairportpower', iface ?? defaultIface(), on ? 'on' : 'off']);
    },
    async doctor(iface) {
        const i = iface ?? defaultIface();
        const checks = [];
        const st = await macos.status(i).catch(() => null);
        const powered = st ? /on/i.test(st.power) : false;
        checks.push({ name: 'power', ok: powered, hint: powered ? `WiFi on (${i}).` : `WiFi is off — run: openwifi on` });
        const connected = st?.connected ?? false;
        checks.push({ name: 'connection', ok: connected, hint: connected ? st.network : 'Not connected — run: openwifi (guided) or openwifi scan' });
        const scan = await macos.scan(i, 15000).then(n => n.length).catch(() => -1);
        checks.push({ name: 'scan', ok: scan !== -1, hint: scan === -1 ? 'Allow Location Services for Terminal (or the app running openwifi), then retry.' : `Scan works (${scan} networks).` });
        return checks;
    },
};
//# sourceMappingURL=macos.js.map