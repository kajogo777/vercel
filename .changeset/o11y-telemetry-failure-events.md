---
'vercel': patch
---

Record structured failure telemetry: error codes for all users, argument parse errors, unknown command/subcommand tokens (charset-gated), and sanitized crash reports. Gated behind `VERCEL_CLI_TELEMETRY_V2`.
