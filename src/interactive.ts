import * as p from '@clack/prompts';
import { adapter } from './adapters/index.js';
import { isAuthError, sudoHint } from './util.js';
import { backend, requireConnectBackend } from './adapters/linux.js';

export async function confirmRemoteWifiSwitch(): Promise<boolean> {
  if (await backend() !== 'wpa_cli') return true;
  const accepted = await p.confirm({ message: 'Switching WiFi may drop SSH. Netplan tries to roll back after 90 seconds. Do you have physical console access?' });
  return !p.isCancel(accepted) && accepted === true;
}

export async function guided(rawArgv: string[]) {
  p.intro('openwifi — friendly WiFi manager');
  const ad: any = adapter();
  const action = await p.select({
    message: 'What do you want to do?',
    options: [
      { value: 'connect', label: 'Connect to WiFi' },
      { value: 'scan', label: 'Search networks' },
      { value: 'status', label: 'Show status' },
      { value: 'list', label: 'Saved networks' },
      { value: 'forget', label: 'Forget / remove' },
      { value: 'edit', label: 'Edit saved network' },
      { value: 'doctor', label: 'Troubleshoot' },
      { value: 'toggle', label: 'Turn WiFi on/off' },
    ],
  });
  if (p.isCancel(action)) { p.cancel('Bye.'); return; }
  try {
    if (action === 'scan') {
      const s = p.spinner(); s.start('Scanning…');
      const nets = await ad.scan(); s.stop(`Found ${nets.length} network(s).`);
      for (const n of nets.slice(0, 25)) console.log(`  ${String(n.signal).padStart(3)}%  ${n.ssid}  (${n.security})`);
    } else if (action === 'connect') {
      if (ad.kind === 'linux') await requireConnectBackend();
      if (ad.kind === 'linux' && !await confirmRemoteWifiSwitch()) { p.cancel('Kept the current connection.'); return; }
      const s = p.spinner(); s.start('Scanning…');
      const nets = await ad.scan().catch((e: Error) => { p.log.warn(`Scan unavailable: ${e.message}`); return []; }); s.stop('Scan done.');
      const choices = nets.slice(0, 30).map((n: any) => ({ value: n.ssid, label: `${n.ssid} (${n.signal}% · ${n.security})` }));
      choices.push({ value: '__manual__', label: 'Enter network name manually…' });
      const ssidSel = await p.select({ message: 'Pick a network', options: choices });
      if (p.isCancel(ssidSel)) { p.cancel('Bye.'); return; }
      let ssid = String(ssidSel);
      if (ssid === '__manual__') {
        const h = await p.text({ message: 'WiFi network name (SSID)' });
        if (p.isCancel(h)) { p.cancel('Bye.'); return; }
        ssid = String(h);
      }
      const pw = await p.password({ message: `Password for "${ssid}" (leave empty if open)`, mask: '•' });
      if (p.isCancel(pw)) { p.cancel('Bye.'); return; }
      const s2 = p.spinner(); s2.start(`Connecting to ${ssid}…`);
      try {
        await ad.connect(ssid, { password: pw || undefined });
        s2.stop(`Connected to ${ssid}.`);
      } catch (e) {
        s2.stop(`Could not connect to ${ssid}.`);
        throw e;
      }
    } else if (action === 'status') {
      console.log(JSON.stringify(await ad.status(), null, 2));
    } else if (action === 'list') {
      console.log(JSON.stringify(await ad.list(), null, 2));
    } else if (action === 'forget') {
      const saved: any[] = await ad.list().catch(() => []);
      if (!saved.length) { p.note('No saved networks found.'); p.outro('Done.'); return; }
      const sel = await p.select({ message: 'Forget which?', options: saved.map(s => ({ value: s.name, label: s.name })) });
      if (p.isCancel(sel)) { p.cancel('Bye.'); return; }
      const ok = await p.confirm({ message: `Forget "${sel}"? You will need the password to rejoin.` });
      if (p.isCancel(ok) || !ok) { p.cancel('Kept.'); return; }
      await ad.forget(String(sel));
      p.outro(`Forgot "${sel}".`);
    } else if (action === 'edit') {
      const saved: any[] = await ad.list().catch(() => []);
      const sel = saved.length
        ? await p.select({ message: 'Edit which?', options: saved.map(s => ({ value: s.name, label: s.name })) })
        : await p.text({ message: 'Profile / SSID to edit' });
      if (p.isCancel(sel)) { p.cancel('Bye.'); return; }
      if (ad.kind === 'macos') { p.log.warn('macOS saved-password editing is unavailable. Use connect with a password instead.'); return; }
      const npw = await p.password({ message: 'New password (empty = keep)', mask: '•' });
      if (p.isCancel(npw)) { p.cancel('Bye.'); return; }
      await ad.edit(String(sel), { newPassword: npw || undefined });
      p.outro('Saved.');
    } else if (action === 'doctor') {
      const s = p.spinner(); s.start('Checking…');
      const checks = await ad.doctor(); s.stop('Diagnosis:');
      for (const c of checks) console.log(`  ${(c.ok ? '✓' : '✗')} ${c.name}: ${c.hint}`);
    } else if (action === 'toggle') {
      const v = await p.select({ message: 'Radio', options: [{ value: 'on', label: 'Turn on' }, { value: 'off', label: 'Turn off' }] });
      if (p.isCancel(v)) { p.cancel('Bye.'); return; }
      await ad.radio(v === 'on');
      p.outro(v === 'on' ? 'WiFi on.' : 'WiFi off.');
    }
    p.outro('Done.');
  } catch (e: any) {
    if (isAuthError(e)) { p.log.error(sudoHint(rawArgv)); process.exitCode = 1; return; }
    p.log.error(e?.message ?? String(e));
    process.exitCode = 1;
  }
}
