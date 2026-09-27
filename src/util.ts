import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

export type RunResult = { stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[], opts?: { timeoutMs?: number; secrets?: string[] }) => Promise<RunResult>;

let injected: Runner | null = null;
// ponytail: test hook only, no DI framework — setRunner in tests, reset after.
export function setRunner(r: Runner | null) { injected = r; }

export async function run(cmd: string, args: string[], opts: { timeoutMs?: number; secrets?: string[] } = {}): Promise<RunResult> {
  if (injected) return injected(cmd, args, opts);
  try {
    const { stdout, stderr } = await execFile(cmd, args, { timeout: opts.timeoutMs ?? 25000, windowsHide: true });
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
  } catch (e: any) {
    // Never include arguments in errors: network passwords are passed as argv to OS tools.
    const err: any = new Error(`${cmd} failed: ${redact(`${e.stderr ?? ''} ${e.message ?? ''}`, [...args, ...(opts.secrets ?? []).flatMap(s => ['password', s])])}`);
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

export function redact(s: string, args: string[] = []): string {
  for (const secret of args.filter((_, i) => ['password', 'wifi-sec.psk'].includes(args[i - 1]))) {
    if (secret) s = s.replaceAll(secret, '***');
  }
  return s.replace(/--(?:new-)?password\s+\S+/gi, '--password ***').replace(/\bpsk\s+\S+/gi, 'psk ***');
}

export function isAuthError(e: any): boolean {
  const s = `${e?.message ?? ''} ${e?.stderr ?? ''} ${e?.stdout ?? ''}`.toLowerCase();
  return /not authorized|permission denied|operation not permitted|requires? (root|privilege|sudo)|polkit|eperm|exit code 4\b/.test(s);
}

export function sudoHint(argv: string[]): string {
  const q = argv.filter(a => a !== 'openwifi').map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  return `This needs admin rights. Re-run with:\n  sudo openwifi ${q}`;
}

export function printJson(obj: unknown) { console.log(JSON.stringify(obj, null, 2)); }

export function failClosed(msg: string): never {
  throw new Error(`${msg} (not supported in openwifi v1 — nothing was changed)`);
}
