# Tasks

- DONE — Publish a GitHub-installable bundled `openwifi` command with an upgrade command.
- DONE — Detect `wpa_cli` and support status/scan on `wpa_supplicant` hosts with explicit write limitations; validated with mocked commands and build.
- DONE — Remove the Git-install preparation trigger; the user installed the bundled command on Ubuntu.
- IN PROGRESS — Validate experimental Netplan connection on a real Ubuntu host with the user's physical console access. A beta.1 attempt reported success but persisted an escaped SSID while the server returned to Airtel. Netplan also left a timestamped `.yaml` that remained active after the stable file was removed. The branch now cleans new timestamped trial files; new-target switching remains live-unverified.
- DONE — Validate `wpa_cli` scan/status on the real Ubuntu host. UTF-8 scan display defect found and fixed locally with regression tests.
- DONE — Validate removal of the inactive malformed beta.1 iPhone profile on the real host. Beta.4 removed its runtime entry and merged Netplan configuration now lists only Airtel; Airtel remained connected.
- DONE — Hide unavailable actions from the guided menu; Netplan edit now appears, while radio control stays hidden when rfkill is absent.
- IN PROGRESS — Validate beta.6 Netplan edit, temporary disconnect, and conditional rfkill radio control on Ubuntu. Mocked command tests pass; live edit/disconnect remain unverified. The user's server has no rfkill, so on/off must fail clearly without installing it.
- DONE — Verify beta.7 installed from exact Git commit on Ubuntu: the installed bundle SHA-256 matches the tested local bundle. JSON doctor/status/list/scan work; doctor reports Netplan editing accurately. Netplan and wpa_supplicant both list only Airtel, and the interface has IPv4. Priority edit, invalid password edits/connects, no-save connect, active-profile forget/remove, and radio on/off without rfkill all fail safely. Guided menu opens with available actions.
- IN PROGRESS — Test a disposable hotspot connection, edit, disconnect, and inactive-profile forget with physical-console recovery. Waiting for the test SSID and a user-entered WiFi password. The host's global install had reverted to 0.1.4 between user screenshots and SSH inspection, suggesting another installer changed it; exact-commit beta.7 is now verified.
- DONE — Validate a synthetic Netplan WiFi candidate with Ubuntu's installed `netplan generate --root-dir` in a temporary directory. It exited successfully without applying any live configuration; the temporary directory was removed.
- TODO — Run the command-by-command Ubuntu acceptance matrix, testing live writes one at a time with physical-console recovery and redacted output. Check GitHub install, reboot persistence, and upgrade last.
- TODO — Decide whether to release Netplan connection from the test branch after live validation.
