# AFL++ MCP server

Model Context Protocol (MCP) server for AFL++.

This repo vendors AFL++ as a git submodule and exposes an agent-friendly API for:
- creating fuzzing workspaces,
- instrumenting targets,
- corpus import/minimization,
- harness preflight (dry run / showmap),
- starting/stopping AFL++ jobs,
- polling structured status and triaging findings,
- other stuff

## Install

### Build

```bash
git clone https://github.com/kevin-valerio/aflpp-mcp.git
cd aflpp-mcp

git submodule update --init      # add --recursive for AFL++ optional-mode submodules
make -C AFLplusplus              # builds the afl-* binaries; takes a few minutes

npm install
npm run build
```

The submodule step is not optional: without it the `afl-*` binaries and the
`aflpp://docs/*` resources are missing. `aflpp_version` reporting
`aflppVersion: null` means AFL++ is not checked out.

#### Optional AFL++ build modes

`make -C AFLplusplus` prints a build summary. Two modes are skipped unless
their toolchain is present, and both are worth having:

| Mode | Needs | Why you want it |
|---|---|---|
| **LLVM LTO** (`afl-clang-lto`) | `lld` (LLVM 11+) | Collision-free edge coverage and better instrumentation than `afl-clang-fast`. Use it whenever the project links cleanly. |
| **GCC plugin** (`afl-gcc-fast`) | `gcc-<N>-plugin-dev` | Instruments projects that will not build under clang. |

On Debian/Ubuntu, with `<N>` matching `gcc -dumpversion`:

```bash
sudo apt install lld gcc-$(gcc -dumpversion)-plugin-dev
make -C AFLplusplus clean && make -C AFLplusplus
```

Re-read the build summary afterwards; `[+] LLVM LTO mode successfully built`
and `[+] gcc_mode successfully built` confirm it. Neither mode is required —
`afl-clang-fast` (LLVM mode) covers the common case, and
`aflpp_build_instrumented` only requests `lto` when you pass `profile: "lto"`.

### Install in Claude Code

This repo ships a project-scoped [`.mcp.json`](.mcp.json), so after building,
running `claude` from the repo root is enough — approve the `aflpp` server when
prompted.

To use the server from another project, register it globally with an absolute
path:

```bash
claude mcp add aflpp --scope user \
  --env AFLPP_MCP_ROOT="$PWD" \
  -- node "$PWD/dist/index.js"
```

Verify with `claude mcp list`, or `/mcp` inside a session.

**Permissions.** Claude Code prompts before each MCP tool call. The bundled
[`.claude/settings.json`](.claude/settings.json) pre-approves the twelve
inspection tools (`status`, `list_findings`, `whatsup`, …) so that polling a
campaign does not generate a prompt per poll. Everything that builds, executes
the target, starts or stops a campaign, or writes artifacts still prompts. Add
more at your own discretion:

```json
{
  "permissions": {
    "allow": ["mcp__aflpp__aflpp_start_fuzz", "mcp__aflpp__aflpp_dry_run"]
  }
}
```

Tool names are namespaced `mcp__aflpp__<tool>` — for example
`mcp__aflpp__aflpp_start_fuzz`.

**Prompts** are available as slash commands:
`/mcp__aflpp__aflpp-agent-workflow` and `/mcp__aflpp__aflpp-harness-workplan`.

**Resources** can be @-mentioned: `@aflpp:aflpp://docs/cmplog`.

**Skill.** [`.claude/skills/aflpp-fuzzing/`](.claude/skills/aflpp-fuzzing/SKILL.md)
drives the whole loop — harness, builds, campaign, triage — so you can say "fuzz
this parser" without knowing the tool names.

### Install in Codex CLI

```bash
codex mcp add aflpp --env AFLPP_MCP_ROOT="$PWD" -- node "$PWD/dist/index.js"
```

### Install in Claude Desktop

Add to your `mcpServers` config (adjust paths):

