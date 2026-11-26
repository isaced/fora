import { describe, expect, it } from "bun:test";
import { formatCliError, knownSitesSection, missingBaseUrlError, wrapText, wrapValues } from "./error-format.ts";

describe("formatCliError", () => {
  it("separates the headline from indented hint sections", () => {
    expect(
      formatCliError("no site specified", [
        { heading: "Pass a site explicitly:", lines: ["fora hot --site <name>"] },
      ]),
    ).toBe("no site specified\n\n  Pass a site explicitly:\n    fora hot --site <name>");
  });

  it("skips empty sections", () => {
    expect(formatCliError("oops", [{ heading: "Empty:", lines: [] }])).toBe("oops");
  });

  it("wraps long prose without breaking words", () => {
    const message = formatCliError("request failed", [
      { heading: "Reason:", lines: [`request to ${"very-long-host.example".repeat(4)} failed: blocked`] },
    ]);
    expect(message.split("\n").every((line) => line.length <= 92)).toBe(true);
    expect(message).toContain("blocked");
  });
});

describe("wrapValues", () => {
  it("keeps whole values on a line and never exceeds the width", () => {
    const lines = wrapValues(["alpha", "beta", "gamma", "delta"], 12);
    expect(lines.every((line) => line.length <= 12)).toBe(true);
    expect(lines.join(" ")).toContain("alpha, beta");
  });
});

describe("missingBaseUrlError", () => {
  it("explains how to set the URL for regular and RSS sites", () => {
    const regular = missingBaseUrlError("demo");
    expect(regular.split("\n")[0]).toBe('site "demo" has no base_url');
    expect(regular).toContain("base_url: https://example.com");
    expect(missingBaseUrlError("demo", true)).toContain("https://example.com/feed.xml");
  });
});

describe("wrapText", () => {
  it("wraps prose and keeps the requested indent on every line", () => {
    const text = wrapText("one two three four five six seven eight nine ten", 20, "  ");
    expect(text.split("\n").every((line) => line.startsWith("  "))).toBe(true);
    expect(text.split("\n").every((line) => line.length <= 22)).toBe(true);
  });
});

describe("knownSitesSection", () => {
  it("summarises long site lists and stays within a readable width", () => {
    const names = Array.from({ length: 20 }, (_, i) => `site-${i}`);
    const section = knownSitesSection(names);
    expect(section.heading).toBe("Known sites (showing 12 of 20):");
    expect(section.lines.at(-1)).toBe("… and 8 more");
    expect(section.lines.every((line) => line.length <= 76)).toBe(true);
  });
});
