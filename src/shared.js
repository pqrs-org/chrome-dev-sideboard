(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    patterns: [],
    height: 32,
    fontSize: 14,
    backgroundColor: "#202124",
    textColor: "#ffffff",
    chipPosition: { x: 0.5, y: 0 },
  });

  function normalizePatterns(value) {
    const lines = Array.isArray(value)
      ? value
      : String(value || "").split(/\r?\n/);
    return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
  }

  function parsePattern(pattern) {
    const match = pattern.match(
      /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/,
    );
    if (!match) return null;
    return { scheme: match[1], host: match[2].toLowerCase(), path: match[3] };
  }

  function isValidPattern(pattern) {
    return Boolean(parsePattern(pattern));
  }

  function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  function patternToRegex(pattern) {
    const parsed = parsePattern(pattern);
    if (!parsed) return null;

    const scheme =
      parsed.scheme === "*" ? "https?" : escapeRegex(parsed.scheme);
    let host;
    if (parsed.host === "*") {
      host = "[^/]+";
    } else if (parsed.host.startsWith("*.")) {
      const base = escapeRegex(parsed.host.slice(2));
      host = `(?:[^./]+\\.)*${base}`;
    } else {
      host = escapeRegex(parsed.host);
    }
    const path = escapeRegex(parsed.path).replace(/\*/g, ".*");
    return new RegExp(`^${scheme}:\\/\\/${host}(?::\\d+)?${path}$`, "i");
  }

  function patternMatchesUrl(pattern, url) {
    const regex = patternToRegex(pattern);
    return regex ? regex.test(url) : false;
  }

  function patternForUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  const api = {
    DEFAULTS,
    isValidPattern,
    normalizePatterns,
    patternForUrl,
    patternMatchesUrl,
  };

  root.PageTitleBarConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
