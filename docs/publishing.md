# Publishing (not done yet)

The module is free and open source (GPL-3.0-or-later). It will be published through
[mikopbx/module-applications](https://github.com/mikopbx/module-applications) — notes from reading that repository on
21.11.2026 (rules 0.3.0, schema v1; the process is a pilot, TERMS/PUBLISHER_AGREEMENT are still drafts).

## What CI does here

`.github/workflows/ci.yml`: on every push/PR to `develop` and `master` — `php -l`, `php Tests/run-all.php`,
`scripts/package-module.sh` → the zip as a workflow artifact (version `1.<run number>`). **It publishes nothing.**
The shared `mikopbx/.github-workflows/extension-publish.yml` used by MIKO modules uploads to releases.mikopbx.com on
`master` with MIKO secrets — do not use it here.

## How a submission works

1. A PR to module-applications adds exactly one file `applications/ModuleMessengerHub/application.yaml`
   (`templates/application.yaml`, `schema/application.schema.json`): `module_id`, `name`, `description`,
   `repo` (public GitHub URL), `commit` (**full 40-char SHA**, not a tag/branch), `license` (SPDX),
   `support_email`, `maintainers`, `compatibility {min_pbx_version, max_pbx_version, architectures}`.
2. Checks: terms checkbox, publisher-agreement comment, `tools/validate.py` (rules APP/PKG/MJ/CODE), then an
   install test in a clean `mikopbx/mikopbx` container (**no outbound network**, x86_64/arm64 as declared): install,
   `php -l`, enable, workers, `/check` (skip if absent), disable, uninstall (module row and dir must disappear),
   no `Uncaught`/`Throwable`/`ErrorException` log lines mentioning the module. The package is built by
   `git archive <commit>` — not by our script — hence `.gitattributes export-ignore`.
3. AI review (blockers must cite a rule), then a MIKO CODEOWNER approves that exact commit. A new commit or a rules
   or image change resets the approval.
4. After merge the module is registered to the publisher account; **versions are still uploaded in the MIKO
   cabinet**. No new PR per release — only when application data changes or MIKO asks for a newly checked commit.

## Before submitting — checklist

- [ ] `support_email` / `developer` in `module.json` match the publisher card (today: MIKO / help@miko.ru —
      decide whether this is a MIKO module or a third-party one).
- [ ] `SECURITY.md` naming the support e-mail (recommended).
- [ ] README lists every outbound connection (SEC-004): api.telegram.org, platform-api2.max.ru, the optional proxy,
      local REST on 127.0.0.1; the bundled Russian Trusted Root CA (source, fingerprint, used only for MAX).
- [ ] SEC-005 "writes only to its own dir and DB": the hub creates its own read-only Core API key — explain why
      (pull model) and **delete the key record on uninstall** (`HubApiKey::remove()` is not called from `Setup` yet).
- [ ] Workers survive the no-network test without uncaught exceptions.
- [ ] Declare only the architectures we test; note the container tests the current PBX image only.
- [ ] Version format `X.Y[.Z]` growing between uploads.
