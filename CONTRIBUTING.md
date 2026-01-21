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
- Run the prepare script to build all packages, powered by [nx](https://nx.dev/).

## Making changes and building

Once you have set up the local development environment in your forked repository, we can start development.

### Checkout a new branch

It is recommended to develop on a new branch, as it will make things easier later when you submit a pull request:

```sh
git checkout -b MY_BRANCH_NAME
```

### Build the package

Use [nx build](https://nx.dev/nx-api/nx/documents/run) to build the package you want to change:

```sh
npx nx build @rstest/core
```

Build all packages:

```sh
pnpm run build
```

You can also use the watch mode to automatically rebuild the package when you make changes:

```sh
npx nx build @rstest/core --watch
```

## Releasing

Repository maintainers can publish new versions of changed packages.

1. Run the local release command `pnpm bump` to bump the target package group.
2. The command will prompt for a package group and then a bump type. It creates a local commit only (no tag, no push).
3. Open a pull request with a title like `release: 0.7.10` or `release: @rstest/coverage-istanbul 0.1.7` and ensure CI passes.
4. Trigger the [release action](https://github.com/web-infra-dev/rstest/actions/workflows/release.yml) to publish packages to npm.
5. Merge the release pull request to `main`.
6. Create a GitHub Release for the merged commit so GitHub generates release notes and creates the version tag.
