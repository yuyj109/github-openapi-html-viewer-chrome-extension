import { isAllowedRawUrl, isSameGitHubRepository } from "./url-utils.mjs";

export async function resolveExternalReferences(rootSpecification, sourceUrl, loadSource) {
  const rootUrl = getDocumentUrl(sourceUrl);
  // Cache in-flight promises as well as parsed documents. Concurrent references
  // to the same file share one request, without retaining private data on disk.
  const documents = new Map([[rootUrl, Promise.resolve(rootSpecification)]]);
  const pendingLoads = [];
  const maxConcurrentLoads = 6;
  let activeLoads = 0;

  async function queueLoad(documentUrl) {
    await new Promise((resolve) => {
      if (activeLoads < maxConcurrentLoads) {
        activeLoads += 1;
        resolve();
      } else {
        pendingLoads.push(resolve);
      }
    });
    try {
      return await loadSource(documentUrl);
    } finally {
      const next = pendingLoads.shift();
      if (next) {
        next();
      } else {
        activeLoads -= 1;
      }
    }
  }

  async function loadDocument(url) {
    const documentUrl = getDocumentUrl(url);
    if (!isAllowedRawUrl(documentUrl) || !isSameGitHubRepository(documentUrl, rootUrl)) {
      throw new Error("External $ref files must be in the same GitHub repository.");
    }
    if (documents.has(documentUrl)) {
      return documents.get(documentUrl);
    }

    const request = queueLoad(documentUrl);
    documents.set(documentUrl, request);
    return request;
  }

  async function resolveNode(node, documentUrl, outputPointer, ancestors) {
    if (Array.isArray(node)) {
      return Promise.all(node.map((item, index) => (
        resolveNode(item, documentUrl, `${outputPointer}/${index}`, ancestors)
      )));
    }
    if (!node || typeof node !== "object") {
      return node;
    }

    if (typeof node.$ref === "string" && (!node.$ref.startsWith("#") || documentUrl !== rootUrl)) {
      const [referencePath, fragment = ""] = node.$ref.split("#", 2);
      const targetUrl = getDocumentUrl(resolveReferenceUrl(referencePath, documentUrl));
      const key = `${targetUrl}#${fragment}`;
      let resolved;
      if (ancestors.has(key)) {
        // A recursive reference must point to its already inlined location in
        // the root document, not to a URL the renderer would fetch itself.
        resolved = { $ref: `#${ancestors.get(key)}` };
      } else {
        // Only ancestors on this branch indicate recursion. Other concurrent
        // branches can use the same reference without being mistaken for cycles.
        const nextAncestors = new Map(ancestors);
        nextAncestors.set(key, outputPointer);
        let targetDocument;
        try {
          targetDocument = await loadDocument(targetUrl);
        } catch (error) {
          throw new Error(`${safeReference(node.$ref)} resolved to ${safeReference(targetUrl)}: ${error.message}`);
        }
        const target = getJsonPointer(targetDocument, fragment);
        if (target === undefined) {
          throw new Error(`Reference not found: ${safeReference(node.$ref)}`);
        }
        resolved = await resolveNode(structuredClone(target), targetUrl, outputPointer, nextAncestors);
      }

      const siblingProperties = await resolveProperties(node, documentUrl, outputPointer, ancestors, true);
      return Object.keys(siblingProperties).length ? { ...resolved, ...siblingProperties } : resolved;
    }

    return resolveProperties(node, documentUrl, outputPointer, ancestors);
  }

  async function resolveProperties(node, documentUrl, outputPointer, ancestors, skipRef = false) {
    return Object.fromEntries(await Promise.all(
      Object.entries(node)
        .filter(([property]) => !skipRef || property !== "$ref")
        .map(async ([property, value]) => [property, await resolveNode(
          value, documentUrl, `${outputPointer}/${encodePointerToken(property)}`, ancestors,
        )]),
    ));
  }

  return resolveNode(rootSpecification, rootUrl, "", new Map());
}

function resolveReferenceUrl(referencePath, documentUrl) {
  const referenceUrl = new URL(referencePath, documentUrl);
  const source = new URL(documentUrl);
  if (
    isGitHubBlobRawUrl(source)
    && isGitHubBlobUrl(referenceUrl)
    && !referenceUrl.searchParams.has("raw")
  ) {
    referenceUrl.searchParams.set("raw", "true");
  }
  return referenceUrl;
}

function getDocumentUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function getJsonPointer(document, fragment) {
  if (!fragment) {
    return document;
  }
  try {
    const pointer = decodeURIComponent(fragment);
    if (!pointer.startsWith("/")) {
      return undefined;
    }
    return pointer.slice(1).split("/").reduce(
      (value, part) => value && Object.hasOwn(value, part.replaceAll("~1", "/").replaceAll("~0", "~"))
        ? value[part.replaceAll("~1", "/").replaceAll("~0", "~")]
        : undefined,
      document,
    );
  } catch {
    return undefined;
  }
}

function encodePointerToken(value) {
  return encodeURIComponent(value.replaceAll("~", "~0").replaceAll("/", "~1"));
}

function safeReference(value) {
  // Do not put private Raw query tokens into error messages.
  return value.replace(/\?[^#]*/, "?[redacted]");
}

function isGitHubBlobUrl(url) {
  return url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname);
}

function isGitHubBlobRawUrl(url) {
  return isGitHubBlobUrl(url) && url.searchParams.get("raw") === "true";
}
