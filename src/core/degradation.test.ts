import { describe, expect, it } from "bun:test";
import { degradationMeta, degradedSites, formatDegradation, type DegradationStore } from "./degradation.ts";

const info = {
  site: "linuxdo",
  from: "discourse",
  to: "discourse-rss",
  reason: "challenge",
  limitations: ["no search"],
};

describe("degradation reporting", () => {
  it("selects only degraded sites that were queried", () => {
    const store: DegradationStore = new Map([["linuxdo", info], ["other", { ...info, site: "other" }]]);
    expect(degradedSites(store, ["linuxdo", "v2ex"])).toEqual([info]);
  });

  it("emits JSON metadata and a readable human warning", () => {
    expect(degradationMeta([info])).toEqual({
      degraded_sites: [info],
    });
    expect(formatDegradation(info)).toContain("linuxdo: fell back to discourse-rss (no search)");
  });

  it("omits metadata when nothing degraded", () => {
    expect(degradationMeta([])).toEqual({});
  });
});
