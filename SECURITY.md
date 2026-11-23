# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Write to **ebek@miko.ru** with:

- the module version and the MikoPBX version;
- what is affected and the impact you see;
- steps to reproduce (a proof of concept if you have one);
- whether the problem is already public.

Please do not include real bot tokens or personal data. We will acknowledge the report and agree on a fix
and a disclosure date with you.

## Supported versions

Only the latest released version receives security fixes.

## What matters for security

- **Bot tokens** are write-only: stored on the PBX, never returned by the REST API (only a short hint) and never
  written to logs. Messenger HTTP URLs, headers and bodies are not logged.
- **Hub API key**: the module creates its own Core API key, bound to the PBX itself (localhost), with `read`
  access to the resources it polls and `admin` only on two ModuleLocalSpeechToText paths (`/workers`, `/jobs`);
  it sends only GET requests. The key is removed on uninstall.
- **Outbound connections**: `api.telegram.org`, `platform-api2.max.ru` (and the upload CDN host MAX returns, under
  `*.okcdn.ru` / `*.mycdn.me`; the token is never sent there), an optional proxy set by the administrator, and
  the PBX's own REST API on `127.0.0.1`.
- **TLS**: verification is never disabled. The bundled Russian Trusted Root CA
  (`Lib/Channels/Max/certs/russian_trusted_ca.pem`, SHA-256
  `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`) is used only
  for MAX.
- **Personal data** (phone numbers, names, event texts, recordings) leaves the PBX only as the administrator
  configured: notifications are off by default, phone masking and attachment switches are honoured.
- The module does not change MikoPBX Core and reads other modules only through their public REST API.
