"use strict";
const overviewView = document.querySelector("#overviewView");
const inspectorView = document.querySelector("#inspectorView");
const overviewContent = document.querySelector("#overviewContent");
const inspectorFrame = document.querySelector("#inspectorFrame");
function selectView(inspect) {
  overviewContent.hidden = inspect;
  inspectorFrame.hidden = !inspect;
  overviewView.setAttribute("aria-pressed", String(!inspect));
  inspectorView.setAttribute("aria-pressed", String(inspect));
  if (inspect && !inspectorFrame.getAttribute("src"))
    inspectorFrame.src = "inspector.html";
}
overviewView.addEventListener("click", () => selectView(false));
inspectorView.addEventListener("click", () => selectView(true));
