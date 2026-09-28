# wifi-cli (`openwifi`)

Friendly WiFi manager for Ubuntu / Linux and macOS. Built for non-tech users: bare `openwifi` is guided, flags work for scripts.

```sh
npm install -g github:tanulmittal/wifi-cli --install-links
openwifi               # guided menu
openwifi --help
openwifi scan
openwifi connect "MyWifi"
openwifi status --json
openwifi forget "OldWifi"
openwifi doctor
openwifi upgrade       # fetch and install the latest main branch from GitHub
```

This installs directly from the public [GitHub repository](https://github.com/tanulmittal/wifi-cli). `--install-links` makes npm copy the Git package instead of linking its temporary clone (the default may leave a broken `openwifi` command). Node.js 18+ and npm are required. The installed CLI bundles its JavaScript dependencies and makes no package downloads when run.

## Commands

- `openwifi` — guided menu (connect, search, status, saved, forget, edit, troubleshoot, on/off)
- `openwifi scan [--interface NAME] [--json]` (macOS needs Location Services permission; guided connect offers manual SSID entry if unavailable)
- `openwifi connect <SSID> [-p|--password] [--hidden] [--no-save]` (`--hidden` on Linux; `--no-save` currently reports unsupported before changing anything)
- `openwifi list | status | disconnect` (+ `--json`)
- `openwifi forget|remove <profile>` (confirms unless `--yes`; on Netplan, only inactive profiles created by `openwifi` can be removed, and they may remain in wpa_supplicant until reconfiguration/reboot)
- `openwifi edit <profile> --new-password … --autoconnect on|off --priority N --rename NAME` (NetworkManager only; macOS password changes are not supported safely yet)
- `openwifi on | off`, `openwifi doctor [--json]`
- `openwifi upgrade` — runs `npm install -g github:tanulmittal/wifi-cli --install-links`. Requires internet access while upgrading; no network access is needed for normal commands.

Needs admin? It prints the exact `sudo openwifi …` re-run — never auto-elevates. Passwords use hidden prompts, system stores only (NetworkManager / Keychain), never logged.

## Platform notes

- Linux: NetworkManager `nmcli` supports full profile management. `iwctl` supports scan/status. On Netplan + `systemd-networkd` + `wpa_supplicant`, scan/status/list work, and `sudo openwifi connect "SSID" --interface wlp2s0` can trial a **new** WPA-Personal or open network. Already configured networks are rejected before a trial; switching those safely is not supported yet. It asks for the password privately and warns before switching. A 90-second `netplan try` window rolls back unless the new SSID and IP address are confirmed; a successful trial writes a root-only Netplan YAML file. **Have physical console access before testing this on a remote host.** Netplan documents rollback caveats, so verify the current connection and use the console if SSH drops. Netplan can forget only inactive profiles it created, including malformed escaped-SSID profiles from beta.1; existing Netplan profiles must be edited manually from the console. Netplan edit/disconnect/radio controls remain unsupported. These are operating-system WiFi services, not JavaScript dependencies; the CLI does not install or replace them.
- macOS: `networksetup` + system profiler scan fallback; allow Location Services for your terminal if names are hidden. This macOS version has no `airport` executable, so `disconnect` explains the limitation instead of switching WiFi off and on.
- v1 skips: Windows, enterprise EAP UI, static IP/DNS, band pinning (fail closed with guidance).

## Dev

```sh
npm install; npm run bundle; npm test; node dist/openwifi.cjs --help
```
