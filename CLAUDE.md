# CLAUDE.md

MCP server exposing AFL++ to coding agents. TypeScript, ESM, stdio transport,
`@modelcontextprotocol/sdk`.

## Commands

```bash
npm install
npm run build          # tsc -> dist/
npm run check          # both contract checks below
npm run check:names    # tool-naming contract (fast, no side effects)
npm run check:external # external-AFL++ opt-in + containment invariant
npm run smoke:local    # end-to-end: build a toy target, fuzz it, stop it
npm run dev            # tsx src/index.ts, no build step
```

`check`, `check:names`, `check:external` and `smoke:local` all require
`npm run build` first. `smoke:local` additionally needs a working AFL++ (see
below) and writes into `workspaces/smoke/`.

There is no unit test framework in this repo. These scripts are the verification
story; keep them passing.

## AFL++ submodule

`AFLplusplus/` is a git submodule pinned to a specific commit. A fresh clone has
it empty, which makes every `afl-*` binary path and every `aflpp://docs/*`
resource fail:

```bash
git submodule update --init          # add --recursive for optional AFL++ modes
make -C AFLplusplus                  # several minutes
```

`aflpp_version` returning `aflppVersion: null` is the symptom of a missing checkout.

The build summary skips LLVM LTO mode without `lld`, and GCC plugin mode without
`gcc-<N>-plugin-dev`. Both are optional; `afl-clang-fast` covers the common case.
`aflpp_build_instrumented` only needs LTO when called with `profile: "lto"` —
without it that profile fails at build time, not at registration. See the
optional-modes table in `README.md`.

## Layout

| File | Role |
|---|---|
| `src/index.ts` | MCP wiring: registers the five request handlers, connects stdio |
| `src/lib/tools.ts` | All 30 tools — registration, schemas, handlers, dispatch |
| `src/lib/resources.ts` | `aflpp://` resources and URI templates |
| `src/lib/prompts.ts` | The two workflow prompts |
| `src/lib/config.ts` | Env-driven config; everything resolves from `AFLPP_MCP_ROOT` |
| `src/lib/validate.ts` | Argument validators + `assertWithinRoot` |
| `src/lib/subprocess.ts` | `runCommand` (capped, timed) and `spawnDetached` (fuzz jobs) |
| `src/lib/fs.ts` | Root-checked filesystem helpers |
| `src/lib/logging.ts` | JSONL audit log per workspace |

`tools.ts` is large because tool registration is co-located with its handler.
Keep that pattern; if you split it, split by workflow stage (build / corpus /
run / triage), not by moving schemas away from handlers.

## Invariants

**1. Every filesystem path goes through `assertWithinRoot`.**
No tool may read or write outside `AFLPP_MCP_ROOT`. New tools that take a path
argument must route it through `workspacePath()` or `assertWithinRoot()` before
touching it. `validateTargetCmdExecutable` additionally rejects bare command
names so `target_cmd` cannot reach `$PATH`.

**2. Tool names must match `/^aflpp_[a-z0-9_]+$/`.**
MCP clients namespace tools as `mcp__<server>__<tool>` and sanitize the result
to `/^[a-zA-Z0-9_-]{1,128}$/`. Claude Code rewrites every other character to `_`.
A dot in a tool name therefore desyncs the name we advertise from the name the
agent can call, which silently breaks permission allowlists and `aflpp_help`
lookups. `npm run check:names` enforces this.

The pre-0.2 dotted spelling (`aflpp.start_fuzz`) still resolves via
`canonicalToolName()` in `tools.ts`, so older Codex configs keep working. Do not
add new dotted names, and do not reference them in tool descriptions or hint
strings — an agent will copy a name it cannot call.

**3. Long-running work is detached, never awaited.**
`start_fuzz` / `start_fuzz_cluster` use `spawnDetached` and return a PID. Tools
that shell out synchronously use `runCommand` with an explicit timeout and
output cap. Never block an MCP request on a fuzz campaign.

## Adding a tool

1. `registerTool({ name: "aflpp_<verb>_<noun>", description, inputSchema, handler })`.
2. Build the schema with `globalInputSchema(props, required)` — it sets
   `additionalProperties: false`.
3. Validate args with the `require*` helpers; throw `ToolError(CODE, msg)` for
   bad input. Return `ok(name, data)` / `err(name, code, msg)`.
4. Route every path through the root check.
5. Run `npm run check`.
6. Add it to the tool list in `README.md`.

## Client config

`.mcp.json` registers this server for Claude Code at project scope. Verified
behavior of that file: Claude Code only reads it when launched from the project
root, spawns the server with cwd set to that root (so relative `args` paths
work, and `AFLPP_MCP_ROOT` correctly defaults to `process.cwd()`), expands
`${VAR}` in `env` from the ambient environment, and does **not** expand
`${CLAUDE_PROJECT_DIR}` there — that variable is hooks-only.

### External AFL++

`AFLPP_ALLOW_EXTERNAL_AFL=1` lets the AFL++ install sit outside `AFLPP_MCP_ROOT`
(`AFLPP_DIR=/usr/bin`, `AFLPP_LIB_DIR=/usr/lib/afl`). It routes AFL++'s own paths
through `assertAflInstallPath()` instead of `assertWithinRoot()`.

**This must never widen containment for anything else.** Tool-argument paths keep
going through `assertWithinRoot`/`workspacePath` regardless of the flag; widening
that would turn the opt-in into arbitrary filesystem access. `npm run
check:external` asserts both halves, including that traversal and absolute-path
tool arguments are still refused while the flag is set.

`.claude/settings.json` pre-approves the twelve inspection tools. Anything that
builds, executes the target, starts or stops a campaign, or writes artifacts
deliberately still prompts.
