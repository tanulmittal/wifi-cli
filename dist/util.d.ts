export type RunResult = {
    stdout: string;
    stderr: string;
};
export type Runner = (cmd: string, args: string[], opts?: {
    timeoutMs?: number;
    secrets?: string[];
}) => Promise<RunResult>;
export declare function setRunner(r: Runner | null): void;
export declare function run(cmd: string, args: string[], opts?: {
    timeoutMs?: number;
    secrets?: string[];
}): Promise<RunResult>;
export declare function which(cmd: string): Promise<boolean>;
export declare function redact(s: string, args?: string[]): string;
export declare function isAuthError(e: any): boolean;
export declare function sudoHint(argv: string[]): string;
export declare function printJson(obj: unknown): void;
export declare function failClosed(msg: string): never;
