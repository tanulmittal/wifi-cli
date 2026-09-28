import type { Net } from './linux.js';
export declare function parseAirport(t: string): Net[];
export declare function defaultIface(): string;
export declare function parseSystemProfiler(t: string, iface: string): Net[];
export declare const macos: {
    scan(iface?: string, timeoutMs?: number): Promise<Net[]>;
    connect(ssid: string, o?: {
        password?: string;
        iface?: string;
        timeoutMs?: number;
        save?: boolean;
        hidden?: boolean;
    }): Promise<import("../util.js").RunResult>;
    list(iface?: string): Promise<{
        name: string;
    }[]>;
    use(ssid: string, iface?: string): Promise<{
        ssid: string;
        verified: boolean;
    }>;
    repair(): Promise<{
        removed: string[];
        remaining: string[];
        files: string[];
    }>;
    status(iface?: string): Promise<{
        interface: string;
        network: string;
        connected: boolean;
        power: string;
    }>;
    disconnect(iface?: string): Promise<{
        method: string;
    }>;
    forget(ssid: string, iface?: string): Promise<import("../util.js").RunResult>;
    edit(ssid: string, o: {
        newPassword?: string;
        autoconnect?: "on" | "off";
        priority?: number;
        rename?: string;
    }): Promise<never>;
    radio(on: boolean, iface?: string): Promise<import("../util.js").RunResult>;
    doctor(iface?: string): Promise<{
        name: string;
        ok: boolean;
        hint: string;
    }[]>;
};
