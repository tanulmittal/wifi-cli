# Project memory

- Public install source is `github:tanulmittal/wifi-cli` with npm `--install-links`; the scoped npm package was intentionally dropped.
- Normal CLI use must not download dependencies. `openwifi upgrade` explicitly uses GitHub and requires internet access.
- A real Ubuntu 26.04.1 server uses Netplan + `systemd-networkd` + `wpa_supplicant` over WiFi. Switching network managers remotely risks losing SSH. Keep this backend read-only until persistent writes have a safe design and validation.
- The user prefers to run commands on the server themselves and share output; do not operate their Termius session.
- npm treats a Git dependency containing an npm `build` script as needing preparation. On the server's npm 9, that nested install collided with the existing global package (`ENOTEMPTY`). The development command is `npm run bundle`; the Git install uses committed `dist/` files.
