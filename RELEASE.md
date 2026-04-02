# Release Process

## How it works

A GitHub Action (`.github/workflows/release.yml`) automates releases. When triggered, it:

1. Builds `ffxiv-universalis-alert.user.js` from source
2. Extracts the `==UserScript==` metadata block into `ffxiv-universalis-alert.meta.js`
3. Force-pushes both files to an orphan `release` branch

Users with the script installed receive auto-updates via TamperMonkey/Violentmonkey — their script manager checks `@updateURL` periodically and downloads the new version when `@version` changes.

## Publishing a release

Run `release.sh` with a semver bump flag or an explicit version:

```bash
./release.sh -p        # patch: 0.1.1 → 0.1.2
./release.sh -m        # minor: 0.1.1 → 0.2.0
./release.sh -M        # major: 0.1.1 → 1.0.0
./release.sh 0.5.0     # explicit version
```

The script bumps `@version` in `src/header.js` and `package.json`, rebuilds, commits, tags, and pushes. The GitHub Action triggers on the tag push and deploys to the `release` branch automatically.

> **Note:** `release.sh` uses macOS/BSD `sed` syntax (`sed -i ''`). It works on GNU sed too, but was written for macOS.

## Manual trigger

You can also trigger the workflow from the GitHub Actions UI via **workflow_dispatch** — useful for re-deploying without a new tag.

## Release branch

The `release` branch is an orphan branch containing only:

- `ffxiv-universalis-alert.user.js` — the full built script (`@downloadURL`)
- `ffxiv-universalis-alert.meta.js` — metadata-only header (`@updateURL`)

Do not edit this branch manually — it is overwritten on every release.
