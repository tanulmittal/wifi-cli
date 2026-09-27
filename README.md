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
```

This installs directly from the public [GitHub repository](https://github.com/tanulmittal/wifi-cli). `--install-links` makes npm copy the Git package instead of linking its temporary clone (the default may leave a broken `openwifi` command). Node.js 18+ and npm are required. The installed CLI bundles its JavaScript dependencies and makes no package downloads when run.

## Commands

- `openwifi` — guided menu (connect, search, status, saved, forget, edit, troubleshoot, on/off)
- `openwifi scan [--interface NAME] [--json]` (macOS needs Location Services permission; guided connect offers manual SSID entry if unavailable)
- `openwifi connect <SSID> [-p|--password] [--hidden] [--no-save]` (`--hidden` on Linux; `--no-save` currently reports unsupported before changing anything)
- `openwifi list | status | disconnect` (+ `--json`)
- `openwifi forget|remove <profile>` (confirms unless `--yes`)
- `openwifi edit <profile> --new-password … --autoconnect on|off --priority N --rename NAME` (NetworkManager only; macOS password changes are not supported safely yet)
- `openwifi on | off`, `openwifi doctor [--json]`

Needs admin? It prints the exact `sudo openwifi …` re-run — never auto-elevates. Passwords use hidden prompts, system stores only (NetworkManager / Keychain), never logged.

## Platform notes

- Linux: NetworkManager `nmcli` is required to connect, edit, and manage saved networks. `iwctl`-only systems get scan/status. These are operating-system WiFi services, not JavaScript dependencies; the CLI cannot provide a WiFi radio or safely install/activate a system service on a remote server. Run `openwifi doctor` if the manager is missing. On a remote server, check that it has a WiFi adapter (`ip -br link`) and how its network is managed before installing or starting NetworkManager; changing a server's network service can cut off SSH access.
- macOS: `networksetup` + system profiler scan fallback; allow Location Services for your terminal if names are hidden. This macOS version has no `airport` executable, so `disconnect` explains the limitation instead of switching WiFi off and on.
- v1 skips: Windows, enterprise EAP UI, static IP/DNS, band pinning (fail closed with guidance).

## Dev

```sh
npm install; npm run build; npm test; node dist/openwifi.cjs --help
```
