#!/usr/bin/env bash
set -euo pipefail

# Read current version from header.js
CURRENT=$(sed -n 's/^\/\/ @version      //p' src/header.js | tr -d '[:space:]')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Parse argument
case "${1:-}" in
  -M) VERSION="$((MAJOR + 1)).0.0" ;;
  -m) VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  -p) VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  *)
    if [[ "${1:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      VERSION="$1"
    else
      echo "Usage: ./release.sh [-M | -m | -p | X.Y.Z]"
      echo "  -M   major  (${CURRENT} → $((MAJOR + 1)).0.0)"
      echo "  -m   minor  (${CURRENT} → $MAJOR.$((MINOR + 1)).0)"
      echo "  -p   patch  (${CURRENT} → $MAJOR.$MINOR.$((PATCH + 1)))"
      exit 1
    fi
    ;;
esac

echo "Bumping $CURRENT → $VERSION"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is dirty — commit or stash changes first"
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Error: tag v$VERSION already exists"
  exit 1
fi

# Update version in header.js
sed -i '' "s/^\/\/ @version      .*/\/\/ @version      $VERSION/" src/header.js
echo "Updated src/header.js to $VERSION"

# Rebuild so the built file picks up the new version
bun run build.js
echo "Rebuilt ffxiv-universalis-alert.user.js"

# Commit, tag, push
git add src/header.js ffxiv-universalis-alert.user.js
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push && git push --tags

echo "Released v$VERSION"
