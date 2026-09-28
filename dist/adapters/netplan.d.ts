import { type ChildProcess } from 'node:child_process';
declare let startTrial: (args: string[]) => ChildProcess;
export declare function setTrialStarter(start: typeof startTrial | null): void;
export declare function setNetplanDirForTests(dir: string | null): void;
export declare function setNetplanTempRootForTests(dir: string | null): void;
export declare function netplanCandidate(iface: string, ssid: string, password?: string, hidden?: boolean): string;
export declare function parseWpaNetworks(text: string): {
    id: string;
    ssid: string;
}[];
export declare function tryNetplanConnection(candidate: string, iface: string, ssid: string, forceReconnect?: boolean, expectedPassword?: string): Promise<void>;
export declare function removeNewTrialCopies(saved: string, content: string, previous: Set<string>): Promise<void>;
export declare function isOpenwifiProfile(ssid: string, iface?: string): Promise<boolean>;
export declare function requireNetplanForget(ssid: string, iface?: string): Promise<string[]>;
export declare function forgetNetplan(ssid: string, iface?: string): Promise<void>;
export declare function connectNetplan(ssid: string, options?: {
    password?: string;
    hidden?: boolean;
    iface?: string;
    save?: boolean;
}): Promise<void>;
export declare function editNetplan(ssid: string, changes: {
    newPassword?: string;
    autoconnect?: 'on' | 'off';
    priority?: number;
    rename?: string;
}, requestedIface?: string): Promise<void>;
export {};
