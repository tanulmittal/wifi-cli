import { type ChildProcess } from 'node:child_process';
import { type TrialState } from '../trial.js';
declare let startTrial: (args: string[]) => ChildProcess;
export declare function setTrialStarter(start: typeof startTrial | null): void;
export declare function setNetplanDirForTests(dir: string | null): void;
export declare function setNetplanTempRootForTests(dir: string | null): void;
export declare function setGeneratedConfDirForTests(dir: string | null): void;
export declare function netplanCandidate(iface: string, ssid: string, password?: string, hidden?: boolean): string;
export declare function parseWpaNetworks(text: string): {
    id: string;
    ssid: string;
}[];
export declare function tryNetplanConnection(candidate: string, iface: string, ssid: string, forceReconnect?: boolean, expectedPassword?: string): Promise<void>;
export declare function wifiInterface(requested?: string): Promise<string>;
export declare function removeNewTrialCopies(saved: string, content: string, previous: Set<string>): Promise<void>;
export declare function isOpenwifiProfile(ssid: string, iface?: string): Promise<boolean>;
export declare function requireNetplanForget(ssid: string, iface?: string): Promise<string[]>;
export declare function forgetNetplan(ssid: string, iface?: string): Promise<void>;
export declare function connectNetplan(ssid: string, options?: {
    password?: string;
    hidden?: boolean;
    iface?: string;
    save?: boolean;
}): Promise<TrialState>;
export declare function runConnectTrial(o: {
    iface: string;
    ssid: string;
    candidate: string;
}): Promise<number>;
export declare function useNetplan(ssid: string, requestedIface?: string): Promise<{
    ssid: string;
    id: string;
}>;
export declare function parseConfSsids(conf: string): string[];
export declare function generatedConfPath(iface: string): string;
export declare function ungeneratedSsids(iface: string): Promise<string[]>;
export declare function repairGeneratedConf(iface: string): Promise<{
    removed: string[];
    remaining: string[];
    files: string[];
}>;
export declare function leftoverCandidates(): Promise<string[]>;
export declare function recordTrialFailure(ssid: string, iface: string, error: unknown): Promise<void>;
export declare function editNetplan(ssid: string, changes: {
    newPassword?: string;
    autoconnect?: 'on' | 'off';
    priority?: number;
    rename?: string;
}, requestedIface?: string): Promise<void>;
export {};
