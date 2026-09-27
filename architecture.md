# Architecture

The TypeScript entry point in `src/cli.ts` parses commands; `src/interactive.ts` handles guided prompts. `src/adapters/index.ts` selects Linux or macOS. `src/util.ts` runs system commands without a shell and provides the mocked runner used in tests. `src/upgrade.ts` reinstalls the public GitHub package on request.

Linux backend selection prefers `nmcli`, then `iwctl`, then `wpa_cli`. NetworkManager handles reads and writes; the other two provide scan/status only. `wpa_cli` communicates with an existing `wpa_supplicant` control interface and may require `sudo`. It does not edit Netplan files. macOS uses `networksetup` and system discovery tools. The build emits a bundled `dist/openwifi.cjs` executable for offline runtime use.
