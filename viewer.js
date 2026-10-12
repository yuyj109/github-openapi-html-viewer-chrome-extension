import { getAuthenticatedRawUrl, getFileExtension, isAllowedRawUrl } from "./url-utils.mjs";
import { resolveExternalReferences } from "./openapi-ref-resolver.mjs";

const status = document.getElementById("status");
const htmlPreview = document.getElementById("html-preview");
const openapiPreview = document.getElementById("openapi-preview");
const sourceLink = document.getElementById("source-link");
const toolbarToggle = document.getElementById("toolbar-toggle");
const parameters = new URLSearchParams(location.search);
const requestedSourceUrl = parameters.get("url");
const rawUrl = requestedSourceUrl && isAllowedRawUrl(requestedSourceUrl)
  ? getAuthenticatedRawUrl(requestedSourceUrl)
  : null;
const renderer = parameters.get("renderer");
const EMBEDDED_URL_ATTRIBUTES = new Set(["href", "src", "poster", "xlink:href"]);
const UNSAFE_EMBEDDED_ELEMENTS = "applet, base, embed, frame, frameset, iframe, meta, object, portal, script";
let mermaidObserver;
let mermaidRendering = false;
let mermaidRenderNumber = 0;
let mermaidInitialized = false;
const loadedScripts = new Map();
const loadedStyles = new Map();

toolbarToggle.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("toolbar-collapsed");
  const label = collapsed ? "Show header" : "Hide header";
  toolbarToggle.setAttribute("aria-expanded", String(!collapsed));
  toolbarToggle.setAttribute("aria-label", label);
  toolbarToggle.title = label;
});

if (!rawUrl || !isAllowedRawUrl(rawUrl) || !isSupportedRequest(rawUrl, renderer)) {
  showError("This preview does not have a valid source URL or renderer.");
} else {
  if (rawUrl !== requestedSourceUrl) {
    // Clean a legacy Viewer link as well, without adding another history entry.
    const viewerUrl = new URL(location.href);
    viewerUrl.searchParams.set("url", rawUrl);
    history.replaceState(null, "", viewerUrl.href);
  }
  sourceLink.href = rawUrl;
  document.title = `GitHub OpenAPI & HTML Viewer — ${renderer === "html" ? "HTML" : renderer === "redoc" ? "ReDoc" : "Swagger UI"}`;
  loadPreview();
}

async function loadPreview() {
  status.className = "";
  status.textContent = "Loading preview…";
  try {
    const result = await withTimeout(
      chrome.runtime.sendMessage({ type: "load-html", rawUrl }),
      16_000,
    );
    if (!result?.ok) {
      throw new Error(result?.error || "Unknown error");
    }

    const rendered = renderer === "html"
      ? await renderHtml(result.html)
      : await renderOpenApi(result.html);
    if (rendered) {
      status.className = "hidden";
    }
  } catch (error) {
    showError(`Could not load this file. ${error.message}`);
  }
}

async function renderHtml(source) {
  document.body.classList.add("html-preview");
  openapiPreview.hidden = true;
  htmlPreview.hidden = false;
  let shadowRoot = htmlPreview.shadowRoot;
  if (!shadowRoot) {
    shadowRoot = htmlPreview.attachShadow({ mode: "open" });
    shadowRoot.addEventListener("submit", (event) => event.preventDefault());
  }
  shadowRoot.replaceChildren(createEmbeddedPreview(source, rawUrl));
  await inlineEmbeddedStylesheets(shadowRoot, rawUrl);
  syncEmbeddedBackground(shadowRoot);
  for (const stylesheet of shadowRoot.querySelectorAll("link[rel~='stylesheet']")) {
    stylesheet.addEventListener("load", () => syncEmbeddedBackground(shadowRoot), { once: true });
  }
  requestAnimationFrame(() => syncEmbeddedBackground(shadowRoot));
  setTimeout(() => syncEmbeddedBackground(shadowRoot), 250);
  return true;
}

