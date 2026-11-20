import { describe, expect, it } from "vitest";
import { materialActions, rankMaterialMatches } from "../src/lib/materialActions";
import { resource } from "./helpers/data";

describe("shared material action policy", () => {
  it("keeps source availability and saved copy independent", () => {
    const item = resource({ availabilityStatus: "unavailable" });
    const actions = materialActions(item, { preview: true, local: "saved" });
    expect(actions.map((action) => action.id)).toEqual(["preview", "open-saved", "open-quanta"]);
    expect(materialActions(item, { preview: true, local: "missing" }).map((a) => a.id))
      .toEqual(["preview", "download-open", "open-quanta"]);
  });

  it("does not offer local operations for external links or fabricate orphan resources", () => {
    expect(materialActions(resource({ isExternal: true }), { preview: true, local: "missing" })
      .map((action) => action.id)).toEqual(["open-quanta"]);
    expect(materialActions(null, { recordedUrl: "https://quanta.bits-pilani.ac.in/file/7" }, true)
      .map((action) => action.id)).toEqual(["open-quanta"]);
  });

  it("ranks exact, prefix, then substring metadata matches deterministically", () => {
    const items = [resource({ id: 3, title: "Week 4 lecture" }), resource({ id: 2, title: "Lecture 4" }), resource({ id: 1, title: "Lecture notes" })];
    expect(rankMaterialMatches(items, "lecture").map((item) => item.id)).toEqual([2, 1, 3]);
  });
});

it("rejects unsafe sources while retaining independently saved files", () => {
  const item = resource({ url: "javascript:alert(1)", sourcePageUrl: "file:///private" });
  expect(materialActions(item, { preview: true, local: "missing" })).toEqual([]);
  expect(materialActions(item, { local: "saved" }).map((a) => a.id)).toEqual(["open-saved"]);
});

it("does not download off-origin links even when old metadata lacks the external flag", () => {
  expect(materialActions(resource({ url: "https://example.com/file.pdf", sourcePageUrl: null }), { preview: true, local: "missing" })
    .map((a) => a.id)).toEqual(["open-quanta"]);
});

it("retains both recorded orphan destinations and falls back from an invalid page", () => {
  expect(materialActions(null, { recordedUrl: "https://quanta.bits-pilani.ac.in/page", recordedFileUrl: "https://quanta.bits-pilani.ac.in/old.pdf" }, true).map((a) => a.id))
    .toEqual(["open-quanta", "open-recorded-file"]);
  expect(materialActions(null, { recordedUrl: "javascript:void(0)", recordedFileUrl: "https://quanta.bits-pilani.ac.in/old.pdf" }, true).map((a) => a.id)).toEqual(["open-quanta"]);
});
