import { type ChildProcess } from 'node:child_process';
declare let startTrial: (args: string[]) => ChildProcess;
export declare function setTrialStarter(start: typeof startTrial | null): void;
export declare function netplanCandidate(iface: string, ssid: string, password?: string, hidden?: boolean): string;
export declare function parseWpaNetworks(text: string): {
    id: string;
    ssid: string;
}[];
export declare function tryNetplanConnection(candidate: string, iface: string, ssid: string): Promise<void>;
export declare function connectNetplan(ssid: string, options?: {
    password?: string;
    hidden?: boolean;
    iface?: string;
    save?: boolean;
}): Promise<void>;
export {};
