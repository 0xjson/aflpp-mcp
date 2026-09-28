import path from "node:path";

export type Config = {
  workspaceRoot: string;
  workspacesDir: string;
  aflppDir: string;
  aflBinDir: string;
  /**
   * Directory holding AFL++'s helper objects (afl-compiler-rt.o, instrumentation
   * passes), exported as AFL_PATH. A source checkout keeps these beside the
   * binaries; packaged installs split them (/usr/bin vs /usr/lib/afl).
   */
  aflLibDir: string;
  /** Explicit AFL++ documentation directory, for installs that ship docs apart from the binaries. */
  aflDocDir: string | undefined;
  /**
   * Opt-in: permit the AFL++ installation to live outside `workspaceRoot`, so a
   * system package (`/usr/bin`, `/usr/share/doc/...`) can be used instead of the
   * bundled submodule.
   *
   * This relaxes containment for AFL++'s own binaries and docs ONLY. Workspaces,
   * targets, corpora, and every path supplied as a tool argument stay confined to
   * `workspaceRoot` regardless of this setting.
   */
  allowExternalAfl: boolean;
  maxToolOutputBytes: number;
  maxLogFileBytes: number;
  defaultTimeoutMs: number;
};

function envFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getConfig(): Config {
  const workspaceRoot = path.resolve(process.env.AFLPP_MCP_ROOT ?? process.cwd());
  const aflppDir = path.resolve(
    process.env.AFLPP_DIR ?? path.join(workspaceRoot, "AFLplusplus"),
  );

  return {
    workspaceRoot,
    workspacesDir: path.join(workspaceRoot, "workspaces"),
    aflppDir,
    aflBinDir: aflppDir,
    aflLibDir: process.env.AFLPP_LIB_DIR ? path.resolve(process.env.AFLPP_LIB_DIR) : aflppDir,
    aflDocDir: process.env.AFLPP_DOC_DIR ? path.resolve(process.env.AFLPP_DOC_DIR) : undefined,
    allowExternalAfl: envFlag(process.env.AFLPP_ALLOW_EXTERNAL_AFL),
    maxToolOutputBytes: parseInt(process.env.AFLPP_MCP_MAX_TOOL_OUTPUT_BYTES ?? "200000", 10),
    maxLogFileBytes: parseInt(process.env.AFLPP_MCP_MAX_LOG_BYTES ?? "5000000", 10),
    defaultTimeoutMs: parseInt(process.env.AFLPP_MCP_DEFAULT_TIMEOUT_MS ?? "30000", 10),
  };
}

