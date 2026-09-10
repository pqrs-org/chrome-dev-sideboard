#!/bin/sh

set -u # forbid undefined variables
set -e # forbid command failure

cd "$(dirname "$0")/../build"

version=$(node -p "require('./manifest.json').version")
output="../dist/dev-sideboard-$version.zip"
mkdir -p ../dist
package_dir=$(mktemp -d ../dist/package.XXXXXX)
trap 'rm -rf "$package_dir"' EXIT

zip -q "$package_dir/extension.zip" manifest.json src/*.js src/*.html src/*.css icons/*.png
zip -T "$package_dir/extension.zip"
mv "$package_dir/extension.zip" "$output"
printf '%s\n' "$output"
