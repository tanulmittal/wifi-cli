# Tasks

- DONE — Publish a GitHub-installable bundled `openwifi` command with an upgrade command.
- DONE — Detect `wpa_cli` and support status/scan on `wpa_supplicant` hosts with explicit write limitations; validated with mocked commands and build.
- DONE — Remove the Git-install preparation trigger; the user installed the bundled command on Ubuntu.
- IN PROGRESS — Validate experimental Netplan connection on a real Ubuntu host with the user's physical console access. A beta.1 attempt reported success but persisted an escaped SSID while the server returned to Airtel. A regression guard now rejects already configured targets before a trial; new-target switching remains live-unverified.
- DONE — Validate `wpa_cli` scan/status on the real Ubuntu host. UTF-8 scan display defect found and fixed locally with regression tests.
- IN PROGRESS — Validate Netplan forget of the inactive malformed beta.1 iPhone profile on the real host. Temporary-file tests pass; the current Airtel profile remains protected.
- TODO — Decide whether to release Netplan connection from the test branch after live validation.
