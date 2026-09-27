import type { Net } from './linux.js';
export declare function parseAirport(t: string): Net[];
export declare function defaultIface(): string;
export declare const macos: {
    scan(timeoutMs?: number): Promise<Net[]>;
    connect(ssid: string, o?: {
        password?: string;
        iface?: string;
        timeoutMs?: number;
    }): Promise<import("../util.js").RunResult>;
    list(iface?: string): Promise<{
        name: string;
    }[]>;
    status(iface?: string): Promise<{
        interface: string;
        network: string;
        power: string;
    }>;
    disconnect(iface?: string): Promise<{
        interface: string;
        method: string;
    }>;
    forget(ssid: string, iface?: string): Promise<import("../util.js").RunResult>;
    edit(ssid: string, o: {
        newPassword?: string;
        autoconnect?: "on" | "off";
        priority?: number;
        rename?: string;
    }): Promise<import("../util.js").RunResult>;
    radio(on: boolean, iface?: string): Promise<import("../util.js").RunResult>;
    doctor(iface?: string): Promise<{
        name: string;
        ok: boolean;
        hint: string;
    }[]>;
};
