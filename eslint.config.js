import js from "@allons-y/opx-lint-js/eslint.config.js";
import json from "@allons-y/opx-lint-json/eslint.config.js";
import md from "@allons-y/opx-lint-md/eslint.config.js";
import licenseHeader from "eslint-plugin-license-header";

const header = ["/**", " * SPDX-License-Identifier: MPL-2.0", " */"];

export default [
	...js,
	...json,
	...md,
	{ ignores: ["dist/**", "coverage/**", ".changeset/**"] },
	{
		files: ["src/**/*.ts", "test/**/*.ts"],
		plugins: { "license-header": licenseHeader },
		rules: { "license-header/header": ["error", header] },
	},
];
