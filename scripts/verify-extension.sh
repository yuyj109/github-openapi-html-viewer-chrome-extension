#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_files=(
  manifest.json
  background.js
  content.js
  content.css
  popup.html
  popup.js
  popup.css
  viewer.html
  viewer.js
  viewer.css
  url-utils.mjs
  openapi-ref-resolver.mjs
  assets/icons/icon-16.png
  assets/icons/icon-32.png
  assets/icons/icon-48.png
  assets/icons/icon-128.png
  vendor/js-yaml/js-yaml.umd.min.js
  vendor/redoc/redoc.standalone.js
  vendor/swagger-ui/swagger-ui-bundle.js
  vendor/swagger-ui/swagger-ui-standalone-preset.js
  vendor/swagger-ui/swagger-ui.css
  vendor/mermaid/mermaid.min.js
)

for file in "${required_files[@]}"; do
  [[ -f "${project_root}/${file}" ]] || {
    echo "Missing required file: ${file}" >&2
    exit 1
  }
done

node --check "${project_root}/background.js"
node --check "${project_root}/content.js"
node --check "${project_root}/popup.js"
node --check "${project_root}/viewer.js"
node --check "${project_root}/url-utils.mjs"
node --check "${project_root}/openapi-ref-resolver.mjs"
node --test "${project_root}"/tests/*.test.mjs

node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
  if (!manifest.name || !manifest.version) throw new Error("Manifest name and version are required");
  for (const icon of Object.values(manifest.icons || {})) {
    if (!fs.existsSync(`${require("node:path").dirname(process.argv[1])}/${icon}`)) {
      throw new Error(`Missing manifest icon: ${icon}`);
    }
  }
  console.log(`Verified ${manifest.name} v${manifest.version}`);
' "${project_root}/manifest.json"
