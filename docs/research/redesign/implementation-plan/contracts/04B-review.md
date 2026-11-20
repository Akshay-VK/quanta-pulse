# 04B review

**No blocking defects found** in the scoped policy against task 04B and its handoff.

The implementation preserves separate `focus`, `inspect`, selection, read-state, delete-confirmation, preview, and captured-scope intents. Focus movement does not inspect; read and delete actions use visible selected IDs when available and otherwise the focused row. Empty-list and clamped-edge movement, missing-focus edge starts, and next/previous/first recovery match the contract.

All stated event guards are checked before key mapping, including inactive surface, editable and nested controls, modal, composition and legacy 229, repeat, and already-prevented events. Only Shift+A permits a modifier combination; immutable captured scope copies the authoritative `readonly number[]`, matching the corrected backend numeric event-ID contract. Action ID arrays are also copied from caller-owned selection data.

**Integration hazards / contract notes:** 04C must compute `nestedControl` correctly so native controls retain their own keyboard activation, and supply complete authoritative event IDs rather than visible/paged IDs for Shift+A. The policy accepts caller-provided `editableTarget` and `modalOpen`; incorrect owner flags cannot be detected here. `inspectedId` is intentionally not consulted by this stateless resolver.

**Proof limits:** review is limited to the requested policy, tests, task and handoff. No DOM or component integration proof was performed; no broad test run was requested or run.
