# wifi-cli (`openwifi`)

Friendly WiFi manager for Ubuntu / Linux and macOS. Built for non-tech users: bare `openwifi` is guided, flags work for scripts.

```sh
npm install -g github:tanulmittal/wifi-cli --install-links
openwifi               # guided menu
openwifi --help
openwifi scan
openwifi connect "MyWifi"
openwifi use "MyWifi"        # switch back to a network you saved earlier
openwifi status --json
openwifi forget "OldWifi"
openwifi doctor
openwifi upgrade               # install the newest tagged release from GitHub
```

This installs directly from the public [GitHub repository](https://github.com/tanulmittal/wifi-cli). `--install-links` makes npm copy the Git package instead of linking its temporary clone (the default may leave a broken `openwifi` command). Node.js 18+ and npm are required. The installed CLI bundles its JavaScript dependencies and makes no package downloads when run.

## Commands

- `openwifi` — guided menu (connect, search, status, disconnect, saved, switch to a saved network, forget, edit, troubleshoot; on/off appears only where supported)
- `openwifi scan [--interface NAME] [--json]` (macOS needs Location Services permission; guided connect offers manual SSID entry if unavailable)
- `openwifi connect <SSID> [-p|--password|--password-stdin] [--hidden] [--no-save] [--no-follow]` (`--hidden` on Linux; `--no-save` reports unsupported before changing anything; `--password-stdin` keeps the secret out of shell history and `ps`)
- `openwifi use <SSID>` — switch to a network you already saved, without changing configuration
- `openwifi list | status | disconnect` (+ `--json`)
- `openwifi forget|remove <profile>` (confirms unless `--yes`; on Netplan, only inactive profiles created by `openwifi` can be removed)
- `openwifi edit <profile> --new-password … --rename NAME` (NetworkManager or Netplan; Netplan rejects `--autoconnect` and `--priority`; macOS password changes are not supported safely yet)
- `openwifi on | off`, `openwifi doctor [--json] [--fix]` (`--fix` repairs generated WiFi config that an unfinished trial left behind)
- `openwifi upgrade [--force]` — finds the newest `v*` release tag on GitHub and installs that exact tag, so a newer install is never replaced by an older branch. Requires internet access while upgrading; no network access is needed for normal commands.

Needs admin? It prints the exact `sudo openwifi …` re-run — never auto-elevates. Passwords use hidden prompts, system stores only (NetworkManager / Keychain), never logged.

## Platform notes

- Linux: NetworkManager `nmcli` supports full profile management. `iwctl` supports scan/status. On Netplan + `systemd-networkd` + `wpa_supplicant`, scan/status/list work, and `sudo openwifi connect "SSID" --interface wlp2s0` can trial a **new** WPA-Personal or open network. Already saved networks are rejected before a trial, with a hint to use `openwifi use`. A 90-second `netplan try` window rolls back unless the new SSID and an IP address are confirmed; a successful trial writes a root-only Netplan YAML file and removes the extra timestamped YAML Netplan creates. The trial runs in a background worker that outlives SSH, so a mid-switch disconnect does not cancel it: reconnect and run `openwifi status` to read the outcome (state in `/run/openwifi/connect.json`, log in `/run/openwifi/connect.log`; `--no-follow` returns as soon as the worker starts). Netplan has no per-profile priority, so a new profile sits alongside the existing ones and the boot-time choice is not deterministic; forget the one you no longer want. A rolled-back trial also drops its own wpa_supplicant entry, regenerates the generated `/run/netplan/wpa-<iface>.conf`, and deletes the candidate YAML that holds the password; `openwifi doctor` reports any leftover written by an older build and `sudo openwifi doctor --fix` cleans it (the running connection keeps its association until the next reconnect or reboot). Edits to the active profile still run in the foreground, so keep physical console access for those. Netplan can forget only inactive profiles it created. `edit` can change an existing Netplan SSID or WPA password while preserving other settings. `disconnect` is temporary; the manager may reconnect. `on/off` uses installed `rfkill` or reports that radio control is unavailable when it is missing. No command installs or replaces Ubuntu network services. The CLI includes its YAML editor in the bundled JavaScript.
- macOS: `networksetup` + system profiler scan fallback; allow Location Services for your terminal if names are hidden. This macOS version has no `airport` executable, so `disconnect` explains the limitation instead of switching WiFi off and on.
- v1 skips: Windows, enterprise EAP UI, static IP/DNS, band pinning (fail closed with guidance).

## Dev

```sh
npm install; npm run bundle; npm test; node dist/openwifi.cjs --help
```
