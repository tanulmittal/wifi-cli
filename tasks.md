# Tasks

- DONE — Publish a GitHub-installable bundled `openwifi` command with an upgrade command.
- DONE — Detect `wpa_cli` and support status/scan on `wpa_supplicant` hosts with explicit write limitations; validated with mocked commands and build.
- DONE — Remove the Git-install preparation trigger; the user installed the bundled command on Ubuntu.
- IN PROGRESS — Validate experimental Netplan connection on a real Ubuntu host with the user's physical console access. Local mocked trial/rollback tests pass; live switching is unverified.
- TODO — Validate `wpa_cli` scan/status/list on the real host using user-run commands.
- TODO — Decide whether to release Netplan connection from the test branch after live validation.
