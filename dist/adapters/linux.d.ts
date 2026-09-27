export type Net = {
    ssid: string;
    signal: number;
    security: string;
    bssid?: string;
    freq?: string;
};
export type Profile = {
    name: string;
    uuid?: string;
    type?: string;
};
export declare function backend(): Promise<'nmcli' | 'iwctl' | 'wpa_cli' | 'none'>;
export declare function requireConnectBackend(): Promise<void>;
export declare function parseNmcliWifi(t: string): Net[];
export declare function parseIwNetworks(t: string): Net[];
export declare function parseWpaResults(t: string): Net[];
export declare const linux: {
    scan(iface?: string, timeoutMs?: number): Promise<Net[]>;
    connect(ssid: string, o?: {
        password?: string;
        hidden?: boolean;
        iface?: string;
        timeoutMs?: number;
        save?: boolean;
    }): Promise<import("../util.js").RunResult>;
    list(): Promise<Profile[]>;
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
        ssid: any;
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
    disconnect(iface?: string): Promise<import("../util.js").RunResult>;
    forget(name: string): Promise<import("../util.js").RunResult>;
    edit(name: string, o: {
        newPassword?: string;
        autoconnect?: "on" | "off";
        priority?: number;
        rename?: string;
    }): Promise<void>;
    radio(on: boolean, iface?: string): Promise<import("../util.js").RunResult>;
    doctor(iface?: string): Promise<{
        name: string;
        ok: boolean;
        hint: string;
    }[]>;
};
