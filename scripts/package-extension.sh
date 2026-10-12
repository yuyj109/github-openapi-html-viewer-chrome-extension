#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="${project_root}/.build"
package_root="${build_root}/chrome-extension"
output_root="${project_root}/dist"

"${project_root}/scripts/verify-extension.sh"

version="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "${project_root}/manifest.json")"
archive="${output_root}/github-openapi-html-viewer-v${version}.zip"

rm -rf "${package_root}"
mkdir -p "${package_root}" "${output_root}"

package_files=(
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
  assets
  vendor
)

for file in "${package_files[@]}"; do
  cp -R "${project_root}/${file}" "${package_root}/${file}"
done

find "${package_root}" -name '.DS_Store' -delete
rm -f "${archive}"
(cd "${package_root}" && zip -qry "${archive}" .)

echo "Created ${archive}"
