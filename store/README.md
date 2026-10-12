# Chrome Web Store release assets

This directory is intentionally excluded from the extension ZIP. Keep Chrome Web Store listing assets here:

- Store icon: `../assets/icons/icon-128.png` (128 × 128 PNG)
- At least one 1280 × 800 or 640 × 400 screenshot
- Promotional images, if used
- Privacy-policy URL, if one is required for the selected disclosures

## Listing copy

**Name**: GitHub OpenAPI & HTML Viewer

**Short description**: Preview GitHub HTML files and OpenAPI specifications with ReDoc or Swagger UI.

**Permission rationale**:

- `github.com` and `raw.githubusercontent.com`: read the GitHub file selected by the user and its same-repository relative OpenAPI `$ref` files.
- `declarativeContent`: show the extension action only on GitHub and GitHub Raw pages.
- `storage`: save the user's ReDoc / Swagger UI preference.

## Release checklist

1. Update `manifest.json` version.
2. Run `./scripts/package-extension.sh`.
3. Upload the resulting `dist/github-openapi-html-viewer-v*.zip` to Chrome Web Store Developer Dashboard.
4. Complete the store listing and data-use disclosures with the assets in this directory.
5. Test the staged item before publishing.
