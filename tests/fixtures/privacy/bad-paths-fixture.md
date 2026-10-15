# Bad Path Test Fixture

This fixture deliberately contains forbidden machine absolute paths to verify the path auditor fails closed.

- Absolute macOS path leak: /Users/johndoe/Projects/secret-agent/run.log
- Absolute URI path leak: file:///Users/alice/Workspace/telemetry.json
- Absolute Linux user leak: /home/bob/agentpulse/data.db
