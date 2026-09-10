MAGICK := magick

.PHONY: build watch typecheck lint check format format-check icons test package

build:
	pnpm run build

watch:
	pnpm run watch

typecheck:
	pnpm run typecheck

lint:
	pnpm run lint

check:
	pnpm run check

format:
	pnpm run format

format-check:
	pnpm run format:check

test:
	pnpm test

package: check
	sh scripts/package.sh

icons:
	$(MAGICK) icons/icon-128.png -resize 16x16 -depth 8 icons/icon-16.png
	$(MAGICK) icons/icon-128.png -resize 32x32 -depth 8 icons/icon-32.png
	$(MAGICK) icons/icon-128.png -resize 48x48 -depth 8 icons/icon-48.png
