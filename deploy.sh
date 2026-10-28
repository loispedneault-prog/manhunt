#!/bin/sh
# Builds the app and publishes dist/ to the gh-pages branch (served by GitHub Pages).
set -e
cd "$(dirname "$0")"
REMOTE=$(git remote get-url origin)
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" commit -q -m "Deploy $(date '+%Y-%m-%d %H:%M')"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Déployé. En ligne dans ~1 minute."
