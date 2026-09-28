# Project memory

- Public install source is `github:tanulmittal/wifi-cli` with npm `--install-links`; the scoped npm package was intentionally dropped.
- Normal CLI use must not download dependencies. `openwifi upgrade` explicitly uses GitHub and requires internet access.
- A real Ubuntu 26.04.1 server uses Netplan + `systemd-networkd` + `wpa_supplicant` over WiFi. The user confirmed physical console access. An experimental timed Netplan connection is being prepared on a test branch; do not call it live-verified until the user tests it. Never replace its network manager remotely.
- The user prefers to run commands on the server themselves and share output; do not operate their Termius session.
- Real-host beta testing exposed `wpa_cli` escaped SSIDs and a misleading guided Forget path. Local fixes decode/filter scan names and restrict Netplan Forget to inactive openwifi-owned profiles before confirmation. A prior beta may have saved an escaped SSID; inspect read-only server state before attempting to migrate it.
- npm treats a Git dependency containing an npm `build` script as needing preparation. On the server's npm 9, that nested install collided with the existing global package (`ENOTEMPTY`). The development command is `npm run bundle`; the Git install uses committed `dist/` files.
