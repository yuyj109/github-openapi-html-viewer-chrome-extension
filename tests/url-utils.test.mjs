import assert from "node:assert/strict";
import test from "node:test";
import { getAuthenticatedRawUrl, getFileExtension, isAllowedRawUrl, isSameGitHubRepository } from "../url-utils.mjs";

test("allows GitHub Raw URLs and blob URLs with raw=true", () => {
  assert.equal(isAllowedRawUrl("https://raw.githubusercontent.com/owner/repo/main/openapi.yaml"), true);
  assert.equal(isAllowedRawUrl("https://github.com/owner/repo/raw/main/openapi.yaml"), true);
  assert.equal(isAllowedRawUrl("https://github.com/owner/repo/blob/main/openapi.yaml?raw=true"), true);
  assert.equal(isAllowedRawUrl("https://github.com/owner/repo/blob/main/openapi.yaml?raw=false"), false);
  assert.equal(isAllowedRawUrl("https://evil.example/openapi.yaml"), false);
});

test("matches references only within the same GitHub repository", () => {
  assert.equal(isSameGitHubRepository(
    "https://raw.githubusercontent.com/owner/repo/main/openapi.yaml",
    "https://github.com/owner/repo/raw/main/components/user.yaml",
  ), true);
  assert.equal(isSameGitHubRepository(
    "https://raw.githubusercontent.com/owner/repo/main/openapi.yaml",
    "https://raw.githubusercontent.com/other/repo/main/components/user.yaml",
  ), false);
});

test("uses the filename when detecting an extension", () => {
  assert.equal(getFileExtension("https://raw.githubusercontent.com/owner/repo/main/docs.v1/openapi.yaml"), "yaml");
  assert.equal(getFileExtension("https://raw.githubusercontent.com/owner/repo/main/docs.v1/no-extension"), "");
});

test("uses GitHub's session route instead of reusing private Raw tokens", () => {
  assert.equal(getAuthenticatedRawUrl(
    "https://raw.githubusercontent.com/owner/repo/refs/heads/main/openapi/root.yaml?token=example-only#fragment",
  ), "https://github.com/owner/repo/raw/refs/heads/main/openapi/root.yaml");
  assert.equal(getAuthenticatedRawUrl(
    "https://raw.githubusercontent.com/owner/repo/feature/branch/components/Problem.yaml",
  ), "https://github.com/owner/repo/raw/feature/branch/components/Problem.yaml");
  assert.equal(getAuthenticatedRawUrl(
    "https://github.com/owner/repo/blob/main/openapi.yaml?raw=true",
  ), "https://github.com/owner/repo/blob/main/openapi.yaml?raw=true");
  assert.equal(getAuthenticatedRawUrl(
    "https://github.com/owner/repo/raw/refs/heads/main/openapi.yaml?token=example-only#fragment",
  ), "https://github.com/owner/repo/raw/refs/heads/main/openapi.yaml");
  assert.equal(getAuthenticatedRawUrl(
    "https://github.com/owner/repo/blob/main/openapi.yaml?token=example-only&raw=true&other=example#fragment",
  ), "https://github.com/owner/repo/blob/main/openapi.yaml?raw=true");
  assert.equal(isAllowedRawUrl("https://user:example-only@github.com/owner/repo/raw/main/openapi.yaml"), false);
  assert.throws(() => getAuthenticatedRawUrl("https://evil.example/file.yaml"), /Unsupported/);
});
