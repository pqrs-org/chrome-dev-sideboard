#!/bin/sh

set -u # forbid undefined variables
set -e # forbid command failure

cd "$(dirname "$0")/.."

rm -rf build.new
trap 'rm -rf build.new' EXIT

pnpm exec tsc --outDir build.new/src
cp manifest.json build.new/
cp -R icons build.new/icons
cp src/*.html src/*.css build.new/src/

rm -rf build
mv build.new build
