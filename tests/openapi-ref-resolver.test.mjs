import assert from "node:assert/strict";
import test from "node:test";
import { resolveExternalReferences } from "../openapi-ref-resolver.mjs";

test("inlines repeated external references", async () => {
  const sourceUrl = "https://raw.githubusercontent.com/owner/repo/main/openapi/openapi.yaml";
  const parameterUrl = "https://raw.githubusercontent.com/owner/repo/main/components/Parameter.yaml";
  const documents = new Map([[parameterUrl, {
    PageSize: { name: "pageSize", in: "query", schema: { type: "integer" } },
  }]]);
  let loads = 0;

  const result = await resolveExternalReferences({
    paths: {
      "/users": {
        get: {
          parameters: [
            { $ref: "../components/Parameter.yaml#/PageSize" },
            { $ref: "../components/Parameter.yaml#/PageSize" },
          ],
        },
      },
    },
  }, sourceUrl, async (url) => {
    loads += 1;
    return structuredClone(documents.get(url));
  });

  assert.equal(loads, 1);
  assert.deepEqual(result.paths["/users"].get.parameters, [
    { name: "pageSize", in: "query", schema: { type: "integer" } },
    { name: "pageSize", in: "query", schema: { type: "integer" } },
  ]);
});

test("keeps raw=true when resolving relative references from a GitHub blob URL", async () => {
  const sourceUrl = "https://github.com/owner/repo/blob/main/openapi/openapi.yaml?raw=true";
  const referenceUrl = "https://github.com/owner/repo/blob/main/components/Problem.yaml?raw=true";

  const result = await resolveExternalReferences({
    components: { schemas: { Problem: { $ref: "../components/Problem.yaml#/Problem" } } },
  }, sourceUrl, async (url) => {
    assert.equal(url, referenceUrl);
    return { Problem: { type: "object", title: "Problem" } };
  });

  assert.deepEqual(result.components.schemas.Problem, { type: "object", title: "Problem" });
});

test("resolves references inside imported files using their original document", async () => {
  const sourceUrl = "https://github.com/owner/repo/raw/refs/heads/main/openapi/root.yaml";
  const documents = new Map([
    ["https://github.com/owner/repo/raw/refs/heads/main/openapi/paths/users.yaml", {
      post: {
        parameters: [{ $ref: "#/parameters/Page" }],
        responses: { 400: { $ref: "#/responses/BadRequest" } },
      },
      parameters: { Page: { name: "page", in: "query" } },
      responses: { BadRequest: {
        description: "Bad Request",
        content: { "application/problem+json": { schema: { $ref: "../components/schemas/Problem.yaml#/Problem" } } },
      } },
    }],
    ["https://github.com/owner/repo/raw/refs/heads/main/openapi/components/schemas/Problem.yaml", {
      Problem: { type: "object", properties: { title: { $ref: "#/Title" } } },
      Title: { type: "string" },
    }],
  ]);
  const root = {
    paths: { "/users": { $ref: "./paths/users.yaml#/post" } },
    components: { schemas: { Local: { type: "string" }, Copy: { $ref: "#/components/schemas/Local" } } },
  };
  const result = await resolveExternalReferences(root, sourceUrl, async (url) => {
    assert.ok(documents.has(url), `Unexpected request: ${url}`);
    return structuredClone(documents.get(url));
  });
  assert.deepEqual(result.paths["/users"].parameters, [{ name: "page", in: "query" }]);
  assert.deepEqual(result.paths["/users"].responses[400].content["application/problem+json"].schema, {
    type: "object", properties: { title: { type: "string" } },
  });
  assert.equal(result.components.schemas.Copy.$ref, "#/components/schemas/Local");
  assert.equal(root.paths["/users"].$ref, "./paths/users.yaml#/post");
});

