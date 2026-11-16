# Worker contract

Read this once per fresh worker. The coordinator alone reads the entire plan.

## Dispatch input

Receive one task ID, approved issue URL in `Akshay-VK/quanta-pulse`, base SHA, task packet path, exact file/CSS lease, relevant resolved decisions, frozen interface excerpt, and prerequisite handoffs. Read `AGENTS.md`, this contract, your packet, its named spec sections and its own screen-coverage rows. Open source files lazily from the packet's starting points. Do not read sibling packets, the full gallery HTML, audit reports or earlier transcripts unless a specific missing fact requires one.

Use a fresh context (`fork_turns: none` with native agents) for each task. Target an initial instruction packet of roughly 2–4k tokens, including contracts; this is a practical budget, not a claim about a universal model limit. Load at most a few representative screens initially, then inspect the remaining assigned variants before declaring completion. If context becomes dominated by exploration, send a compact evidence handoff and let the coordinator dispatch the remaining bounded work to a fresh worker.

## Steps

1. Verify base and leases. Read current signatures; record discrepancies before implementation.
2. Enumerate assigned acceptance bullets and state variants. Add a failing test first for new behavior, using existing fixtures. Keep preserved behaviors covered.
3. Implement within assigned ownership. Keep pure policy in `src/lib/`; views emit intents; existing App owners execute shared actions. The frontend invokes Tauri only through `src/lib/api.ts`.
4. Run focused proof, then required gates. Frontend changes require `npm run lint` and `npm test`; accepted integrations also require `npm run build`. Rust changes require `cargo check` from `src-tauri/` and relevant Rust tests. Use temporary data for tests. Report environment failures distinctly from code failures. Do not run the packaged app during development.
5. Rust formatting must stay within the lease: `cargo fmt` traverses the crate even when filenames follow `--`. Use direct `rustfmt --edition 2021 --config skip_children=true` on exact leased files, or report existing formatting drift without rewriting it.
6. Check new documents as well as tracked diffs for trailing whitespace; end Markdown files with exactly one newline. `git diff --check` alone does not inspect untracked files.
7. Review every assigned screen and spec-only acceptance bullet. Produce rendered evidence when asked to implement/verify UI; DOM tests cannot establish pixels, zoom or native behavior. Use deterministic data outside production code.
8. Return the completion record below. Stop at your boundary.

## Shared-file rule

The coordinator assigns a single writer to each file, or explicitly disjoint CSS sections. A candidate file in a packet is a starting point, not an unrestricted lease. If an unleased file needs a change, return the exact interface or proposed patch and the reason; the coordinator applies it or grants a serialized lease. Never overwrite another worker's edits, stage unrelated files, or introduce broad CSS overrides to bypass ownership.

B tasks each change shared command/registration/API/type files: run them serially unless the coordinator assigns those edits to one integrator. `App.tsx`, CSS imports and global hotkeys always have one integration owner. No nested delegation by a worker.

## Completion record (aim under 500 words)

```text
Task / issue / base / resulting commit or patch:
Acceptance: each bullet PASS or BLOCKED, with test/evidence reference.
Changed files:
Contract delta: exact exported names, parameter/return/error semantics; or none.
Commands: exact command → outcome, including unrun required gates and reason.
Evidence: deterministic scenario + viewport/theme/density + artifact path.
Preserved invariants: relevant regressions and outcomes.
Blockers: concrete missing decision/capability, owner, dependent tasks.
Next consumer: only facts needed to use this change.
```

A partial implementation with a missing capability remains blocked; decorative controls, fabricated values, skipped regressions or a screenshot of the design export do not satisfy acceptance.
