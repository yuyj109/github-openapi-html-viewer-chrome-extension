export function getFileExtension(value) {
  const pathname = getPathname(value);
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex > 0 ? filename.slice(extensionIndex + 1).toLowerCase() : "";
}

export function isAllowedRawUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      return false;
    }

    if (url.hostname === "raw.githubusercontent.com") {
      return /^\/[^/]+\/[^/]+\/[^/]+\/.+/.test(url.pathname);
    }

    if (url.hostname !== "github.com") {
      return false;
    }

    if (/^\/[^/]+\/[^/]+\/raw\//.test(url.pathname)) {
      return true;
    }

    return /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)
      && url.searchParams.get("raw") === "true";
  } catch {
    return false;
  }
}

export function isSameGitHubRepository(firstUrl, secondUrl) {
  const firstRepository = getGitHubRepository(firstUrl);
  const secondRepository = getGitHubRepository(secondUrl);
  return firstRepository !== null && firstRepository === secondRepository;
}

export function getAuthenticatedRawUrl(value) {
  if (!isAllowedRawUrl(value)) {
    throw new Error("Unsupported GitHub Raw URL.");
  }

  const url = new URL(value);
  if (url.hostname === "raw.githubusercontent.com") {
    // Obtain a fresh private-file redirect through github.com's session,
    // rather than depending on a file-specific token on the Raw host.
    url.hostname = "github.com";
    url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\//, "$1/raw/");
  }
  // Only the blob endpoint's raw=true flag is needed. Do not carry private
  // tokens (or other query data) into fetch URLs, Viewer URLs or Source links.
  url.search = "";
  if (/^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
    url.searchParams.set("raw", "true");
  }
  url.hash = "";
  return url.href;
}

function getPathname(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return typeof value === "string" ? value : "";
  }
}

function getGitHubRepository(value) {
  if (!isAllowedRawUrl(value)) {
    return null;
  }

  const url = new URL(value);
  const [, owner, repository] = url.pathname.split("/");
  return `${owner.toLowerCase()}/${repository.toLowerCase()}`;
}
