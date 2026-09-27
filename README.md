# wifi-cli (`openwifi`)

Friendly WiFi manager for Ubuntu / Linux and macOS. Built for non-tech users: bare `openwifi` is guided, flags work for scripts.

```sh
npm i -g @tanulmittal/wifi-cli  # or: bun add -g @tanulmittal/wifi-cli
openwifi               # guided menu
openwifi --help
openwifi scan
openwifi connect "MyWifi"
openwifi status --json
openwifi forget "OldWifi"
openwifi edit "MyWifi" --new-password "..."
openwifi doctor
```

Bun: `bunx openwifi scan` · npx: `npx openwifi scan`.

## Commands

- `openwifi` — guided menu (connect, search, status, saved, forget, edit, troubleshoot, on/off)
- `openwifi scan [--interface NAME] [--json]`
- `openwifi connect <SSID> [-p|--password] [--hidden] [--no-save]`
- `openwifi list | status | disconnect` (+ `--json`)
- `openwifi forget|remove <profile>` (confirms unless `--yes`)
- `openwifi edit <profile> --new-password … --autoconnect on|off --priority N --rename NAME` (macOS: password-only)
- `openwifi on | off`, `openwifi doctor [--json]`

Needs admin? It prints the exact `sudo openwifi …` re-run — never auto-elevates. Passwords use hidden prompts, system stores only (NetworkManager / Keychain), never logged.

## Platform notes

- Linux: NetworkManager `nmcli` for full use; `iwctl`-only systems get scan/status + a clear upgrade hint.
- macOS: `networksetup` + Airport scan; first scan may prompt for Location permission.
- v1 skips: Windows, enterprise EAP UI, static IP/DNS, band pinning (fail closed with guidance).

## Dev

```sh
npm install; npm run build; npm test; node dist/cli.js --help
```
