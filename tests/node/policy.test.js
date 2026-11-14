import { test } from "node:test";
import assert from "node:assert/strict";

import { PolicyEngine, loadBinding } from "@l2/agent-core";

test("deny wins, unknown denied, approval gated, permits()", () => {
  const engine = new PolicyEngine({ rules: [
    { action: "file.write", effect: "allow", conditions: { paths: ["tests/**"] } },
    { action: "file.write", effect: "deny", conditions: { paths: [".github/**"] } },
    { action: "commit.create", effect: "require-approval" },
    { action: "work-item.link", effect: "allow" },
  ] });
  assert.ok(engine.evaluate({ action: "file.write", attributes: { path: "tests/a.js" } }).allowed);
  assert.equal(engine.evaluate({ action: "repo.delete" }).allowed, false);
  assert.ok(engine.evaluate({ action: "commit.create" }).requiresApproval);
  assert.equal(engine.permits("commit.create"), false);
  assert.equal(engine.permits("work-item.link"), true);
  assert.throws(() => engine.authorize({ action: "file.write", attributes: { path: "src/x.js" } }), /Denied/);
});

test("shipped policies: TestGen never writes .github; default gates work-item writes", async () => {
  const testgen = new PolicyEngine((await loadBinding("testgen")).policy);
  assert.equal(testgen.evaluate({ action: "file.write", attributes: { path: ".github/workflows/a.test.js" } }).allowed, false);
  const planned = new PolicyEngine((await loadBinding("architectconnect")).policy);
  assert.ok(planned.evaluate({ action: "work-item.read" }).allowed);
  for (const a of ["work-item.create", "work-item.comment", "work-item.link"]) assert.ok(planned.evaluate({ action: a }).requiresApproval, a);
  const requirements = new PolicyEngine((await loadBinding("requirementshub")).policy);
  assert.equal(requirements.permits("work-item.read"), true);
  for (const action of ["work-item.create", "work-item.comment", "work-item.link"]) assert.equal(requirements.evaluate({ action }).allowed, false, action);
});