async function inlineEmbeddedStylesheets(shadowRoot, sourceUrl) {
  const stylesheets = [...shadowRoot.querySelectorAll("link[rel~='stylesheet']")];
  await Promise.all(stylesheets.map(async (stylesheet) => {
    const href = stylesheet.getAttribute("href");
    if (!href) {
      return;
    }

    let stylesheetUrl;
    try {
      stylesheetUrl = new URL(href, sourceUrl).href;
    } catch {
      return;
    }

    if (!isAllowedRawUrl(stylesheetUrl)) {
      return;
    }

    try {
      const result = await withTimeout(
        chrome.runtime.sendMessage({ type: "load-html", rawUrl: stylesheetUrl }),
        16_000,
      );
      if (!result?.ok) {
        return;
      }

      const style = document.createElement("style");
      style.textContent = rewriteEmbeddedCssUrls(result.html, new URL(".", stylesheetUrl).href);
      stylesheet.replaceWith(style);
    } catch {
      // Keep the original stylesheet link when it cannot be loaded by the extension.
    }
  }));
}

async function renderOpenApi(source) {
  let specification;
  try {
    await loadScript("vendor/js-yaml/js-yaml.umd.min.js");
    specification = getFileExtension(rawUrl) === "json" ? JSON.parse(source) : window.jsyaml.load(source);
  } catch {
    showError("This file is not valid JSON or YAML.");
    return false;
  }

  if (!isOpenApiSpecification(specification)) {
    showError("This JSON/YAML file is not an OpenAPI 2.0 or 3.x document.");
    return false;
  }

  try {
    specification = await resolveExternalReferences(specification, rawUrl, loadReferencedSpecification);
  } catch (error) {
    showError(`Could not resolve an external $ref. ${error.message}`);
    return false;
  }

  if (renderer === "swagger") {
    preserveSwaggerMermaidMarkers(specification);
  }

  htmlPreview.hidden = true;
  document.body.classList.remove("html-preview");
  htmlPreview.shadowRoot?.replaceChildren();
  openapiPreview.hidden = false;
  openapiPreview.replaceChildren();

  try {
    if (renderer === "redoc") {
      await loadScript("vendor/redoc/redoc.standalone.js");
      window.Redoc.init(
        specification,
        { hideDownloadButton: true },
        openapiPreview,
        observeMermaidBlocks,
      );
    } else {
      await Promise.all([
        loadStyle("vendor/swagger-ui/swagger-ui.css"),
        loadScript("vendor/swagger-ui/swagger-ui-bundle.js")
          .then(() => loadScript("vendor/swagger-ui/swagger-ui-standalone-preset.js")),
      ]);
      window.SwaggerUIBundle({
        domNode: openapiPreview,
        layout: "BaseLayout",
        presets: [window.SwaggerUIBundle.presets.apis, window.SwaggerUIStandalonePreset],
        spec: specification,
        // Swagger UI owns its DOM through React. Start replacing Mermaid blocks
        // only after its initial render is complete, otherwise React can overwrite them.
        onComplete: observeMermaidBlocks,
      });
    }
    return true;
  } catch (error) {
    showError(`Could not render this OpenAPI document. ${error.message}`);
    return false;
  }
}

async function loadReferencedSpecification(documentUrl) {
  const result = await withTimeout(
    chrome.runtime.sendMessage({ type: "load-html", rawUrl: documentUrl }),
    16_000,
  );
  if (!result?.ok) {
    throw new Error(result?.error || documentUrl);
  }

  try {
    return parseSpecification(result.html, documentUrl);
  } catch {
    throw new Error(`Invalid JSON or YAML at ${documentUrl}`);
  }
}

function parseSpecification(source, sourceUrl) {
  return getFileExtension(sourceUrl) === "json" ? JSON.parse(source) : window.jsyaml.load(source);
}

