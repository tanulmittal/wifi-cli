#!/usr/bin/env node
import { Command } from 'commander';
import * as p from '@clack/prompts';
import { adapter } from './adapters/index.js';
import { isAuthError, sudoHint, printJson, failClosed } from './util.js';
import { guided, confirmRemoteWifiSwitch } from './interactive.js';
import { backend, requireConnectBackend } from './adapters/linux.js';
import { upgradeFromGithub } from './upgrade.js';

const program = new Command();
program
  .name('openwifi')
  .description('Friendly WiFi manager for Ubuntu/Linux and macOS. Bare `openwifi` is guided; flags work for scripts.')
  .version('0.2.0-beta.3')
  .option('--interface <name>', 'WiFi interface (e.g. wlan0, en0)')
  .option('--timeout <sec>', 'command timeout in seconds', '25')
  .option('--json', 'machine-readable JSON output')
  .option('--yes', 'skip confirmations (scripts)');

const tmo = () => {
  const seconds = Number(program.opts().timeout ?? 25);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--timeout must be a positive number of seconds');
  return seconds * 1000;
};

function handleErr(e: any, argv: string[]) {
  if (isAuthError(e)) { console.error(sudoHint(argv)); process.exit(1); }
  if (program.opts().json) printJson({ ok: false, error: e?.message ?? String(e) });
  else console.error(`Error: ${e?.message ?? e}`);
  process.exit(1);
}
const raw = (args: string[]) => args;

program.command('scan')
  .description('Search nearby WiFi networks')
  .action(async (opts) => {
    try {
      const ad: any = adapter();
      const nets = await ad.scan(program.opts().interface, tmo());
      if (program.opts().json) printJson({ ok: true, count: nets.length, networks: nets });
      else { console.log(`Found ${nets.length} network(s):`); for (const n of nets) console.log(`  ${String(n.signal ?? '').padStart(3)}%  ${n.ssid}  (${n.security})`); }
    } catch (e) { handleErr(e, raw(['scan'])); }
  });

program.command('connect <ssid>')
  .description('Connect to a WiFi network (prompts for password if needed)')
  .option('-p, --password <pw>', 'password (prefer interactive prompt; shell history risk)')
  .option('--hidden', 'hidden SSID')
  .option('--no-save', 'unsupported in v1; exits before changing anything')
  .action(async (ssid, opts) => {
    try {
      if (process.platform === 'linux') await requireConnectBackend();
      if (process.platform === 'linux' && await backend() === 'wpa_cli' && !program.opts().yes) {
        if (!process.stdin.isTTY) throw new Error('Switching WiFi through Netplan needs confirmation; run interactively or pass --yes if you have console access.');
        if (!await confirmRemoteWifiSwitch()) { console.log('Kept the current connection.'); return; }
      }
      let pw = opts.password;
      if (pw === undefined && process.stdin.isTTY) {
        const v = await p.password({ message: `Password for "${ssid}" (empty if open)`, mask: '•' });
        if (p.isCancel(v)) { console.log('Cancelled.'); return; }
        pw = String(v) || undefined;
      }
      const ad: any = adapter();
      await ad.connect(ssid, { password: pw, hidden: !!opts.hidden, iface: program.opts().interface, timeoutMs: tmo(), save: opts.save });
      if (program.opts().json) printJson({ ok: true, ssid }); else console.log(`Connected to "${ssid}".`);
    } catch (e) { handleErr(e, raw(['connect', ssid])); }
  });

program.command('list')
  .description('List saved WiFi networks')
  .action(async () => {
    try { const ad: any = adapter(); const items = await ad.list(program.opts().interface); if (program.opts().json) printJson({ ok: true, saved: items }); else { if (!items.length) console.log('No saved networks.'); for (const s of items) console.log(`  ${s.name}`); } }
    catch (e) { handleErr(e, raw(['list'])); }
  });

program.command('status')
  .description('Show current WiFi status')
  .action(async () => {
    try { const ad: any = adapter(); const st = await ad.status(program.opts().interface); if (program.opts().json) printJson({ ok: true, status: st }); else console.log(JSON.stringify(st, null, 2)); }
    catch (e) { handleErr(e, raw(['status'])); }
  });

program.command('disconnect')
  .description('Disconnect from current WiFi')
  .action(async () => {
    try { const ad: any = adapter(); await ad.disconnect(program.opts().interface); if (program.opts().json) printJson({ ok: true }); else console.log('Disconnected.'); }
    catch (e) { handleErr(e, raw(['disconnect'])); }
  });

