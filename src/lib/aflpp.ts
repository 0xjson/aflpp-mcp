import fs from "node:fs/promises";
import path from "node:path";

import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { assertWithinRoot } from "./validate.js";

export type AflBinaryName =
  | "afl-fuzz"
  | "afl-showmap"
  | "afl-cmin"
  | "afl-tmin"
  | "afl-analyze"
  | "afl-whatsup"
  | "afl-plot"
  | "afl-cc"
  | "afl-c++"
  | "afl-clang-fast"
  | "afl-clang-fast++"
  | "afl-clang-lto"
  | "afl-clang-lto++";

/**
 * Resolve a path belonging to the AFL++ installation itself (a binary, a doc).
 *
 * By default these must live inside `workspaceRoot`, like every other path the
 * server touches. Setting `AFLPP_ALLOW_EXTERNAL_AFL=1` lifts that restriction
 * for AFL++'s own files so a system package can be used, and for nothing else —
 * paths that arrive as tool arguments keep going through `assertWithinRoot`.
 */
export function assertAflInstallPath(candidate: string, name: string): string {
  const cfg = getConfig();
  if (cfg.allowExternalAfl) return path.resolve(candidate);
  return assertWithinRoot(cfg.workspaceRoot, candidate, name);
}

export function aflBin(name: AflBinaryName): string {
  const cfg = getConfig();
  const p = path.join(cfg.aflBinDir, name);
  return assertAflInstallPath(p, "AFL++ binary path");
}

/**
 * Best-effort AFL++ version.
 *
 * A source checkout states it in README.md. A packaged install (apt, homebrew)
 * ships no README, so fall back to the `afl-fuzz` banner, which both layouts
 * print: "afl-fuzz++4.33c based on afl by ...".
 */
export async function getAflppReleaseVersion(): Promise<string | null> {
  const cfg = getConfig();
  const readmePath = path.join(cfg.aflppDir, "README.md");
  try {
    const text = await fs.readFile(readmePath, "utf8");
    const line = text.split("\n").find((l) => l.startsWith("Release version:"));
    const m = line?.match(/Release version:\s*\[([^\]]+)\]/);
    if (m?.[1]) return m[1];
  } catch {
    // Not a source checkout; fall through to the binary banner.
  }

  try {
    const { runCommand } = await import("./subprocess.js");
    // afl-fuzz with no arguments prints its banner and usage, then exits non-zero.
    const res = await runCommand([aflBin("afl-fuzz")], {
      timeoutMs: 5000,
      maxOutputBytes: 8192,
    });
    const banner = stripAnsi(`${res.stdout}\n${res.stderr}`);
    return banner.match(/afl-fuzz\+\+([0-9]+\.[0-9]+[a-z]?)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function validateTargetCmdExecutable(root: string, targetCmd: string[]): void {
  if (targetCmd.length === 0) throw new ToolError("INVALID_ARGUMENT", "target_cmd must be non-empty");
  const exe = targetCmd[0];
  if (!exe.includes("/") && !exe.includes("\\")) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "target_cmd[0] must be an absolute or relative path (not a bare command name)",
    );
  }
  assertWithinRoot(root, path.resolve(root, exe), "target_cmd[0]");
}

export function parseFuzzerStats(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