```json
{
  "mcpServers": {
    "aflpp": {
      "command": "node",
      "args": ["/path/to/aflpp-mcp/dist/index.js"],
      "env": {
        "AFLPP_MCP_ROOT": "/path/to/aflpp-mcp"
      }
    }
  }
}
```

### Run via stdio

```bash
node dist/index.js
```

### Environment variables

- `AFLPP_MCP_ROOT` (default: current working directory) — all tool paths are
  confined to this directory.
- `AFLPP_DIR` (default: `$AFLPP_MCP_ROOT/AFLplusplus`) — must be inside
  `AFLPP_MCP_ROOT` unless `AFLPP_ALLOW_EXTERNAL_AFL=1`.
- `AFLPP_ALLOW_EXTERNAL_AFL` (default: unset) — allow AFL++ to live outside the
  root, for system installs. See below.
- `AFLPP_LIB_DIR` (default: `$AFLPP_DIR`) — where AFL++'s helper objects live;
  exported as `AFL_PATH`.
- `AFLPP_DOC_DIR` (default: unset) — where AFL++'s markdown docs live, if they
  are not under `$AFLPP_DIR`.
- `AFLPP_MCP_MAX_TOOL_OUTPUT_BYTES` (default: `200000`)
- `AFLPP_MCP_MAX_LOG_BYTES` (default: `5000000`)
- `AFLPP_MCP_DEFAULT_TIMEOUT_MS` (default: `30000`)

### Using a system AFL++ instead of the submodule

By default every path the server touches — including AFL++'s own binaries —
must sit inside `AFLPP_MCP_ROOT`, so a packaged AFL++ in `/usr/bin` is refused.
`AFLPP_ALLOW_EXTERNAL_AFL=1` lifts that restriction **for AFL++'s own binaries
and docs only**. Workspaces, targets, corpora, and every path passed as a tool
argument stay confined either way.

On Debian/Ubuntu (`apt install afl++ afl++-doc`):

```bash
export AFLPP_ALLOW_EXTERNAL_AFL=1
export AFLPP_DIR=/usr/bin
export AFLPP_LIB_DIR=/usr/lib/afl
```

Docs are found automatically in `/usr/share/doc/afl++-doc` (gzipped files are
decompressed transparently); set `AFLPP_DOC_DIR` if your install differs.

Two caveats. Distro packages ship **no dictionaries**, so
`aflpp_list_builtin_dictionaries` returns an empty list with a note — supply
your own via `aflpp_attach_dictionary`. And the packaged version usually trails
the submodule, so `aflpp_version` will report whatever apt installed.

### Development

```bash
npm run check:names    # tool-naming contract
npm run smoke:local    # end-to-end smoke test (needs a compiled AFL++)
npm run dev            # run from source, no build step
```

## How to use

## MCP prompts

- `aflpp-agent-workflow`: high-level end-to-end workflow (build -> corpus -> preflight -> fuzz -> triage).
- `aflpp-harness-workplan`: harness-first workflow (usage -> `LLVMFuzzerTestOneInput` harness -> genesis corpus -> CMPLOG/ASAN/vanilla builds -> launch commands).

## MCP resources

- `aflpp://config`: server configuration (workspace root, limits, allowlist).
- `aflpp://docs/quickstart`: some workflow notes.
- `aflpp://docs/fuzzing_in_depth`:  AFL++'s `fuzzing_in_depth.md`
- `aflpp://docs/cmplog`:  AFL++'s `instrumentation/README.cmplog.md`
- `aflpp://docs/env_variables`: AFL++'s `docs/env_variables.md`
- `aflpp://workspace/{name}/tree`: high-level workspace tree
- `aflpp://job/{job_name}/latest_status`: latest parsed status snapshot for a job
- `aflpp://campaign/{campaign_name}/latest_status`: latest parsed status snapshot for a campaign

## MCP tools

