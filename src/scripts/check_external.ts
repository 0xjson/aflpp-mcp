/**
 * External-AFL++ contract check.
 *
 * `AFLPP_ALLOW_EXTERNAL_AFL=1` lets the AFL++ installation itself live outside
 * the workspace root, so a system package can be used instead of the bundled
 * submodule. It must relax containment for AFL++'s own binaries and docs and
 * for nothing else — every path that arrives as a tool argument stays confined.
 *
 * That second half is the part worth guarding: widening `assertWithinRoot` by
 * accident would turn the escape hatch into an arbitrary-path read/write.
 *
 * Run with: npm run check:external
 */

import path from "node:path";

import { aflBin } from "../lib/aflpp.js";
import { getConfig } from "../lib/config.js";
import { runTool } from "../lib/tools.js";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const EXTERNAL = { AFLPP_ALLOW_EXTERNAL_AFL: "1", AFLPP_DIR: "/usr/bin" };
const DEFAULT = { AFLPP_ALLOW_EXTERNAL_AFL: undefined, AFLPP_DIR: "/usr/bin" };

async function main(): Promise<void> {
  // 1. Without the opt-in, an AFL++ dir outside the root is refused.
  withEnv(DEFAULT, () => {
    let threw = false;
    try {
      aflBin("afl-fuzz");
    } catch {
      threw = true;
    }
    check(threw, "external AFL++ dir was accepted without AFLPP_ALLOW_EXTERNAL_AFL");
  });

  // 2. With the opt-in, it resolves to the external path.
  withEnv(EXTERNAL, () => {
    let resolved = "";
    try {
      resolved = aflBin("afl-fuzz");
    } catch (e) {
      check(false, `AFLPP_ALLOW_EXTERNAL_AFL=1 still rejected an external dir: ${String(e)}`);
    }
    check(
      resolved === path.join("/usr/bin", "afl-fuzz"),
      `expected /usr/bin/afl-fuzz with the opt-in, got '${resolved}'`,
    );
    check(getConfig().allowExternalAfl === true, "config did not report allowExternalAfl");
  });

  // 3. THE IMPORTANT ONE: the opt-in must not widen containment for tool
  //    arguments. Each of these must still be refused.
  const wsName = `extcheck_${process.pid}`;
  const confined: Array<[string, () => Promise<{ ok: boolean }>]> = [
    ["corpus import from an absolute outside path", () =>
      runTool("aflpp_import_corpus", { workspace: wsName, src_path: "/etc", corpus_name: "x" })],
    ["corpus import via ../ traversal", () =>
      runTool("aflpp_import_corpus", { workspace: wsName, src_path: "../../../etc", corpus_name: "x" })],
    ["target_cmd pointing outside the root", () =>
      runTool("aflpp_dry_run", { workspace: wsName, target_cmd: ["/bin/cat"], corpus_name: "x" })],
    ["target_cmd as a bare $PATH name", () =>
      runTool("aflpp_dry_run", { workspace: wsName, target_cmd: ["cat"], corpus_name: "x" })],
    ["workspace name traversal", () =>
      runTool("aflpp_init_workspace", { name: "../escape" })],
  ];

  // Run these with the opt-in active, which is when the risk exists.
  process.env.AFLPP_ALLOW_EXTERNAL_AFL = "1";
  process.env.AFLPP_DIR = "/usr/bin";
  try {
    await runTool("aflpp_init_workspace", { name: wsName });
    for (const [label, fn] of confined) {
      const res = await fn();
      check(res.ok === false, `containment breach with AFLPP_ALLOW_EXTERNAL_AFL=1: ${label} was allowed`);
    }
  } finally {
    delete process.env.AFLPP_ALLOW_EXTERNAL_AFL;
    delete process.env.AFLPP_DIR;
    const { rm } = await import("node:fs/promises");
    await rm(path.join(getConfig().workspacesDir, wsName), { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`check_external: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.error("check_external: ok (opt-in gates the AFL++ dir; tool-argument containment unaffected)");
}

main().catch((error: unknown) => {
  console.error(String(error));
  process.exit(1);
});
