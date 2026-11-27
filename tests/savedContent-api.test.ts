import { expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { api } from "../src/lib/api";

it("sends literal parsed terms and exposes the native saved-text lifecycle", async () => {
  const response = {
    state: "ready", indexed: 1, skipped: 0,
    hits: [{ resourceId: 42, snippet: "<literal> residual variance" }],
  };
  invoke.mockResolvedValueOnce(response).mockResolvedValueOnce(response).mockResolvedValueOnce(undefined);
  await expect(api.searchSavedContent(["residual variance", "A \" B"])).resolves.toEqual(response);
  await expect(api.rebuildSavedContent()).resolves.toEqual(response);
  await api.cancelSavedContentRebuild();
  expect(invoke.mock.calls).toEqual([
    ["search_saved_content", { terms: ["residual variance", "A \" B"] }],
    ["rebuild_saved_content"],
    ["cancel_saved_content_rebuild"],
  ]);
});
