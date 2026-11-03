# Contributing

Read the [studio contributing guide](https://github.com/allonsy-studio/.github/blob/main/CONTRIBUTING.md) and the [code of conduct](https://github.com/allonsy-studio/.github/blob/main/CODE_OF_CONDUCT.md) before opening a pull request.

Setup: `corepack enable && yarn install`. Before pushing, run `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, and `yarn test`.

For a change that affects consumers, run `yarn changeset`, choose the bump type, and commit the generated file with the code. Docs, tests, and CI changes need no changeset.

Agents and automated tools should follow [AGENTS.md](AGENTS.md).
