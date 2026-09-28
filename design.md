# CLI experience

Bare `openwifi` opens a guided menu. Commands use plain-language names, hidden password input, explicit confirmation for forgetting a network, and readable troubleshooting hints. The menu hides radio control when its backend tool is unavailable and confirms link-changing Netplan actions. `--json` provides predictable output for scripts. When a backend cannot perform an action, explain the limitation before asking for credentials or changing the connection. Show an exact `sudo openwifi …` hint for permission failures.
