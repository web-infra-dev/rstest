# Rstest contributing guide

Thanks for that you are interested in contributing to Rstest. Before starting your contribution, please take a moment to read the following guidelines.

## Install Node.js

Use [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm) to run the command below. This will switch to the Node.js version specified in the project's `.nvmrc` file.

```bash
# with fnm
fnm use

# with nvm
nvm use
```

## Install dependencies

Enable [pnpm](https://pnpm.io/) with corepack:

```bash
corepack enable
```

Install dependencies:

```bash
pnpm install
```

What this will do:

- Install all dependencies.
- Create symlinks between packages in the monorepo
- Run the prepare script to build all packages.

## Making changes and building

Once you have set up the local development environment in your forked repository, we can start development.

### Checkout a new branch

It is recommended to develop on a new branch, as it will make things easier later when you submit a pull request:

```sh
git checkout -b MY_BRANCH_NAME
```

### Build the package

Use pnpm to build a specific package:

```sh
pnpm --filter @rstest/core run build
```

Build all packages:

```sh
pnpm run build
```

You can also use the watch mode to automatically rebuild the package when you make changes:

```sh
pnpm --filter @rstest/core run build --watch
```

## Testing

Run unit tests:

```sh
pnpm test
```

Run e2e tests:

```sh
pnpm e2e
```

### Browser e2e tests

Browser-mode e2e fixtures set `headless: true` in their `rstest.config.ts` so no browser windows pop up locally. A few headed smoke tests (tests that explicitly need a visible browser, e.g. viewport assertions) are skipped locally by default and only run on CI. Run them from the `e2e/` directory, for example:

```bash
cd e2e && RSTEST_E2E_RUN_HEADED=true pnpm test browser-mode/basic.test.ts
```

## Releasing

Repository maintainers can publish new versions of changed packages.

The recommended way is to let a coding agent drive the flow with the `release` skill (`.agents/skills/release/`). The skill walks through every step below and pauses at the decisions that stay human — choosing the version, confirming the publish, approving the staged packages with 2FA, and publishing the release notes. For example, prompt your agent with:

```text
/release patch
```

Or just `/release` to see the version menu before deciding the bump type.

To release manually:

1. Run the local release command `pnpm bump` to bump all Rstest packages together.
2. The command will prompt for a bump type. It creates a local commit only (no tag, no push).
3. Open a pull request with a title like `release: 0.7.10` and ensure CI passes.
4. Trigger the [release action](https://github.com/web-infra-dev/rstest/actions/workflows/release.yml) with `npm_tag` set to `latest` and `branch` set to the release branch. The workflow uses [staged publishing](https://docs.npmjs.com/staged-publishing/) — packages are uploaded to npm but not yet installable.
5. Approve the staged packages with 2FA: run `npm stage approve <stage-id>` for each package (the stage ids are printed in the workflow log), or approve them in the [Staged Packages tab](https://www.npmjs.com/settings/rstest/packages) on npmjs.com. Verify every package is live (e.g. `npm view @rstest/core@x.y.z version`) before continuing.
6. Merge the release pull request to `main`.
7. Use the `create-draft-release-notes` skill to create a draft [GitHub release note](https://github.com/web-infra-dev/rstest/releases). Review the draft release note, optionally add release highlights, and publish it.
