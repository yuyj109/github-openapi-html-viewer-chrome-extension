# GitHub OpenAPI & HTML Viewer

A Chrome extension that previews files on GitHub in a dedicated tab.

## Usage

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** in the upper-right corner.
3. Click **Load unpacked**, then select this repository's directory.
4. Open a supported file on GitHub and click **Preview**, located to the left of `Raw`.
5. For OpenAPI documents, click the **GitHub OpenAPI & HTML Viewer** icon in the Chrome toolbar, select ReDoc or Swagger UI in the popup, and click **Done**. Subsequent in-page **Preview** links will use this selection.

When you open a supported file directly on `raw.githubusercontent.com`, click the persistent **Preview** button in the upper-right corner.

## Supported formats

| Format | Preview behavior |
| --- | --- |
| HTML (`.html`, `.htm`) | Opens as a safe static preview when you click **Preview** to the left of `Raw`. |
| JSON / YAML (`.json`, `.yaml`, `.yml`) | OpenAPI 2.0 and 3.x documents open in the ReDoc or Swagger UI renderer selected in the popup. |

## OpenAPI previews

OpenAPI 2.0 and 3.x documents in `.json`, `.yaml`, and `.yml` files open using the **ReDoc** or **Swagger UI** renderer saved in the popup. JSON and YAML files that are not OpenAPI documents are not supported. Relative external `$ref` references within the same GitHub repository are also resolved.

A `#/...` reference in an external file is resolved relative to that file, and circular references are converted to references within the preview document. To access Raw files in private repositories, the extension fetches them through `github.com`; you must be signed in to GitHub in the same browser profile and have permission to view the repository. In an Incognito window, the window's own GitHub sign-in state is used.

Up to six external `$ref` files are fetched in parallel. References to the same file share the in-flight request and parsed data in the preview's memory. Documents are not stored in extension storage, and the cache is rebuilt when the viewer is reloaded.

ReDoc, Swagger UI, and the YAML parser are bundled with the extension, so rendering a specification does not depend on an external CDN.

Code blocks marked as `mermaid` in OpenAPI descriptions are rendered as Mermaid diagrams after ReDoc or Swagger UI finishes rendering.

## How it works and security

- The extension fetches content from GitHub Raw URLs. For private repositories, it uses the browser session currently signed in to GitHub.
- Before opening the viewer, it normalizes the Raw URL and does not carry authentication tokens into the viewer URL or the **Source** link. If an older viewer URL containing a token is opened, the current URL is replaced; entries already present in browsing history are not removed.
- **Source** returns to the Raw view in the same tab. For private files, GitHub may add a token to the Raw URL after redirecting; this GitHub authentication behavior is used as-is.
- HTML is rendered in an isolated Shadow DOM. JavaScript, event attributes, and embedded frames are not executed.
- Relative CSS and image URLs in HTML are resolved from the file's GitHub directory.

## Supported URL pattern

The extension supports file pages in the following format:

`https://github.com/{owner}/{repository}/blob/{branch}/{path}/file.{extension}`

## Chrome Web Store release

The development source and the archive submitted to the Chrome Web Store are kept separate.

```text
.
├── scripts/
│   ├── verify-extension.sh    # Validates syntax and required files
│   └── package-extension.sh   # Creates the ZIP for Chrome Web Store submission
├── assets/icons/              # PNG icons for the extension and store (16/32/48/128 px)
├── store/                     # Store listing icons, screenshots, and descriptions
├── vendor/                    # Bundled third-party libraries and licenses
└── dist/                      # Generated submission ZIP (not tracked by Git)
```

Before a release, update `version` in `manifest.json`, then run:

```bash
./scripts/package-extension.sh
```

This creates `dist/github-openapi-html-viewer-v{version}.zip`. The icons, screenshots, and permission-description template required for the store listing are documented in [store/README.md](store/README.md).