Tool names use underscores (`aflpp_start_fuzz`). MCP clients sanitize tool names
to `/^[a-zA-Z0-9_-]+$/`, so the pre-0.2 dotted spelling (`aflpp.start_fuzz`)
would reach the agent rewritten and no longer match what the server advertises.
Dotted names are still accepted as aliases, so existing Codex configs and saved
scripts keep working.

- aflpp_list_tools: List AFL++ MCP tools and their short descriptions.
- aflpp_help: Get detailed help for a tool (schema + description).
- aflpp_version: Get AFL++ and server version information.
- aflpp_init_workspace: Create a workspace under `workspaces/<name>` with standard subdirectories for inputs, outputs, targets, logs, repros, and reports.
- aflpp_detect_build_system: Detect a likely build system for a project path (heuristic).
- aflpp_build_instrumented: Build a target with AFL++ compiler wrappers (and optional sanitizer profiles + build-time knobs) and store the artifact under the workspace `targets/` directory.
- aflpp_build_cmplog_variant: Build a CMPLOG-instrumented variant (AFL_LLVM_CMPLOG=1) and store the artifact under the workspace `targets/` directory.
- aflpp_import_corpus: Import a seed corpus from a file or directory into `workspaces/<ws>/in/<corpus_name>`.
- aflpp_list_corpus: Summarize a corpus directory (file count and total size).
- aflpp_list_builtin_dictionaries: List AFL++ builtin dictionaries shipped in `AFLplusplus/dictionaries`.
- aflpp_attach_dictionary: Attach a dictionary file to a job name (stored as a job config to be used by `aflpp_start_fuzz`).
- aflpp_dry_run: Run a short harness validation directly against the target (not `afl-fuzz`) to check input mode, stability, timeouts, and basic performance.
- aflpp_showmap: Run `afl-showmap` for a single testcase and return a summary of the trace.
- aflpp_coverage_summary: Measure corpus coverage using `afl-showmap -C` on an AFL++ output directory (best-effort parsing).
- aflpp_analyze_testcase: Run `afl-analyze` on a testcase to identify critical input regions.
- aflpp_preflight_checks: Run lightweight preflight checks before starting `afl-fuzz` (core_pattern, CPU scaling, corpus non-empty).
- aflpp_start_fuzz: Start an `afl-fuzz` job in the workspace (non-blocking; supports common afl-fuzz knobs + allowlisted env overrides).
- aflpp_start_fuzz_cluster: Start a multi-instance `afl-fuzz` campaign (master + secondary instances; supports per-instance overrides).
- aflpp_stop_fuzz: Stop a running `afl-fuzz` job by PID (SIGTERM then SIGKILL).
- aflpp_status: Get job status by parsing `fuzzer_stats` and queue/crashes/hangs counts (with deltas since last call).
- aflpp_campaign_summary: Summarize a multi-instance campaign by parsing `fuzzer_stats` for each instance directory.
- aflpp_whatsup: Run `afl-whatsup` on an AFL++ output directory.
- aflpp_generate_progress_plot: Generate an AFL++ progress plot for a job or campaign (wraps `afl-plot`).
- aflpp_list_findings: List crash and hang findings with stable IDs and paths.
- aflpp_repro_crash: Reproduce a finding by running the target command directly with the testcase and write a repro bundle under `repros/`.
- aflpp_crash_report: Write a crash report for a finding (dedup signature + repro info + sanitizer frames if present).
- aflpp_casr_report: Generate clustered crash reports using `casr-afl` (if installed).
- aflpp_minimize_corpus: Minimize a corpus using `afl-cmin` and store it as a new corpus directory in the workspace.
- aflpp_minimize_testcase: Minimize a single testcase using `afl-tmin` and store the minimized testcase under `repros/`.
- aflpp_suggest_fuzz_cluster_mix: Suggest a multi-core campaign mix (`instance_overrides`) for `aflpp_start_fuzz_cluster`.
