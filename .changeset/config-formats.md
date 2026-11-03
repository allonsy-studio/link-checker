---
"@allons-y/link-checker": minor
---

The config file is now `.link-checker.config.<ext>` (or `.link-checker.<ext>`) and can be YAML, JSON, or JavaScript (`.yaml`, `.yml`, `.json`, `.js`, `.mjs`, `.cjs`), with the first file found in the working directory used. The older `.checklinks.config.*` names still load with a deprecation notice.
