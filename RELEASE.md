# Release Process

## How it works

A GitHub Action (`.github/workflows/release.yml`) automates releases. When triggered, it:

1. Builds `ffxiv-universalis-alert.user.js` from source
2. Extracts the `==UserScript==` metadata block into `ffxiv-universalis-alert.meta.js`
3. Force-pushes both files to an orphan `release` branch

Users with the script installed receive auto-updates via TamperMonkey/Violentmonkey — their script manager checks `@updateURL` periodically and downloads the new version when `@version` changes.

## Publishing a release

1. Bump `@version` in `src/header.js`
2. Build and commit:
   ```bash
   bun run build.js
   git add src/header.js ffxiv-universalis-alert.user.js
   git commit -m "release: v0.2.0"
   ```
3. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

The action triggers on the tag push and deploys to the `release` branch automatically.

## Manual trigger

You can also trigger the workflow from the GitHub Actions UI via **workflow_dispatch** — useful for re-deploying without a new tag.

## Release branch

The `release` branch is an orphan branch containing only:

- `ffxiv-universalis-alert.user.js` — the full built script (`@downloadURL`)
- `ffxiv-universalis-alert.meta.js` — metadata-only header (`@updateURL`)

Do not edit this branch manually — it is overwritten on every release.
