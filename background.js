import { getAuthenticatedRawUrl, getFileExtension, isAllowedRawUrl } from "./url-utils.mjs";

const VIEWER_PATH = "viewer.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: { hostEquals: "github.com", schemes: ["https"] },
        }),
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: { hostEquals: "raw.githubusercontent.com", schemes: ["https"] },
        }),
      ],
      actions: [new chrome.declarativeContent.ShowAction()],
    }]);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "open-viewer") {
    if (!isAllowedRawUrl(message.rawUrl)) {
      sendResponse({ ok: false, error: "Unsupported GitHub Raw URL." });
      return;
    }

    const rawUrl = getAuthenticatedRawUrl(message.rawUrl);
    const viewerUrl = new URL(VIEWER_PATH, chrome.runtime.getURL("/"));
    viewerUrl.searchParams.set("url", rawUrl);
    const renderer = ["html", "redoc", "swagger"].includes(message.renderer)
      ? message.renderer
      : getDefaultRenderer(rawUrl);
    viewerUrl.searchParams.set("renderer", renderer);

    const sourceTab = sender.tab;
    const openViewer = isRawPage(sender.url) && sourceTab?.id !== undefined
      ? chrome.tabs.update(sourceTab.id, { url: viewerUrl.href })
      : chrome.tabs.create({
        url: viewerUrl.href,
        ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
        ...(sourceTab?.id !== undefined ? { openerTabId: sourceTab.id } : {}),
      });

    openViewer
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type !== "load-html") {
    return;
  }

  if (!isAllowedRawUrl(message.rawUrl)) {
    sendResponse({ ok: false, error: "Unsupported GitHub Raw URL." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  fetch(getAuthenticatedRawUrl(message.rawUrl), { credentials: "include", signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
      }

      sendResponse({ ok: true, html: await response.text() });
    })
    .catch((error) => sendResponse({
      ok: false,
      error: error.name === "AbortError" ? "GitHub response timed out." : error.message,
    }))
    .finally(() => clearTimeout(timeout));

  return true;
});

function getDefaultRenderer(rawUrl) {
  const extension = getFileExtension(rawUrl);
  return ["json", "yaml", "yml"].includes(extension) ? "redoc" : "html";
}

function isRawPage(value) {
  try {
    return new URL(value).hostname === "raw.githubusercontent.com";
  } catch {
    return false;
  }
}
