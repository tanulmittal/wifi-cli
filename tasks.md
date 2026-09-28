# Tasks

- DONE — Publish a GitHub-installable bundled `openwifi` command with an upgrade command.
- DONE — Detect `wpa_cli` and support status/scan on `wpa_supplicant` hosts with explicit write limitations; validated with mocked commands and build.
- DONE — Validate `wpa_cli` scan/status/list/doctor on the real Ubuntu host, including UTF-8 SSID decoding and Netplan backend detection.
- DONE — Remove the inactive malformed beta.1 iPhone profile and its runtime entry on the real host; Airtel stayed connected.
- DONE — Hide unavailable guided actions (radio control without rfkill) and confirm link-changing Netplan actions.
- DONE — Diagnose the beta.7 trial failure: the CLI died with the SSH session, so nothing confirmed the trial and `netplan try --timeout 90` auto-reverted (applied 16:30:21, reverted 16:31:07, Airtel restored).
- DONE — Run the Netplan trial in a detached worker with state in `/run/openwifi/connect.json` and a root-only log; `connect` follows it, `status` reports the outcome, and the password-bearing candidate is deleted on every path.
- DONE — Add `openwifi use <saved SSID>` so a host can return to a previous network after a trial, and point the already-saved connect error at it.
- DONE — `doctor` compares the generated `/run/netplan/wpa-<iface>.conf` with the saved Netplan config; both `doctor --fix` and the trial worker regenerate it, and a rollback also drops the trial's runtime entry and candidate file.
- DONE — `upgrade` resolves the newest `v*` GitHub tag with `git ls-remote` and installs that tag, refusing to downgrade without `--force`, instead of installing the default branch (main, 0.1.4) over a newer beta.
- DONE — Live-verified the detached trial on Ubuntu: a trial to a deliberately nonexistent SSID dropped SSH, and the worker outlived the session, detected the failure after 47 seconds, cleaned up the generated config and the runtime entry, recorded `rolled-back`, and returned the host to Airtel. `openwifi status` reported the outcome after reconnecting.
- DONE — Live-verified `doctor`, `doctor --fix` (no link drop), `use`, `list`, `status`, and tag-based `upgrade` on the real host; the installed bundle SHA-256 matched the tested local bundle.
- DONE — 40 unit tests cover detached dispatch, worker success/rollback/cleanup, `use`, generated-config detection and repair, tag selection, and password-free worker arguments.
- TODO — Live matrix still open: connect to the iPhone hotspot, edit its inactive profile, forget it, then `disconnect` last. Blocked until the hotspot is discoverable in a fresh scan.
- TODO — Reboot-persistence check for a saved Netplan profile, from the physical console.
- TODO — Merge `netplan-connect` into `main` and tag a stable release once the remaining matrix passes.
