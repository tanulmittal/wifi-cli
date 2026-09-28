export type TrialPhase = 'starting' | 'trying' | 'ok' | 'rolled-back';
export type TrialState = {
    phase: TrialPhase;
    ssid: string;
    iface: string;
    pid: number;
    startedAt: string;
    finishedAt?: string;
    saved?: boolean;
    alreadyConnected?: boolean;
    error?: string;
    stateFile: string;
    logFile: string;
};
export declare const TRIAL_FOLLOW_MS = 150000;
export declare function setTrialStateDirForTests(dir: string | null): void;
export declare function trialStateDir(): string;
export declare function trialStateFile(): string;
export declare function trialLogFile(): string;
export declare function isTrialDone(state: TrialState | null): boolean;
export declare function readTrialState(): Promise<TrialState | null>;
export declare function writeTrialState(state: TrialState): Promise<void>;
export declare function appendTrialLog(line: string): Promise<void>;
export declare function workerArgv(entry: string, o: {
    iface: string;
    ssid: string;
    candidate: string;
}): string[];
type Spawned = {
    pid?: number;
    unref: () => void;
};
export declare function setTrialSpawnerForTests(spawner: ((cmd: string, argv: string[]) => Spawned) | null): void;
export declare function startDetachedTrial(o: {
    iface: string;
    ssid: string;
    candidate: string;
}): Promise<TrialState>;
export declare function followTrial(o?: {
    timeoutMs?: number;
}): Promise<{
    state: TrialState | null;
    timedOut: boolean;
}>;
export {};
