import assert from "node:assert/strict";
import test from "node:test";

test("fetches private Raw references through github.com with credentials", async (t) => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  });

  let listener;
  const requests = [];
  globalThis.chrome = { runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener(callback) { listener = callback; } },
  } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, text: async () => "Problem:\n  type: object" };
  };
  await import("../background.js");

  const result = await new Promise((resolve) => {
    assert.equal(listener({
      type: "load-html",
      rawUrl: "https://raw.githubusercontent.com/owner/repo/refs/heads/main/components/Problem.yaml",
    }, {}, resolve), true);
  });
  assert.deepEqual(result, { ok: true, html: "Problem:\n  type: object" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://github.com/owner/repo/raw/refs/heads/main/components/Problem.yaml");
  assert.equal(requests[0].options.credentials, "include");
  assert.ok(requests[0].options.signal instanceof AbortSignal);

  const denied = await new Promise((resolve) => listener({
    type: "load-html", rawUrl: "https://evil.example/file.yaml",
  }, {}, resolve));
  assert.equal(denied.ok, false);
  assert.equal(requests.length, 1);
});

test("opens Viewer tabs with token-free sources and preserves the source window", async (t) => {
  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  let listener;
  const opened = [];
  globalThis.chrome = {
    runtime: {
      getURL: () => "chrome-extension://test-extension/",
      onInstalled: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback; } },
    },
    tabs: {
      update: async (id, options) => { opened.push({ method: "update", id, ...options }); },
      create: async (options) => { opened.push({ method: "create", ...options }); },
    },
  };
  await import("../background.js?test=token-free-viewer");

  const cases = [
    {
      rawUrl: "https://raw.githubusercontent.com/owner/repo/refs/heads/main/openapi.yaml?token=example-only#fragment",
      senderUrl: "https://raw.githubusercontent.com/owner/repo/refs/heads/main/openapi.yaml?token=example-only",
      expected: "https://github.com/owner/repo/raw/refs/heads/main/openapi.yaml",
      method: "update",
    },
    {
      rawUrl: "https://github.com/owner/repo/raw/main/openapi.yaml?token=example-only",
      senderUrl: "https://github.com/owner/repo/blob/main/openapi.yaml",
      expected: "https://github.com/owner/repo/raw/main/openapi.yaml",
      method: "create",
    },
    {
      rawUrl: "https://github.com/owner/repo/blob/main/openapi.yaml?raw=true&token=example-only",
      senderUrl: "https://github.com/owner/repo/blob/main/openapi.yaml",
      expected: "https://github.com/owner/repo/blob/main/openapi.yaml?raw=true",
      method: "create",
    },
  ];
  for (const item of cases) {
    const response = await new Promise((resolve) => listener({
      type: "open-viewer", rawUrl: item.rawUrl, renderer: "swagger",
    }, { url: item.senderUrl, tab: { id: 10, windowId: 20 } }, resolve));
    assert.deepEqual(response, { ok: true });
    const openedTab = opened.at(-1);
    const viewerUrl = new URL(openedTab.url);
    assert.equal(viewerUrl.searchParams.get("url"), item.expected);
    assert.equal(viewerUrl.searchParams.get("renderer"), "swagger");
    assert.equal(openedTab.url.includes("example-only"), false);
    assert.equal(openedTab.method, item.method);
    if (item.method === "update") {
      assert.equal(openedTab.id, 10);
    } else {
      assert.equal(openedTab.windowId, 20);
      assert.equal(openedTab.openerTabId, 10);
    }
  }
});
