#!/usr/bin/env node
import { Command } from 'commander';
import * as p from '@clack/prompts';
import { adapter } from './adapters/index.js';
import { isAuthError, sudoHint, printJson, failClosed } from './util.js';
import { guided, confirmRemoteWifiSwitch } from './interactive.js';
import { backend, requireConnectBackend } from './adapters/linux.js';
import { upgradeFromGithub } from './upgrade.js';
import { recordTrialFailure, runConnectTrial } from './adapters/netplan.js';
import { followTrial, isTrialDone, readTrialState, TRIAL_FOLLOW_MS } from './trial.js';
import { VERSION } from './version.js';
const program = new Command();
program
    .name('openwifi')
    .description('Friendly WiFi manager for Ubuntu/Linux and macOS. Bare `openwifi` is guided; flags work for scripts.')
    .version(VERSION)
    .option('--interface <name>', 'WiFi interface (e.g. wlan0, en0)')
    .option('--timeout <sec>', 'command timeout in seconds', '25')
    .option('--json', 'machine-readable JSON output')
    .option('--yes', 'skip confirmations (scripts)');
const tmo = () => {
    const seconds = Number(program.opts().timeout ?? 25);
    if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Error('--timeout must be a positive number of seconds');
    return seconds * 1000;
};
function handleErr(e, argv) {
    if (isAuthError(e)) {
        console.error(sudoHint(argv));
        process.exit(1);
    }
    if (program.opts().json)
        printJson({ ok: false, error: e?.message ?? String(e) });
    else
        console.error(`Error: ${e?.message ?? e}`);
    process.exit(1);
}
const raw = (args) => args;
program.command('scan')
    .description('Search nearby WiFi networks')
    .action(async (opts) => {
    try {
        const ad = adapter();
        const nets = await ad.scan(program.opts().interface, tmo());
        if (program.opts().json)
            printJson({ ok: true, count: nets.length, networks: nets });
        else {
            console.log(`Found ${nets.length} network(s):`);
            for (const n of nets)
                console.log(`  ${String(n.signal ?? '').padStart(3)}%  ${n.ssid}  (${n.security})`);
        }
    }
    catch (e) {
        handleErr(e, raw(['scan']));
    }
});
program.command('connect <ssid>')
    .description('Connect to a WiFi network (prompts for password if needed)')
    .option('-p, --password <pw>', 'password (prefer interactive prompt; shell history risk)')
    .option('--password-stdin', 'read the password from standard input')
    .option('--hidden', 'hidden SSID')
    .option('--no-save', 'unsupported in v1; exits before changing anything')
    .option('--no-follow', 'start a Netplan trial in the background and return immediately')
    .action(async (ssid, opts) => {
    try {
        if (opts.password !== undefined && opts.passwordStdin)
            failClosed('Use either --password or --password-stdin, not both');
        if (process.platform === 'linux')
            await requireConnectBackend();
        if (process.platform === 'linux' && await backend() === 'wpa_cli' && !program.opts().yes) {
            if (!process.stdin.isTTY)
                throw new Error('Switching WiFi through Netplan needs confirmation; run interactively or pass --yes if you have console access.');
            if (!await confirmRemoteWifiSwitch()) {
                console.log('Kept the current connection.');
                return;
            }
        }
        let pw = opts.password;
        if (opts.passwordStdin)
            pw = (await readStdin()).replace(/\r?\n$/, '') || undefined;
        else if (pw === undefined && process.stdin.isTTY) {
            const v = await p.password({ message: `Password for "${ssid}" (empty if open)`, mask: '•' });
            if (p.isCancel(v)) {
                console.log('Cancelled.');
                return;
            }
            pw = String(v) || undefined;
        }
        const ad = adapter();
        const outcome = await ad.connect(ssid, { password: pw, hidden: !!opts.hidden, iface: program.opts().interface, timeoutMs: tmo(), save: opts.save });
        if (outcome?.stateFile)
            return await reportTrial(ssid, outcome, opts.follow !== false);
        if (program.opts().json)
            printJson({ ok: true, ssid });
        else
            console.log(`Connected to "${ssid}".`);
    }
    catch (e) {
        handleErr(e, raw(['connect', ssid]));
    }
});
program.command('list')
    .description('List saved WiFi networks')
    .action(async () => {
    try {
        const ad = adapter();
        const items = await ad.list(program.opts().interface);
        if (program.opts().json)
            printJson({ ok: true, saved: items });
        else {
            if (!items.length)
                console.log('No saved networks.');
            for (const s of items)
                console.log(`  ${s.name}`);
        }
    }
    catch (e) {
        handleErr(e, raw(['list']));
    }
});
program.command('status')
    .description('Show current WiFi status')
    .action(async () => {
    try {
        const ad = adapter();
        const st = await ad.status(program.opts().interface);
        const trial = await readTrialState();
        if (program.opts().json)
            printJson({ ok: true, status: st, ...(trial ? { trial } : {}) });
        else {
            console.log(JSON.stringify(st, null, 2));
            if (trial)
                console.log(`\nLast connect trial: ${trial.phase} for "${trial.ssid}"${trial.error ? ` — ${trial.error}` : ''}\nState: ${trial.stateFile}\nLog:   ${trial.logFile}`);
        }
    }
    catch (e) {
        handleErr(e, raw(['status']));
    }
});
program.command('use <ssid>')
    .description('Switch to a saved network without changing configuration')
    .action(async (ssid) => {
    try {
        if (!await confirmLinkLoss('Switching network may drop SSH until the new association completes. Continue?'))
            return;
        const ad = adapter();
        const result = await ad.use(ssid, program.opts().interface);
        const unverified = result?.verified === false;
        if (program.opts().json)
            printJson({ ok: true, ...(result ?? { ssid }), ...(unverified ? { verified: false } : {}) });
        else
            console.log(unverified ? `Asked macOS to switch to "${ssid}", but it does not report the network name. Check with: openwifi status` : `Switched to "${ssid}".`);
    }
    catch (e) {
        handleErr(e, raw(['use', ssid]));
    }
});
program.command('disconnect')
    .description('Disconnect from current WiFi')
    .action(async () => {
    try {
        if (!await confirmLinkLoss('Disconnecting WiFi may drop SSH and the system may reconnect automatically. Continue?'))
            return;
        const ad = adapter();
        await ad.disconnect(program.opts().interface);
        const temporary = process.platform === 'linux' && await backend() === 'wpa_cli';
        const state = temporary ? await ad.status(program.opts().interface).then((s) => s.state).catch(() => 'unknown') : undefined;
        if (program.opts().json)
            printJson({ ok: true, ...(temporary ? { temporary, state } : {}) });
        else
            console.log(state === 'COMPLETED' ? 'The system reconnected automatically.' : temporary ? 'Disconnected for now; the system may reconnect automatically.' : 'Disconnected.');
    }
    catch (e) {
        handleErr(e, raw(['disconnect']));
    }
});
const forget = async (profile) => {
    try {
        const ad = adapter();
        if (process.platform === 'linux')
            await ad.requireForget(profile, program.opts().interface);
        if (!program.opts().yes && !process.stdin.isTTY)
            throw new Error('Forgetting a network needs confirmation; run interactively or pass --yes.');
        if (!program.opts().yes) {
            const ok = await p.confirm({ message: `Forget "${profile}"? You will need the password to rejoin.` });
            if (p.isCancel(ok) || !ok) {
                console.log('Kept.');
                return;
            }
        }
        await ad.forget(profile, program.opts().interface);
        const netplan = process.platform === 'linux' && await backend() === 'wpa_cli';
        if (program.opts().json)
            printJson({ ok: true, forgot: profile, ...(netplan ? { pendingReconfigure: true } : {}) });
        else
            console.log(netplan ? `Removed "${profile}" from saved Netplan configuration. It may remain available until network reconfiguration or reboot.` : `Forgot "${profile}".`);
    }
    catch (e) {
        handleErr(e, raw(['forget', profile]));
    }
};
program.command('forget <profile>').description('Forget / remove a saved network').action(forget);
program.command('remove <profile>').description('Alias of forget').action(forget);
program.command('edit <profile>')
    .description('Edit password or SSID; autoconnect/priority require NetworkManager')
    .option('--new-password <pw>', 'new password')
    .option('--autoconnect <on|off>', 'toggle autoconnect (Linux only)')
    .option('--priority <n>', 'autoconnect priority (Linux only)')
    .option('--rename <name>', 'rename profile (Linux only)')
    .action(async (profile, opts) => {
    try {
        let npw = opts.newPassword;
        if (npw === undefined && !opts.autoconnect && opts.priority === undefined && !opts.rename) {
            if (!process.stdin.isTTY)
                failClosed('Nothing to edit — pass --new-password/--autoconnect/--priority/--rename');
            const v = await p.password({ message: 'New password', mask: '•' });
            if (p.isCancel(v)) {
                console.log('Cancelled.');
                return;
            }
            npw = String(v) || undefined;
        }
        if (opts.autoconnect && !/^(on|off)$/.test(opts.autoconnect))
            failClosed('--autoconnect must be on|off');
        if (opts.priority !== undefined && (!Number.isInteger(Number(opts.priority)) || Number(opts.priority) < -999 || Number(opts.priority) > 999))
            failClosed('--priority must be an integer between -999 and 999');
        if (process.platform === 'linux' && await backend() === 'wpa_cli' && (opts.autoconnect || opts.priority !== undefined))
            failClosed('Netplan has no per-profile autoconnect or priority setting');
        if (!await confirmLinkLoss('Editing the current WiFi may drop SSH. Continue with physical console access?'))
            return;
        const ad = adapter();
        await ad.edit(profile, { newPassword: npw, autoconnect: opts.autoconnect, priority: opts.priority !== undefined ? Number(opts.priority) : undefined, rename: opts.rename }, program.opts().interface);
        if (program.opts().json)
            printJson({ ok: true, edited: profile });
        else
            console.log(`Saved "${profile}".`);
    }
    catch (e) {
        handleErr(e, raw(['edit', profile]));
    }
});
async function confirmLinkLoss(message) {
    if (process.platform !== 'linux' || await backend() !== 'wpa_cli' || program.opts().yes)
        return true;
    if (!process.stdin.isTTY)
        throw new Error('This may drop SSH; run interactively or pass --yes with physical console access.');
    const answer = await p.confirm({ message });
    return !p.isCancel(answer) && answer === true;
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}
// The Netplan trial runs in a detached worker, so this only reports what that worker recorded. When
// SSH drops mid-trial the worker keeps running and a later `openwifi status` shows the outcome.
async function reportTrial(ssid, initial, follow) {
    const json = !!program.opts().json;
    if (initial.alreadyConnected) {
        if (json)
            printJson({ ok: true, ssid, trial: initial });
        else
            console.log(`Already connected to "${ssid}".`);
        return;
    }
    if (!follow) {
        if (json)
            printJson({ ok: true, ssid, pending: true, trialId: initial.pid, stateFile: initial.stateFile, trial: initial });
        else
            console.log(`Trying "${ssid}" in the background.\nSSH may drop now; that is expected. Reconnect and run: openwifi status\nState: ${initial.stateFile}\nLog:   ${initial.logFile}`);
        return;
    }
    if (!json)
        console.log(`Trying "${ssid}" for up to 90 seconds. SSH may drop; the background trial keeps running either way.`);
    const { state, timedOut } = await followTrial({ timeoutMs: TRIAL_FOLLOW_MS });
    if (timedOut) {
        if (json)
            printJson({ ok: true, ssid, pending: true, trialId: initial.pid, stateFile: initial.stateFile, trial: state });
        else
            console.log(`The trial is still running. Reconnect and run: openwifi status\nState: ${initial.stateFile}`);
        return;
    }
    if (isTrialDone(state) && state?.phase === 'ok') {
        if (json)
            printJson({ ok: true, ssid, saved: state.saved !== false, trialId: state.pid, stateFile: state.stateFile, trial: state });
        else
            console.log(state.saved === false ? `Connected to "${ssid}".` : `Connected to "${ssid}". Saved for reboot.`);
        return;
    }
    throw new Error(state?.error ?? 'The trial rolled back; the previous connection is unchanged.');
}
program.command('on').description('Turn WiFi on').action(async () => { try {
    const ad = adapter();
    await ad.radio(true, program.opts().interface);
    if (program.opts().json)
        printJson({ ok: true, radio: 'on' });
    else
        console.log('WiFi on.');
}
catch (e) {
    handleErr(e, raw(['on']));
} });
program.command('off').description('Turn WiFi off').action(async () => { try {
    if (!await confirmLinkLoss('Turning WiFi off will drop SSH. Continue with physical console access?'))
        return;
    const ad = adapter();
    await ad.radio(false, program.opts().interface);
    if (program.opts().json)
        printJson({ ok: true, radio: 'off' });
    else
        console.log('WiFi off.');
}
catch (e) {
    handleErr(e, raw(['off']));
} });
program.command('doctor')
    .description('Troubleshoot: adapter, radio, scan, connection, DNS with fix hints')
    .option('--fix', 'repair generated WiFi configuration left behind by an unfinished trial')
    .action(async (opts) => {
    try {
        const ad = adapter();
        const json = !!program.opts().json;
        let checks = await ad.doctor(program.opts().interface);
        const print = (list) => { if (json)
            printJson({ ok: true, checks: list });
        else {
            console.log('Diagnosis:');
            for (const c of list)
                console.log(`  ${(c.ok ? '✓' : '✗')} ${c.name}: ${c.hint}`);
        } };
        if (!opts.fix) {
            print(checks);
            return;
        }
        if (!checks.some((c) => !c.ok && (c.name === 'generated-config' || c.name === 'trial-files'))) {
            if (json)
                printJson({ ok: true, checks, repaired: { removed: [], remaining: [], files: [] } });
            else {
                print(checks);
                console.log('\nNothing to repair.');
            }
            return;
        }
        if (!await confirmLinkLoss('Regenerating the WiFi configuration may briefly disrupt the link. Continue?'))
            return;
        const repaired = await ad.repair(program.opts().interface);
        checks = await ad.doctor(program.opts().interface);
        if (json)
            printJson({ ok: true, checks, repaired });
        else {
            print(checks);
            const removed = repaired?.removed ?? [];
            console.log(removed.length ? `\nRepaired: removed ${removed.map((s) => `"${s}"`).join(', ')} from the generated WiFi config.` : '\nRepair ran; no stale network needed removing.');
            if (repaired?.files?.length)
                console.log(`Removed ${repaired.files.length} unfinished trial file(s).`);
            console.log('The running WiFi keeps its current association until the next reconnect or reboot.');
        }
    }
    catch (e) {
        handleErr(e, raw(['doctor']));
    }
});
program.command('upgrade')
    .description('Install the newest tagged release from the public GitHub repository')
    .option('--force', 'reinstall even when the installed version is the same or newer')
    .action(async (opts) => {
    try {
        if (!program.opts().json)
            console.log('Checking GitHub releases…');
        const result = await upgradeFromGithub({ force: !!opts.force });
        if (program.opts().json)
            printJson({ ok: true, ...result });
        else if (!result.updated)
            console.log(`Already up to date: ${result.from}. Newest release is ${result.to}. Use --force to reinstall.`);
        else
            console.log(`Updated ${result.from} to ${result.to}. Run openwifi --version to confirm.`);
    }
    catch (e) {
        handleErr(e, raw(['upgrade']));
    }
});
// Hidden worker command: see src/trial.ts. It must run outside the SSH session that started the
// trial, which is why `connect` re-executes the CLI instead of confirming the trial in-process.
program.command('__trial', { hidden: true })
    .requiredOption('--interface <name>')
    .requiredOption('--ssid <ssid>')
    .requiredOption('--candidate <path>')
    .action(async (opts) => {
    try {
        process.exitCode = await runConnectTrial({ iface: opts.interface, ssid: opts.ssid, candidate: opts.candidate });
    }
    catch (error) {
        await recordTrialFailure(opts.ssid, opts.interface, error);
        process.exitCode = 1;
    }
});
// Bare `openwifi` -> guided menu (non-tech default)
if (!process.argv.slice(2).length) {
    guided([]).catch(e => { console.error(e?.message ?? e); process.exit(1); });
}
else
    program.parseAsync(process.argv);
//# sourceMappingURL=cli.js.map