const forget = async (profile: string) => {
  try {
    const ad: any = adapter();
    if (process.platform === 'linux') await ad.requireForget(profile, program.opts().interface);
    if (!program.opts().yes && !process.stdin.isTTY) throw new Error('Forgetting a network needs confirmation; run interactively or pass --yes.');
    if (!program.opts().yes) {
      const ok = await p.confirm({ message: `Forget "${profile}"? You will need the password to rejoin.` });
      if (p.isCancel(ok) || !ok) { console.log('Kept.'); return; }
    }
    await ad.forget(profile, program.opts().interface);
    const netplan = process.platform === 'linux' && await backend() === 'wpa_cli';
    if (program.opts().json) printJson({ ok: true, forgot: profile, ...(netplan ? { pendingReconfigure: true } : {}) });
    else console.log(netplan ? `Removed "${profile}" from saved Netplan configuration. It may remain available until network reconfiguration or reboot.` : `Forgot "${profile}".`);
  } catch (e) { handleErr(e, raw(['forget', profile])); }
};
program.command('forget <profile>').description('Forget / remove a saved network').action(forget);
program.command('remove <profile>').description('Alias of forget').action(forget);

program.command('edit <profile>')
  .description('Edit password, autoconnect, priority, rename (NetworkManager only)')
  .option('--new-password <pw>', 'new password')
  .option('--autoconnect <on|off>', 'toggle autoconnect (Linux only)')
  .option('--priority <n>', 'autoconnect priority (Linux only)')
  .option('--rename <name>', 'rename profile (Linux only)')
  .action(async (profile, opts) => {
    try {
      let npw = opts.newPassword;
      if (npw === undefined && !opts.autoconnect && opts.priority === undefined && !opts.rename) {
        if (!process.stdin.isTTY) failClosed('Nothing to edit — pass --new-password/--autoconnect/--priority/--rename');
        const v = await p.password({ message: 'New password', mask: '•' });
        if (p.isCancel(v)) { console.log('Cancelled.'); return; }
        npw = String(v) || undefined;
      }
      if (opts.autoconnect && !/^(on|off)$/.test(opts.autoconnect)) failClosed('--autoconnect must be on|off');
      if (opts.priority !== undefined && (!Number.isInteger(Number(opts.priority)) || Number(opts.priority) < -999 || Number(opts.priority) > 999)) failClosed('--priority must be an integer between -999 and 999');
      const ad: any = adapter();
      await ad.edit(profile, { newPassword: npw, autoconnect: opts.autoconnect, priority: opts.priority !== undefined ? Number(opts.priority) : undefined, rename: opts.rename });
      if (program.opts().json) printJson({ ok: true, edited: profile }); else console.log(`Saved "${profile}".`);
    } catch (e) { handleErr(e, raw(['edit', profile])); }
  });

program.command('on').description('Turn WiFi on').action(async () => { try { const ad: any = adapter(); await ad.radio(true, program.opts().interface); if (program.opts().json) printJson({ ok: true, radio: 'on' }); else console.log('WiFi on.'); } catch (e) { handleErr(e, raw(['on'])); } });
program.command('off').description('Turn WiFi off').action(async () => { try { const ad: any = adapter(); await ad.radio(false, program.opts().interface); if (program.opts().json) printJson({ ok: true, radio: 'off' }); else console.log('WiFi off.'); } catch (e) { handleErr(e, raw(['off'])); } });

program.command('doctor')
  .description('Troubleshoot: adapter, radio, scan, connection, DNS with fix hints')
  .action(async () => {
    try { const ad: any = adapter(); const checks = await ad.doctor(program.opts().interface); if (program.opts().json) printJson({ ok: true, checks }); else { console.log('Diagnosis:'); for (const c of checks) console.log(`  ${(c.ok ? '✓' : '✗')} ${c.name}: ${c.hint}`); } }
    catch (e) { handleErr(e, raw(['doctor'])); }
  });

program.command('upgrade')
  .description('Upgrade openwifi from the public GitHub repository')
  .action(async () => {
    try {
      if (!program.opts().json) console.log('Updating openwifi from GitHub…');
      await upgradeFromGithub();
      if (program.opts().json) printJson({ ok: true, source: 'github:tanulmittal/wifi-cli' });
      else console.log('Update complete. Run openwifi --version to check the installed version.');
    } catch (e) { handleErr(e, raw(['upgrade'])); }
  });

// Bare `openwifi` -> guided menu (non-tech default)
if (!process.argv.slice(2).length) { guided([]).catch(e => { console.error(e?.message ?? e); process.exit(1); }); }
else program.parseAsync(process.argv);