function preserveSwaggerMermaidMarkers(node, visited = new WeakSet()) {
  if (!node || typeof node !== "object" || visited.has(node)) {
    return;
  }
  visited.add(node);

  if (Array.isArray(node)) {
    node.forEach((item) => preserveSwaggerMermaidMarkers(item, visited));
    return;
  }

  for (const [property, value] of Object.entries(node)) {
    if (property === "description" && typeof value === "string") {
      // Swagger UI sanitizes Markdown and removes code-block classes such as
      // `language-mermaid`. Keep an in-code marker that getMermaidSource can
      // recognize after Swagger UI has rendered the Markdown.
      node[property] = value.replace(
        /(^|\r?\n)(`{3,})mermaid\s*\r?\n([\s\S]*?)\r?\n\2(?=\r?\n|$)/gi,
        (_match, prefix, fence, source) => `${prefix}${fence}\nmermaid\n${source}\n${fence}`,
      );
    } else {
      preserveSwaggerMermaidMarkers(value, visited);
    }
  }
}

function withTimeout(promise, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The request timed out.")), timeout);
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

function observeMermaidBlocks() {
  mermaidObserver?.disconnect();
  mermaidObserver = new MutationObserver(() => {
    renderMermaidBlocks();
  });
  mermaidObserver.observe(openapiPreview, { childList: true, subtree: true });
  renderMermaidBlocks();
}

async function renderMermaidBlocks() {
  if (mermaidRendering) {
    return;
  }

  const blocks = [...openapiPreview.querySelectorAll("pre")]
    .map((pre) => ({ pre, source: getMermaidSource(pre) }))
    .filter(({ source }) => source);
  if (!blocks.length) {
    return;
  }

  mermaidRendering = true;
  try {
    try {
      await loadMermaid();
    } catch (error) {
      for (const { pre } of blocks) {
        const container = document.createElement("div");
        container.className = "github-preview-mermaid github-preview-mermaid-error";
        container.textContent = `Mermaid could not load: ${error.message}`;
        pre.replaceWith(container);
      }
      return;
    }

    for (const { pre, source } of blocks) {
      const container = document.createElement("div");
      container.className = "github-preview-mermaid";
      pre.replaceWith(container);

      try {
        // Mermaid strict mode sanitizes the SVG before this trusted-library output is inserted.
        const { svg, bindFunctions } = await window.mermaid.render(
          `github-preview-mermaid-${mermaidRenderNumber += 1}`,
          source,
        );
        container.innerHTML = svg;
        bindFunctions?.(container);
      } catch (error) {
        container.classList.add("github-preview-mermaid-error");
        container.textContent = `Mermaid could not render this diagram: ${error.message}`;
      }
    }
  } finally {
    mermaidRendering = false;
    renderMermaidBlocks();
  }
}

async function loadMermaid() {
  await loadScript("vendor/mermaid/mermaid.min.js");
  if (!mermaidInitialized) {
    window.mermaid.initialize({
      logLevel: "error",
      securityLevel: "strict",
      startOnLoad: false,
    });
    mermaidInitialized = true;
  }
}

function loadScript(path) {
  return loadResource(loadedScripts, path, () => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = false;
    script.src = chrome.runtime.getURL(path);
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${path}.`)), { once: true });
    document.head.append(script);
  }));
}

function loadStyle(path) {
  return loadResource(loadedStyles, path, () => new Promise((resolve, reject) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL(path);
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener("error", () => reject(new Error(`Could not load ${path}.`)), { once: true });
    document.head.append(stylesheet);
  }));
}

function loadResource(resources, path, createResource) {
  if (!resources.has(path)) {
    resources.set(path, createResource());
  }
  return resources.get(path);
}

function getMermaidSource(pre) {
  const code = pre.querySelector("code") || pre;
  const source = code.textContent.trim();
  const language = code.className.toLowerCase();
  if (/(^|\s)(language-)?mermaid(\s|$)/.test(language)) {
    return source;
  }

  const match = source.match(/^mermaid\s+([\s\S]+)/i);
  return match ? match[1] : null;
}

function isSupportedRequest(sourceUrl, requestedRenderer) {
  const extension = getFileExtension(sourceUrl);
  return (requestedRenderer === "html" && ["html", "htm"].includes(extension))
    || (["redoc", "swagger"].includes(requestedRenderer) && ["json", "yaml", "yml"].includes(extension));
}

function isOpenApiSpecification(specification) {
  return specification && typeof specification === "object"
    && (typeof specification.openapi === "string" || specification.swagger === "2.0");
}

function createEmbeddedPreview(html, sourceUrl) {
  const sourceDocument = new DOMParser().parseFromString(html, "text/html");
  const baseUrl = new URL(".", sourceUrl).href;
  sanitizeEmbeddedDocument(sourceDocument, baseUrl);

  const fragment = document.createDocumentFragment();
  const documentElement = sourceDocument.documentElement.cloneNode(false);
  const head = sourceDocument.head.cloneNode(false);
  const body = sourceDocument.body.cloneNode(false);
  const defaults = document.createElement("style");
  defaults.textContent = ":host { display: block; color-scheme: light; } html { display: block; min-height: inherit; color-scheme: light; }";
  head.append(defaults);
  for (const node of sourceDocument.head.querySelectorAll("style, link[rel~='stylesheet']")) {
    head.append(node.cloneNode(true));
  }
  for (const node of sourceDocument.body.childNodes) {
    body.append(node.cloneNode(true));
  }
  documentElement.append(head, body);
  fragment.append(documentElement);
  return fragment;
}

