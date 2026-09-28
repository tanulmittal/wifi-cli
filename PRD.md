# Product requirements

`wifi-cli` exposes the `openwifi` command for non-technical Linux and macOS users. A bare invocation opens a guided menu; explicit commands and `--json` support scripts. The main actions are scan, connect, list, status, disconnect, forget, edit, radio on/off, doctor, and upgrade.

The CLI must use the operating system's WiFi and credential stores, keep passwords out of logs, explain missing privileges, and fail before changing state when an operation is unsupported. Normal commands must work offline after installation; `upgrade` intentionally fetches from the public GitHub repository.

NetworkManager is the full Linux writer. `iwctl` supports status and discovery. On Netplan-managed `wpa_supplicant` hosts, connection to WPA-Personal and open networks is experimental: require root, warn about remote access, use a timed Netplan trial, verify SSID and IP, then save a root-only system profile. Forget can remove an inactive profile created by `openwifi`; existing Netplan profiles and the current connection are protected. Other Netplan writes remain unsupported. macOS uses system WiFi tools. Windows, enterprise EAP setup, static IP/DNS, and BSSID pinning remain out of scope.
