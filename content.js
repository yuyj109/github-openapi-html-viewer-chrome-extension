const SUPPORTED_EXTENSIONS = new Set([
  "htm", "html", "json", "yaml", "yml",
]);
let previewButtonUrl = null;
let previewErrorTimer;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "get-preview-source") {
    return;
  }

  const rawUrl = getRawSourceUrl();
  sendResponse(rawUrl ? { ok: true, rawUrl, fileType: getFileType() } : { ok: false });
});

function addPreviewButton() {
  const existingButton = document.getElementById("github-preview-button");
  if (existingButton && previewButtonUrl === location.href) {
    return;
  }
  existingButton?.remove();

  if (!isPreviewableFilePage()) {
    return;
  }

  const rawUrl = getRawSourceUrl();
  if (!rawUrl) {
    return;
  }

  const button = document.createElement("button");
  button.id = "github-preview-button";
  button.type = "button";
  button.className = "btn";
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Preview";
  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const renderer = await getDefaultRenderer();
      const result = await withTimeout(chrome.runtime.sendMessage({
        type: "open-viewer",
        rawUrl,
        renderer,
      }), 10_000);
      if (!result?.ok) {
        throw new Error(result?.error || "Unknown error");
      }
    } catch (error) {
      showPreviewError(button, `Could not open preview: ${error.message}`);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });

  if (location.hostname === "raw.githubusercontent.com") {
    button.classList.add("github-preview-floating-button");
    document.body.append(button);
  } else {
    const rawButton = findRawButton();
    if (!rawButton) {
      return;
    }
    rawButton.before(button);
  }
  previewButtonUrl = location.href;
}

function findRawButton() {
  return document.querySelector(
    "a#raw-url[href], a[data-testid='raw-button'][href], a[href*='/raw/'], a[href*='?raw=true']",
  );
}

function getRawSourceUrl() {
  if (!isPreviewableFilePage()) {
    return null;
  }

  if (location.hostname === "raw.githubusercontent.com") {
    return location.href;
  }

  const rawLink = document.querySelector(
    "a#raw-url[href], a[data-testid='raw-button'][href], a[href*='/raw/'], a[href*='?raw=true']",
  );
  if (rawLink) {
    // Preserve GitHub's Raw URL for authenticated/private-repository redirects.
    return rawLink.href;
  }

  // Do not construct a Raw URL from the blob URL: branch names can contain
  // slashes, which makes the ref and file path ambiguous. The observer retries
  // after GitHub renders the authoritative Raw link.
  return null;
}

function isPreviewableFilePage() {
  const isRawFile = location.hostname === "raw.githubusercontent.com";
  const isGitHubFile = location.hostname === "github.com"
    && /^\/[^/]+\/[^/]+\/blob\//.test(location.pathname);
  if (!isRawFile && !isGitHubFile) {
    return false;
  }

  return SUPPORTED_EXTENSIONS.has(getFileType());
}

function getFileType() {
  const filename = location.pathname.slice(location.pathname.lastIndexOf("/") + 1);
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex > 0 ? filename.slice(extensionIndex + 1).toLowerCase() : "";
}

function showPreviewError(button, message) {
  document.getElementById("github-preview-error")?.remove();
  clearTimeout(previewErrorTimer);

  const error = document.createElement("span");
  error.id = "github-preview-error";
  error.className = "github-preview-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  button.after(error);
  previewErrorTimer = setTimeout(() => error.remove(), 8_000);
}

async function getDefaultRenderer() {
  if (!["json", "yaml", "yml"].includes(getFileType())) {
    return "html";
  }

  try {
    const { openapiRenderer } = await chrome.storage.local.get("openapiRenderer");
    return ["redoc", "swagger"].includes(openapiRenderer) ? openapiRenderer : "redoc";
  } catch {
    return "redoc";
  }
}

function withTimeout(promise, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The preview request timed out.")), timeout);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let lastUrl = location.href;
let retryTimer;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl || (isPreviewableFilePage() && !document.getElementById("github-preview-button"))) {
    if (location.href !== lastUrl) {
      previewButtonUrl = null;
    }
    lastUrl = location.href;
    schedulePreviewButton();
  }
});

function schedulePreviewButton() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(addPreviewButton, 100);
}

observer.observe(document.documentElement, { childList: true, subtree: true });
addPreviewButton();
setTimeout(addPreviewButton, 300);
setTimeout(addPreviewButton, 1_000);
