import assert from "node:assert/strict";
import test from "node:test";

test("cleans legacy Viewer addresses and Source links before fetching", async (t) => {
  const keys = ["document", "chrome", "location", "history"];
  const descriptors = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  });

  const elements = new Map();
  const requests = [];
  const replacements = [];
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { addEventListener() {} });
      }
      return elements.get(id);
    },
  };
  const legacyUrl = new URL("chrome-extension://test-extension/viewer.html");
  legacyUrl.searchParams.set("url", "https://raw.githubusercontent.com/owner/repo/main/openapi.yaml?token=example-only");
  legacyUrl.searchParams.set("renderer", "redoc");
  globalThis.location = legacyUrl;
  globalThis.history = {
    replaceState(_state, _title, url) { replacements.push(url); },
  };
  globalThis.chrome = { runtime: {
    sendMessage(message) {
      requests.push(message);
      // Stop before vendor loading: this test covers address sanitization only.
      return Promise.resolve({ ok: false, error: "Mock fetch stopped." });
    },
  } };

  await import("../viewer.js?test=legacy-viewer-address");
  const expected = "https://github.com/owner/repo/raw/main/openapi.yaml";
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].includes("example-only"), false);
  const cleaned = new URL(replacements[0]);
  assert.equal(cleaned.searchParams.get("url"), expected);
  assert.equal(cleaned.searchParams.get("renderer"), "redoc");
  assert.equal(elements.get("source-link").href, expected);
  assert.equal(elements.get("source-link").target, undefined);
  assert.deepEqual(requests, [{ type: "load-html", rawUrl: expected }]);
});
