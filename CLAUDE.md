@AGENTS.md
@LOCAL.md

## Claude Code specifics

- Respond to the user in Russian; code, identifiers and commit messages in English.
- Before generating module code (models, REST resources, workers, UI) load the `mikopbx-module` skill and read
  the matching published reference module it points to.
- Compile changed `public/assets/js/src/*.js` with the `babel-compiler` skill. There is no local Docker on this
  machine; if the skill needs Docker, use a local Babel setup in the scratchpad (targets Chrome 50 / Firefox 45 /
  IE 11) and say so.
- Translations for 29 locales: `translations` skill workflow (Russian first).
- Core reference checkout: the Core repository (https://github.com/mikopbx/Core; local path in `LOCAL.md`) — read only.
- Source modules for the pull adapters (read their REST API code only to learn the contract, never edit them):
  `../ModuleAISupervisor`, `../ModuleLocalSpeechToText`, `../ModuleCloudSpeechToText`,
  `../ModuleCloudAISupervisor`, `../ModuleVoiceAgent`.
- GitLab project for issues: create it under `mikopbx/modules` when the user asks (skill `gitlab`).
- Test station: access in `LOCAL.md` (not in git); a module install there can time out on slow steps — keep
  `Setup` light.
