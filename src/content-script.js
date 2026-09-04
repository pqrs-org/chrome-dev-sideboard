(function () {
  "use strict";

  const HOST_ID = "chrome-page-title-bar-root";
  const DEFAULTS = {
    height: 32,
    fontSize: 14,
    backgroundColor: "#202124",
    textColor: "#ffffff",
    chipPosition: { x: 0.5, y: 0 },
  };
  const VIEWPORT_MARGIN = 8;

  if (window.top !== window || document.getElementById(HOST_ID)) return;

  let host;
  let titleElement;
  let titleObserver;
  let titleObserverTarget;
  let chip;
  let chipPosition = DEFAULTS.chipPosition;
  let dragState;

  function updateTitle() {
    if (titleElement) {
      titleElement.textContent = document.title || location.href;
      requestAnimationFrame(() => applyPosition(chipPosition));
    }
  }

  function observeTitle() {
    titleObserver?.disconnect();
    titleObserver = new MutationObserver(() => {
      updateTitle();
      if (document.head && titleObserverTarget !== document.head)
        observeTitle();
    });
    const target = document.head || document.documentElement;
    titleObserverTarget = target;
    titleObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function applyAppearance(settings) {
    if (!host) return;
    const height = Math.min(
      96,
      Math.max(20, Number(settings.height) || DEFAULTS.height),
    );
    const fontSize = Math.min(
      48,
      Math.max(10, Number(settings.fontSize) || DEFAULTS.fontSize),
    );
    host.style.setProperty("--ptb-height", `${height}px`);
    host.style.setProperty("--ptb-font-size", `${fontSize}px`);
    host.style.setProperty(
      "--ptb-background",
      settings.backgroundColor || DEFAULTS.backgroundColor,
    );
    host.style.setProperty(
      "--ptb-color",
      settings.textColor || DEFAULTS.textColor,
    );
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizedPosition(value) {
    return {
      x: clamp(Number(value?.x) || 0, 0, 1),
      y: clamp(Number(value?.y) || 0, 0, 1),
    };
  }

  function availableTravel() {
    const rect = host.getBoundingClientRect();
    return {
      x: Math.max(0, window.innerWidth - rect.width - VIEWPORT_MARGIN * 2),
      y: Math.max(0, window.innerHeight - rect.height - VIEWPORT_MARGIN * 2),
    };
  }

  function applyPosition(value) {
    if (!host || dragState) return;
    chipPosition = normalizedPosition(value);
    const travel = availableTravel();
    host.style.left = `${VIEWPORT_MARGIN + travel.x * chipPosition.x}px`;
    host.style.top = `${VIEWPORT_MARGIN + travel.y * chipPosition.y}px`;
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    chip.classList.add("dragging");
    chip.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (dragState?.pointerId !== event.pointerId) return;
    const maximumLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - host.offsetWidth - VIEWPORT_MARGIN,
    );
    const maximumTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - host.offsetHeight - VIEWPORT_MARGIN,
    );
    host.style.left = `${clamp(
      event.clientX - dragState.offsetX,
      VIEWPORT_MARGIN,
      maximumLeft,
    )}px`;
    host.style.top = `${clamp(
      event.clientY - dragState.offsetY,
      VIEWPORT_MARGIN,
      maximumTop,
    )}px`;
  }

  function finishDrag(event) {
    if (dragState?.pointerId !== event.pointerId) return;
    chip.classList.remove("dragging");
    dragState = undefined;

    const rect = host.getBoundingClientRect();
    const travel = availableTravel();
    chipPosition = {
      x: travel.x ? (rect.left - VIEWPORT_MARGIN) / travel.x : 0,
      y: travel.y ? (rect.top - VIEWPORT_MARGIN) / travel.y : 0,
    };
    chrome.storage.sync.set({ chipPosition }).catch(console.error);
  }

  async function mount() {
    if (!document.documentElement || document.getElementById(HOST_ID)) return;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("role", "banner");
    host.setAttribute("aria-label", "Draggable page title chip");
    Object.assign(host.style, {
      all: "initial",
      display: "inline-block",
      position: "fixed",
      left: `${VIEWPORT_MARGIN}px`,
      top: `${VIEWPORT_MARGIN}px`,
      zIndex: "2147483647",
    });

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light dark; }
      .chip {
        align-items: center;
        background: var(--ptb-background);
        border: 1px solid rgb(255 255 255 / 18%);
        border-radius: calc(var(--ptb-height) / 2);
        box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
        box-sizing: border-box;
        color: var(--ptb-color);
        cursor: grab;
        display: flex;
        font: 500 var(--ptb-font-size)/1.3 system-ui, -apple-system, sans-serif;
        height: var(--ptb-height);
        max-width: calc(100vw - ${VIEWPORT_MARGIN * 2}px);
        overflow: hidden;
        padding: 0 14px;
        touch-action: none;
        user-select: none;
      }
      .chip.dragging {
        cursor: grabbing;
      }
      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    chip = document.createElement("div");
    chip.className = "chip";
    titleElement = document.createElement("div");
    titleElement.className = "title";
    chip.append(titleElement);
    shadow.append(style, chip);
    document.documentElement.append(host);

    chip.addEventListener("pointerdown", startDrag);
    chip.addEventListener("pointermove", moveDrag);
    chip.addEventListener("pointerup", finishDrag);
    chip.addEventListener("pointercancel", finishDrag);
    window.addEventListener("resize", handleResize);

    const settings = await chrome.storage.sync.get(DEFAULTS);
    applyAppearance(settings);
    applyPosition(settings.chipPosition);
    updateTitle();
    observeTitle();
  }

  function unmount() {
    titleObserver?.disconnect();
    window.removeEventListener("resize", handleResize);
    host?.remove();
    host = undefined;
    chip = undefined;
    titleElement = undefined;
    titleObserverTarget = undefined;
    dragState = undefined;
  }

  function handleResize() {
    applyPosition(chipPosition);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "remove-title-bar") unmount();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !host) return;
    const appearanceChanged = [
      "height",
      "fontSize",
      "backgroundColor",
      "textColor",
    ].some((key) => key in changes);
    if (appearanceChanged)
      chrome.storage.sync.get(DEFAULTS).then((settings) => {
        applyAppearance(settings);
        requestAnimationFrame(() => applyPosition(chipPosition));
      });
    if ("chipPosition" in changes) applyPosition(changes.chipPosition.newValue);
  });

  if (document.documentElement) mount();
  else
    new MutationObserver((_changes, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      mount();
    }).observe(document, { childList: true });
})();
