PRETTIER := prettier
MAGICK := magick
PRETTIER_FILES := \
	manifest.json \
	README.md \
	src/*.css \
	src/*.html \
	src/*.js \
	tests/*.js

.PHONY: format format-check icons test

format:
	$(PRETTIER) --write $(PRETTIER_FILES)

format-check:
	$(PRETTIER) --check $(PRETTIER_FILES)

test:
	node --test tests/*.test.js

icons:
	$(MAGICK) icons/icon-128.png -resize 16x16 -depth 8 icons/icon-16.png
	$(MAGICK) icons/icon-128.png -resize 32x32 -depth 8 icons/icon-32.png
	$(MAGICK) icons/icon-128.png -resize 48x48 -depth 8 icons/icon-48.png
