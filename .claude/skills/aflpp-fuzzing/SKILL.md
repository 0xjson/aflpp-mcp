---
name: aflpp-fuzzing
description: Use when fuzzing a C/C++ target with AFL++ through the aflpp MCP server - writing a harness, building instrumented binaries, running a campaign, or triaging crashes. Triggers on "fuzz this", "write a fuzz harness", "run AFL++", "triage these crashes", "why is my fuzzer finding nothing".
---

# AFL++ fuzzing via MCP

Drive the `aflpp` MCP server through a full campaign. Every tool below is
`mcp__aflpp__aflpp_<name>`.

## Ground rules

These are enforced by the server; violating them returns `PATH_OUTSIDE_ROOT`
or `INVALID_ARGUMENT`, not a crash.

- **Every path stays under the workspace root** (`AFLPP_MCP_ROOT`, default: the
  repo root). Pass paths *relative to that root*, not absolute paths from
  elsewhere on the machine. To fuzz code living outside the root, copy it in
  first.
- **`target_cmd[0]` must be a path, not a bare command name.** `["workspaces/x/targets/parse"]`, never `["parse"]`.
- **`aflpp_start_fuzz` is non-blocking.** It returns a PID immediately. Poll
  `aflpp_status`; never wait on it.
- Read `aflpp://docs/fuzzing_in_depth`, `aflpp://docs/cmplog`, and
  `aflpp://docs/env_variables` for AFL++ semantics rather than reciting them
  from memory.

## Workflow

Run `aflpp_version` first. If `aflppVersion` is null the AFL++ submodule is not
checked out — stop and run `git submodule update --init`, then `make -C AFLplusplus`.

### 1. Harness

If the target has no `LLVMFuzzerTestOneInput` entry point, write one before
anything else. Read the callers, tests, and fixtures to learn what real input
looks like. Keep the harness tight and deterministic: no globals carried
between runs, no network, no clock dependence. Add a round-trip or invariant
assertion only when you are certain it holds — a false invariant turns every
run into a fake crash.

The `aflpp-harness-workplan` MCP prompt (`/mcp__aflpp__aflpp-harness-workplan`)
covers this in full. Use it when starting from nothing.

### 2. Workspace and builds

```
aflpp_init_workspace          name
aflpp_detect_build_system     project_path
aflpp_build_instrumented      workspace, target_name, project_path, build_cmd,
                              profile, artifact_relpath
```

`profile` is one of `fast | asan | msan | ubsan | lto`. Build **`fast` first** and
get a campaign running; add the others once the fuzzer is actually making
progress.

- `fast` — the workhorse. Most cores go here.
- `asan` — catches memory errors AFL++ alone misses, at roughly half the
  exec/s. One core is enough.
- `lto` — best coverage fidelity if the project links cleanly with it.

For comparison-heavy parsers (magic bytes, checksums, keyword matching), also
build `aflpp_build_cmplog_variant` and pass its artifact as `cmplog_path` to
`aflpp_start_fuzz`. This is the single highest-leverage option on a target that
plateaus early.

### 3. Corpus

```
aflpp_import_corpus    workspace, src_path, corpus_name
aflpp_list_corpus      workspace, corpus_name
aflpp_minimize_corpus  workspace, corpus_name, target_cmd
```

Seeds should be small, valid, and diverse — a handful of real files beats
thousands of near-duplicates. Minimize before long runs, not after.

### 4. Preflight — do not skip

```
aflpp_dry_run           workspace, target_cmd, corpus_name
aflpp_preflight_checks  workspace, target_cmd, corpus_name
```

`dry_run` executes the target directly, not `afl-fuzz`, so it isolates harness
bugs from fuzzer setup. Fix anything it reports before launching. Stability
below ~90% means the harness is non-deterministic — find the state leaking
between runs rather than fuzzing through it.

`preflight_checks` reads `/proc/sys/kernel/core_pattern` and the CPU governor.
On WSL2 and most containers `core_pattern` cannot be changed without root —
report that to the user and let them decide; do not attempt to `sudo` it.

### 5. Fuzz

Single job:

```
aflpp_start_fuzz  workspace, job_name, target_cmd, corpus_name
                  [cmplog_path, dictionary_paths, mode_preset, fuzz_seconds, ...]
```

Multi-core — ask `aflpp_suggest_fuzz_cluster_mix(instances)` for a mix, then
pass it as `instance_overrides`:

```
aflpp_start_fuzz_cluster  workspace, campaign_name, instances, target_cmd, corpus_name
```

Allocate roughly: one core to the ASAN build, one to CMPLOG, the rest to
`fast`. One instance is the deterministic master, the others secondaries.

Attach a dictionary (`aflpp_list_builtin_dictionaries`, then
`aflpp_attach_dictionary`) whenever the format has keywords or magic bytes.

### 6. Monitor

```
aflpp_status            workspace, job_name        # deltas since last call
aflpp_campaign_summary  workspace, campaign_name
aflpp_whatsup           workspace [job_name|campaign_name]
```

Poll at a human pace — every few minutes, not in a tight loop. Read the numbers
and say what they mean:

| Symptom | Likely cause | Move |
|---|---|---|
| exec/s very low (<100) | heavy harness, no forkserver, large input | shrink the harness, check instrumentation |
| stability <90% | non-deterministic harness | fix shared state before anything else |
| coverage flat, no new paths | comparison wall | CMPLOG variant, or a dictionary |
| crashes climbing fast | one shallow bug, found repeatedly | triage and fix it, then resume |
| `pending_favs` 0 and stable | corpus exhausted for this harness | broaden the harness or add seeds |

### 7. Triage

```
aflpp_list_findings     workspace, job_name        # stable finding_id per crash
aflpp_repro_crash       workspace, job_name, finding_id, target_cmd
aflpp_minimize_testcase workspace, job_name, testcase_path, target_cmd
aflpp_crash_report      workspace, job_name, finding_id
aflpp_casr_report       workspace [job_name]       # clustered, needs casr-afl installed
```

Work unique crashes, not raw counts — AFL++ files many testcases per underlying
bug. `crash_report` emits a dedup signature; group by it first, then minimize
one representative per group. Always minimize before reporting a bug: a 12-byte
reproducer gets fixed, a 40KB one gets ignored.

Reproduce against the ASAN build when you have one — it names the bug class
(heap-overflow, UAF) that the `fast` build only shows as a segfault.

## Reporting back

Tell the user what was found and what it means, not a transcript of tool calls.
A useful summary names the bug class, the minimized input, exec/s and coverage
reached, and the single highest-value next move. If a campaign found nothing,
say so plainly and give the reason (coverage plateau, harness too narrow, seeds
too weak) rather than presenting zero crashes as success.
