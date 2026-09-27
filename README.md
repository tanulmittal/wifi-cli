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

This installs directly from the public [GitHub repository](https://github.com/tanulmittal/wifi-cli). `--install-links` makes npm copy the Git package instead of linking its temporary clone (the default may leave a broken `openwifi` command). Node.js 18+ and npm are required; no npm registry release is needed.

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

- Linux: NetworkManager `nmcli` for full use; `iwctl`-only systems get scan/status + a clear upgrade hint.
- macOS: `networksetup` + system profiler scan fallback; allow Location Services for your terminal if names are hidden. This macOS version has no `airport` executable, so `disconnect` explains the limitation instead of switching WiFi off and on.
- v1 skips: Windows, enterprise EAP UI, static IP/DNS, band pinning (fail closed with guidance).

## Dev

```sh
npm install; npm run build; npm test; node dist/cli.js --help
```