test("rebases recursive external schemas to valid local pointers", async () => {
  const sourceUrl = "https://github.com/owner/repo/raw/main/root.yaml";
  const result = await resolveExternalReferences({
    paths: { "/users": { get: { responses: { 200: { schema: { $ref: "./Node.yaml#/Node" } } } } } },
  }, sourceUrl, async () => ({
    Node: { type: "object", properties: { child: { $ref: "#/Node" } } },
  }));
  const schema = result.paths["/users"].get.responses[200].schema;
  assert.equal(schema.properties.child.$ref, "#/paths/~1users/get/responses/200/schema");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("supports circular references across files without renderer network requests", async () => {
  const sourceUrl = "https://github.com/owner/repo/raw/main/root.yaml";
  const documents = new Map([
    ["https://github.com/owner/repo/raw/main/A.yaml", { A: { properties: { next: { $ref: "./B.yaml#/B" } } } }],
    ["https://github.com/owner/repo/raw/main/B.yaml", { B: { properties: { next: { $ref: "./A.yaml#/A" } } } }],
  ]);
  const result = await resolveExternalReferences({
    components: { schemas: { A: { $ref: "./A.yaml#/A" } } },
  }, sourceUrl, async (url) => structuredClone(documents.get(url)));
  assert.equal(result.components.schemas.A.properties.next.properties.next.$ref, "#/components/schemas/A");
});

test("blocks references outside the repository before fetching", async () => {
  for (const reference of ["https://evil.example/file.yaml", "https://github.com/other/repo/raw/main/file.yaml"]) {
    await assert.rejects(resolveExternalReferences({ $ref: reference },
      "https://github.com/owner/repo/raw/main/root.yaml", async () => {
        assert.fail("Must not fetch a disallowed reference");
      }), /same GitHub repository/);
  }
});

test("reports failed reference paths without exposing query tokens", async () => {
  await assert.rejects(resolveExternalReferences({
    $ref: "./Problem.yaml?token=example-only#/Problem",
  }, "https://github.com/owner/repo/raw/main/root.yaml", async () => {
    throw new Error("GitHub returned 404");
  }), (error) => {
    assert.match(error.message, /Problem.yaml/);
    assert.match(error.message, /GitHub returned 404/);
    assert.equal(error.message.includes("example-only"), false);
    return true;
  });
});

test("shares in-flight loads for different fragments in the same document", async () => {
  let loads = 0;
  const result = await resolveExternalReferences({
    parameters: [{ $ref: "./Parameters.yaml#/Page" }, { $ref: "./Parameters.yaml#/Limit" }],
  }, "https://github.com/owner/repo/raw/main/root.yaml", async () => {
    loads += 1;
    await Promise.resolve();
    return { Page: { name: "page" }, Limit: { name: "limit" } };
  });
  assert.equal(loads, 1);
  assert.deepEqual(result.parameters, [{ name: "page" }, { name: "limit" }]);
});

test("limits simultaneous document requests to six", { timeout: 2000 }, async () => {
  let signalCapacity;
  let releaseRequests;
  const capacityReached = new Promise((resolve) => { signalCapacity = resolve; });
  const gate = new Promise((resolve) => { releaseRequests = resolve; });
  let active = 0;
  let peak = 0;
  let loads = 0;
  const references = Array.from({ length: 18 }, (_, index) => ({ $ref: `./Schema${index}.yaml` }));
  const pending = resolveExternalReferences({ schemas: references },
    "https://github.com/owner/repo/raw/main/root.yaml", async () => {
      loads += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (loads === 6) {
        signalCapacity();
      }
      await gate;
      active -= 1;
      return { type: "string" };
    });
  await capacityReached;
  assert.equal(loads, 6);
  assert.equal(active, 6);
  releaseRequests();
  const result = await pending;
  assert.equal(peak, 6);
  assert.equal(loads, 18);
  assert.equal(active, 0);
  assert.deepEqual(result.schemas, references.map(() => ({ type: "string" })));
});

test("keeps parallel copies of recursive schemas independent", async () => {
  let loads = 0;
  const result = await resolveExternalReferences({
    schemas: [{ $ref: "./Node.yaml#/Node" }, { $ref: "./Node.yaml#/Node" }],
  }, "https://github.com/owner/repo/raw/main/root.yaml", async () => {
    loads += 1;
    return { Node: { properties: { child: { $ref: "#/Node" } } } };
  });
  assert.equal(loads, 1);
  assert.equal(result.schemas[0].properties.child.$ref, "#/schemas/0");
  assert.equal(result.schemas[1].properties.child.$ref, "#/schemas/1");
});

test("starts a fresh document cache for each preview", async () => {
  let loads = 0;
  const root = { schema: { $ref: "./Schema.yaml" } };
  const loadSource = async () => ({ title: `revision-${++loads}` });
  const url = "https://github.com/owner/repo/raw/main/root.yaml";
  const first = await resolveExternalReferences(root, url, loadSource);
  const second = await resolveExternalReferences(root, url, loadSource);
  assert.equal(first.schema.title, "revision-1");
  assert.equal(second.schema.title, "revision-2");
});
