// Layout viewport in CSS pixels, including scrollbars (window.innerWidth/Height).
chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.type !== 'dev-sideboard:get-viewport') {
      return false
    }
    sendResponse({ width: window.innerWidth, height: window.innerHeight })
    return false
  },
)