function sanitizeEmbeddedDocument(sourceDocument, baseUrl) {
  for (const element of sourceDocument.querySelectorAll(UNSAFE_EMBEDDED_ELEMENTS)) {
    element.remove();
  }

  for (const link of sourceDocument.querySelectorAll("link")) {
    if (!link.relList.contains("stylesheet")) {
      link.remove();
    }
  }

  for (const form of sourceDocument.querySelectorAll("form")) {
    form.removeAttribute("action");
    form.removeAttribute("target");
  }

  for (const element of sourceDocument.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "action" || name === "formaction" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
      } else if (name === "srcset") {
        const srcset = rewriteEmbeddedSrcset(attribute.value, baseUrl);
        if (srcset) {
          element.setAttribute("srcset", srcset);
        } else {
          element.removeAttribute(attribute.name);
        }
      } else if (name === "style") {
        element.setAttribute("style", rewriteEmbeddedCssUrls(attribute.value, baseUrl));
      } else if (EMBEDDED_URL_ATTRIBUTES.has(name)) {
        const url = resolveEmbeddedUrl(
          attribute.value,
          baseUrl,
          element.localName === "a" && name === "href" ? "navigation" : "resource",
        );
        if (url) {
          element.setAttribute(attribute.name, url);
        } else {
          element.removeAttribute(attribute.name);
        }
      }
    }

    if (element.localName === "style") {
      element.textContent = rewriteEmbeddedCssUrls(element.textContent, baseUrl);
    }
    if (element.localName === "a") {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  }
}

function syncEmbeddedBackground(shadowRoot) {
  const pageRoot = shadowRoot.querySelector("html");
  const pageBody = shadowRoot.querySelector("body");
  if (!pageRoot || !pageBody) {
    return;
  }

  const rootStyle = getComputedStyle(pageRoot);
  const bodyStyle = getComputedStyle(pageBody);
  const backgroundStyle = hasVisibleBackground(rootStyle)
    ? rootStyle
    : hasVisibleBackground(bodyStyle)
      ? bodyStyle
      : null;
  if (!backgroundStyle) {
    htmlPreview.style.background = "#fff";
    htmlPreview.style.color = "#000";
    return;
  }

  const backgroundProperties = [
    "backgroundAttachment",
    "backgroundClip",
    "backgroundColor",
    "backgroundImage",
    "backgroundOrigin",
    "backgroundPosition",
    "backgroundRepeat",
    "backgroundSize",
  ];

  for (const property of backgroundProperties) {
    htmlPreview.style[property] = backgroundStyle[property];
  }
  htmlPreview.style.color = bodyStyle.color;
}

function hasVisibleBackground(style) {
  return style.backgroundImage !== "none"
    || (style.backgroundColor !== "transparent" && !/,[\s]*0\)$/.test(style.backgroundColor));
}

function rewriteEmbeddedCssUrls(css, baseUrl) {
  return css
    .replace(/:root\b/g, ":host")
    .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'"\s;)]+)\1\s*\)?([^;]*);/gi, (_match, _quote, value, media) => {
      const url = resolveEmbeddedUrl(value, baseUrl, "resource");
      return url ? `@import url("${url.replaceAll('"', "\\\"")}")${media};` : "";
    })
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, _quote, value) => {
      const url = resolveEmbeddedUrl(value, baseUrl, "resource");
      return url ? `url("${url.replaceAll('"', "\\\"")}")` : "none";
    });
}

function rewriteEmbeddedSrcset(srcset, baseUrl) {
  if (/\bdata:/i.test(srcset)) {
    return null;
  }

  const candidates = srcset.split(",").map((candidate) => {
    const [urlValue, ...descriptors] = candidate.trim().split(/\s+/);
    if (!urlValue) {
      return null;
    }
    const url = resolveEmbeddedUrl(urlValue, baseUrl, "resource");
    return url ? [url, ...descriptors].join(" ") : null;
  }).filter(Boolean);
  return candidates.length ? candidates.join(", ") : null;
}

function resolveEmbeddedUrl(value, baseUrl, purpose) {
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("#")) {
    return candidate || null;
  }
  if (purpose === "resource" && /^data:(image|audio|font|video)\//i.test(candidate)) {
    return candidate;
  }

  try {
    const url = new URL(candidate, baseUrl);
    if (url.protocol === "https:") {
      return url.href;
    }
    return purpose === "navigation" && ["mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function showError(message) {
  status.className = "error";
  status.textContent = message;
}
