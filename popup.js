const popupStatus = document.getElementById("status");
const rendererSelect = document.getElementById("renderer-select");
const doneButton = document.getElementById("done-button");

initialize();

async function initialize() {
  const { openapiRenderer } = await chrome.storage.local.get("openapiRenderer");
  if (["redoc", "swagger"].includes(openapiRenderer)) {
    rendererSelect.value = openapiRenderer;
  }
}

doneButton.addEventListener("click", async () => {
  rendererSelect.disabled = true;
  doneButton.disabled = true;
  doneButton.textContent = "Saving…";
  await chrome.storage.local.set({ openapiRenderer: rendererSelect.value });
  popupStatus.textContent = "Saved.";
  window.close();
});
