# @allons-y/link-checker

## 0.2.0

### Minor Changes

-   d7385d2: The config file is now `.link-checker.config.<ext>` (or `.link-checker.<ext>`) and can be YAML, JSON, or JavaScript (`.yaml`, `.yml`, `.json`, `.js`, `.mjs`, `.cjs`), with the first file found in the working directory used. The older `.checklinks.config.*` names still load with a deprecation notice.
-   77d598e: First release: crawls a site (or a local build directory) for broken internal links, external links, & assets, configured by `.link-checker.config.yaml`.
-   f973604: `check()` now returns `broken` and `warnings` arrays, `formatResults()` renders results as plain text for assertion messages, and `@allons-y/link-checker/cypress` registers a `checkLinks` task.
