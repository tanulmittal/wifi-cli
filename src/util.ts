import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

export type RunResult = { stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;

let injected: Runner | null = null;
// ponytail: test hook only, no DI framework — setRunner in tests, reset after.
export function setRunner(r: Runner | null) { injected = r; }

export async function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  if (injected) return injected(cmd, args, opts);
  try {
    const { stdout, stderr } = await execFile(cmd, args, { timeout: opts.timeoutMs ?? 25000, windowsHide: true });
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
  } catch (e: any) {
    const err: any = new Error(redact(`${cmd} ${args.join(' ')} failed: ${(e.stdout ?? '')}${(e.stderr ?? '')}${e.message ?? ''}`));
    err.code = e.code;
    err.stdout = e.stdout ? String(e.stdout) : '';
    err.stderr = e.stderr ? String(e.stderr) : '';
    err.status = e.code;
    throw err;
  }
}

export async function which(cmd: string): Promise<boolean> {
  try {
    await run(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return true;
  } catch { return false; }
}

export function redact(s: string): string {
  return s.replace(/--password\s+\S+/g, '--password ***').replace(/\bpassword\s+"[^"]*"/gi, 'password "***"').replace(/\bpsk\s+\S+/gi, 'psk ***');
}

export function isAuthError(e: any): boolean {
  const s = `${e?.message ?? ''} ${e?.stderr ?? ''} ${e?.stdout ?? ''}`.toLowerCase();
  return /not authorized|permission denied|operation not permitted|requires? (root|privilege|sudo)|polkit|eperm|exit code 4\b/.test(s);
}

export function sudoHint(argv: string[]): string {
  const q = argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  return `This needs admin rights. Re-run with:\n  sudo openwifi ${q}\nNothing was changed.`;
}

export function printJson(obj: unknown) { console.log(JSON.stringify(obj, null, 2)); }

export function failClosed(msg: string): never {
  throw new Error(`${msg} (not supported in openwifi v1 — nothing was changed)`);
}
