export declare const UPGRADE_REPO = "https://github.com/tanulmittal/wifi-cli.git";
export declare const UPGRADE_SLUG = "github:tanulmittal/wifi-cli";
export declare const MANUAL_INSTALL = "sudo npm install -g github:tanulmittal/wifi-cli --install-links";
type Version = {
    parts: number[];
    pre: string | null;
};
export declare function parseVersion(value: string): Version | null;
export declare function compareVersions(a: string, b: string): number;
export declare function newestTag(lsRemoteOutput: string): string | null;
export type UpgradeResult = {
    updated: boolean;
    from: string;
    to: string;
    manual: string;
};
export declare function upgradeFromGithub(opts?: {
    force?: boolean;
    current?: string;
}): Promise<UpgradeResult>;
export {};
