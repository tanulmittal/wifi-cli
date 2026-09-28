export declare function platform(): 'linux' | 'macos' | 'unsupported';
export declare function adapter(): {
    scan(iface?: string, timeoutMs?: number): Promise<import("./linux.js").Net[]>;
    connect(ssid: string, o?: {
        password?: string;
        hidden?: boolean;
        iface?: string;
        timeoutMs?: number;
        save?: boolean;
    }): Promise<import("../util.js").RunResult | import("../trial.js").TrialState>;
    use(ssid: string, iface?: string): Promise<{
        ssid: string;
        id: string;
    } | {
        ssid: string;
    }>;
    repair(iface?: string): Promise<{
        removed: string[];
        remaining: string[];
        files: string[];
    } | {
        removed: string[];
        remaining: string[];
    }>;
    list(iface?: string): Promise<import("./linux.js").Profile[]>;
    status(iface?: string): Promise<{
        backend: "iwctl";
        detail: string;
        state?: undefined;
        ssid?: undefined;
        bssid?: undefined;
        frequency?: undefined;
        active?: undefined;
        devices?: undefined;
    } | {
        backend: "wpa_cli";
        state: any;
        ssid: string;
        bssid: any;
        frequency: any;
        detail?: undefined;
        active?: undefined;
        devices?: undefined;
    } | {
        backend: "nmcli";
        active: string;
        devices: string;
        detail?: undefined;
        state?: undefined;
        ssid?: undefined;
        bssid?: undefined;
        frequency?: undefined;
    }>;
    disconnect(iface?: string): Promise<import("../util.js").RunResult | undefined>;
    requireForget(name: string, iface?: string): Promise<string[] | undefined>;
    forget(name: string, iface?: string): Promise<void | import("../util.js").RunResult>;
    edit(name: string, o: {
        newPassword?: string;
        autoconnect?: "on" | "off";
        priority?: number;
        rename?: string;
    }, iface?: string): Promise<void>;
    radio(on: boolean, iface?: string): Promise<import("../util.js").RunResult | undefined>;
    doctor(iface?: string): Promise<{
        name: string;
        ok: boolean;
        hint: string;
    }[]>;
    kind: "linux";
} | {
    scan(iface?: string, timeoutMs?: number): Promise<import("./linux.js").Net[]>;
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
    kind: "macos";
};
