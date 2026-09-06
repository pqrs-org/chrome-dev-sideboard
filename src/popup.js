"use strict";

const {
  DEFAULTS,
  isValidPattern,
  normalizePatterns,
  patternForUrl,
  patternMatchesUrl,
} = PageTitleBarConfig;

const elements = {
  form: document.querySelector("#form"),
  title: document.querySelector("#title"),
  url: document.querySelector("#url"),
  toggle: document.querySelector("#toggle"),
  patterns: document.querySelector("#patterns"),
  fontSize: document.querySelector("#fontSize"),
  backgroundColor: document.querySelector("#backgroundColor"),
  textColor: document.querySelector("#textColor"),
  borderColor: document.querySelector("#borderColor"),
  status: document.querySelector("#status"),
};

let activeTab;
let sitePattern;
let matchedPatterns = [];
let coveredByCustomPattern = false;
let savedSettings;
let saveQueue = Promise.resolve();

async function syncContentScript() {
  const response = await chrome.runtime.sendMessage({
    type: "sync-content-script",
  });
  if (!response?.ok)
    throw new Error(response?.error || "Could not update the content script.");
}

async function initialize() {
  const [tabs, settings] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.sync.get(DEFAULTS),
  ]);
  [activeTab] = tabs;
  elements.title.textContent = activeTab?.title || "Untitled page";
  elements.url.textContent = activeTab?.url || "";
  sitePattern = activeTab?.url ? patternForUrl(activeTab.url) : null;
  renderSettings(settings);

  if (!sitePattern) {
    elements.toggle.disabled = true;
    elements.toggle.textContent = "Cannot enable on this page";
    return;
  }

  renderSiteState(settings.patterns);
  elements.toggle.disabled = false;
}

function renderSiteState(patterns) {
  matchedPatterns = patterns.filter((pattern) =>
    patternMatchesUrl(pattern, activeTab.url),
  );
  coveredByCustomPattern = matchedPatterns.some(
    (pattern) => pattern !== sitePattern,
  );
  if (coveredByCustomPattern) elements.toggle.textContent = "Edit URL patterns";
  else
    elements.toggle.textContent = matchedPatterns.length
      ? "Hide on this site"
      : "Show on this site";
}

function readSettings() {
  return {
    patterns: normalizePatterns(elements.patterns.value),
    fontSize: Number(elements.fontSize.value),
    backgroundColor: elements.backgroundColor.value,
    textColor: elements.textColor.value,
    borderColor: elements.borderColor.value,
  };
}

function renderSettings(settings) {
  elements.patterns.value = settings.patterns.join("\n");
  for (const key of [
    "fontSize",
    "backgroundColor",
    "textColor",
    "borderColor",
  ]) {
    elements[key].value = settings[key];
  }
  savedSettings = readSettings();
}

function validateSettings(settings) {
  if (!elements.form.reportValidity())
    throw new Error("Check the appearance values.");
  const invalid = settings.patterns.filter(
    (pattern) => !isValidPattern(pattern),
  );
  if (invalid.length)
    throw new Error(`Invalid URL pattern: ${invalid.join(", ")}`);
}

async function persistSettings(settings) {
  if (JSON.stringify(settings) === JSON.stringify(savedSettings)) return;
  const patternsChanged =
    JSON.stringify(settings.patterns) !==
    JSON.stringify(savedSettings.patterns);
  await chrome.storage.sync.set(settings);
  if (patternsChanged) {
    await syncContentScript();
    await updateActiveTab(settings.patterns);
  }
  savedSettings = settings;
}

function saveSettings() {
  if (!savedSettings) return;
  const settings = readSettings();
  setStatus("");
  try {
    validateSettings(settings);
  } catch (error) {
    setStatus(String(error.message || error), true);
    return;
  }

  setBusy(true);
  const operation = saveQueue
    .then(() => persistSettings(settings))
    .catch((error) => setStatus(String(error.message || error), true))
    .finally(() => {
      if (saveQueue === operation) setBusy(false);
    });
  saveQueue = operation;
  if (sitePattern) renderSiteState(settings.patterns);
}

async function updateActiveTab(patterns) {
  if (!sitePattern) return;
  const shouldShow = patterns.some((pattern) =>
    patternMatchesUrl(pattern, activeTab.url),
  );
  if (shouldShow) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["src/content-script.js"],
    });
  } else {
    await chrome.tabs
      .sendMessage(activeTab.id, { type: "remove-title-bar" })
      .catch(() => {});
  }
}

elements.toggle.addEventListener("click", () => {
  renderSiteState(readSettings().patterns);
  setStatus("");
  if (coveredByCustomPattern) {
    elements.patterns.focus();
    setStatus("Edit the URL pattern that includes this site.");
    return;
  }

  const settings = readSettings();
  if (matchedPatterns.length) {
    settings.patterns = settings.patterns.filter(
      (pattern) => !matchedPatterns.includes(pattern),
    );
  } else {
    settings.patterns = [...new Set([...settings.patterns, sitePattern])];
  }
  elements.patterns.value = settings.patterns.join("\n");
  saveSettings();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings();
});

elements.form.addEventListener("change", saveSettings);

for (const key of ["backgroundColor", "textColor", "borderColor"]) {
  elements[key].addEventListener("input", () => {
    if (!sitePattern) return;
    chrome.tabs
      .sendMessage(activeTab.id, {
        type: "preview-title-bar-color",
        key,
        value: elements[key].value,
      })
      .catch(() => {});
  });
}

function setBusy(busy) {
  elements.toggle.disabled = busy || !sitePattern;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

initialize().catch((error) => {
  setStatus(String(error.message || error), true);
  elements.toggle.disabled = true;
});
