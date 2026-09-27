export declare function platform(): 'linux' | 'macos' | 'unsupported';
export declare function adapter(): {
    scan(iface?: string, timeoutMs?: number): Promise<import("./linux.js").Net[]>;
    connect(ssid: string, o?: {
        password?: string;
        hidden?: boolean;
        iface?: string;
        timeoutMs?: number;
    }): Promise<import("../util.js").RunResult>;
    list(): Promise<import("./linux.js").Profile[]>;
    status(iface?: string): Promise<{
        backend: "iwctl";
        detail: string;
        active?: undefined;
        devices?: undefined;
    } | {
        backend: "nmcli";
        active: string;
        devices: string;
        detail?: undefined;
    }>;
    disconnect(iface?: string): Promise<import("../util.js").RunResult>;
    forget(name: string): Promise<import("../util.js").RunResult>;
    edit(name: string, o: {
        newPassword?: string;
        autoconnect?: "on" | "off";
        priority?: number;
        rename?: string;
    }): Promise<void>;
    radio(on: boolean, iface?: string): Promise<import("../util.js").RunResult>;
    doctor(): Promise<{
        name: string;
        ok: boolean;
        hint: string;
    }[]>;
    kind: "linux";
} | {
    scan(timeoutMs?: number): Promise<import("./linux.js").Net[]>;
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
    kind: "macos";
};
