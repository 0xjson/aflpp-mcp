/**
 * Naming contract check.
 *
 * MCP clients namespace tools as `mcp__<server>__<tool>` and sanitize the
 * result to /^[a-zA-Z0-9_-]{1,128}$/ before sending it to the model API.
 * Claude Code does this by rewriting every other character to `_`:
 *
 *   function vn(e){ let t = e.replace(/[^a-zA-Z0-9_-]/g, "_"); ... }
 *
 * A tool named `aflpp.start_fuzz` therefore reaches the agent as
 * `mcp__aflpp__aflpp_start_fuzz`. The agent can still call it, but the name
 * we advertise from `aflpp_list_tools` no longer matches the name the agent
 * sees, permission allowlists written from our docs never match, and
 * `aflpp_help` lookups miss. This script keeps that from regressing.
 *
 * Resolution is checked without invoking handlers, so running this has no
 * side effects on the workspace.
 *
 * Run with: npm run check:names
 */

import { listTools, resolveToolName, runTool } from "../lib/tools.js";

const CANONICAL_NAME = /^aflpp_[a-z0-9_]+$/;
const CLIENT_SANITIZER = /[^a-zA-Z0-9_-]/g;
const LEGACY_PREFIX = "aflpp.";
const CANONICAL_PREFIX = "aflpp_";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function main(): Promise<void> {
  const tools = listTools();

  check(tools.length > 0, "listTools() returned no tools");

  for (const { name } of tools) {
    // 1. Canonical shape.
    check(
      CANONICAL_NAME.test(name),
      `'${name}' does not match ${CANONICAL_NAME} (canonical names are lowercase, underscore-separated)`,
    );

    // 2. Survives client-side sanitization unchanged. This is the property
    //    that actually matters: the name we advertise must equal the name the
    //    agent is able to call.
    const sanitized = name.replace(CLIENT_SANITIZER, "_");
    check(
      sanitized === name,
      `'${name}' is rewritten to '${sanitized}' by MCP clients; the advertised name would not match the callable one`,
    );

    // 3. The advertised name resolves.
    check(
      resolveToolName(name) === name,
      `'${name}' is advertised by listTools() but does not resolve`,
    );

    // 4. The historical dotted spelling still resolves to it, so existing
    //    Codex configs and saved scripts keep working.
    const legacy = LEGACY_PREFIX + name.slice(CANONICAL_PREFIX.length);
    check(
      resolveToolName(legacy) === name,
      `legacy alias '${legacy}' no longer resolves to '${name}'`,
    );
  }

  // 5. Handler descriptions and hints must not reference the dotted spelling:
  //    an agent reading "call aflpp.start_fuzz" would copy a name it cannot see.
  for (const { name, description } of tools) {
    check(
      !new RegExp(`${LEGACY_PREFIX.replace(".", "\\.")}[a-z_]`).test(description ?? ""),
      `description of '${name}' references a dotted tool name; use the canonical spelling`,
    );
  }

  // 6. A genuinely unknown tool is still rejected. (Returns before any
  //    handler runs or anything is logged.)
  const unknown = await runTool("aflpp_does_not_exist", {});
  check(
    unknown.ok === false && unknown.error.code === "NOT_FOUND",
    "an unknown tool name was not rejected with NOT_FOUND",
  );

  if (failures.length > 0) {
    console.error(`check_tool_names: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.error(
    `check_tool_names: ok (${tools.length} tools; canonical names survive client sanitization, legacy aliases resolve)`,
  );
}

main().catch((error: unknown) => {
  console.error(String(error));
  process.exit(1);
});
