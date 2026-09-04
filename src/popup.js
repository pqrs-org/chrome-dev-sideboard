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
  height: document.querySelector("#height"),
  fontSize: document.querySelector("#fontSize"),
  backgroundColor: document.querySelector("#backgroundColor"),
  textColor: document.querySelector("#textColor"),
  save: document.querySelector("#save"),
  status: document.querySelector("#status"),
};

let activeTab;
let sitePattern;
let matchedPatterns = [];
let coveredByCustomPattern = false;
let savedSettings;
let isBusy = false;

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
    height: Number(elements.height.value),
    fontSize: Number(elements.fontSize.value),
    backgroundColor: elements.backgroundColor.value,
    textColor: elements.textColor.value,
  };
}

function renderSettings(settings) {
  elements.patterns.value = settings.patterns.join("\n");
  for (const key of ["height", "fontSize", "backgroundColor", "textColor"]) {
    elements[key].value = settings[key];
  }
  savedSettings = readSettings();
  updateSaveButton();
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
  validateSettings(settings);
  if (settings.patterns.length) {
    const granted = await chrome.permissions.request({
      origins: settings.patterns,
    });
    if (!granted) throw new Error("Access to the site was not granted.");
  }

  await chrome.storage.sync.set(settings);
  await syncContentScript();
  savedSettings = settings;
  updateSaveButton();
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

elements.toggle.addEventListener("click", async () => {
  setStatus("");
  if (coveredByCustomPattern) {
    elements.patterns.focus();
    setStatus("Edit the URL pattern that includes this site.");
    return;
  }

  setBusy(true);
  try {
    const settings = readSettings();
    if (matchedPatterns.length) {
      settings.patterns = settings.patterns.filter(
        (pattern) => !matchedPatterns.includes(pattern),
      );
      await persistSettings(settings);
    } else {
      settings.patterns = [...new Set([...settings.patterns, sitePattern])];
      await persistSettings(settings);
    }

    await updateActiveTab(settings.patterns);
    renderSettings(settings);
    renderSiteState(settings.patterns);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(String(error.message || error), true);
  } finally {
    setBusy(false);
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  setStatus("");
  try {
    const settings = readSettings();
    await persistSettings(settings);
    await updateActiveTab(settings.patterns);
    renderSettings(settings);
    if (sitePattern) renderSiteState(settings.patterns);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(String(error.message || error), true);
  } finally {
    setBusy(false);
  }
});

elements.form.addEventListener("input", updateSaveButton);
elements.form.addEventListener("change", updateSaveButton);

function setBusy(busy) {
  isBusy = busy;
  elements.toggle.disabled = busy || !sitePattern;
  updateSaveButton();
}

function updateSaveButton() {
  elements.save.disabled =
    isBusy ||
    !savedSettings ||
    JSON.stringify(readSettings()) === JSON.stringify(savedSettings);
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

initialize().catch((error) => {
  setStatus(String(error.message || error), true);
  elements.toggle.disabled = true;
});
