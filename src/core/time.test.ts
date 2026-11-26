import { describe, expect, it } from "bun:test";
import { UsageError } from "./errors.ts";
import { parseDuration, relativeTime, toRfc3339, withinSince } from "./time.ts";

describe("toRfc3339", () => {
  it("normalises unix seconds", () => {
    expect(toRfc3339(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("normalises unix milliseconds", () => {
    expect(toRfc3339(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("normalises ISO strings with offsets", () => {
    expect(toRfc3339("2026-11-26T08:00:00+02:00")).toBe("2026-11-26T06:00:00.000Z");
  });

  it("returns undefined for junk", () => {
    expect(toRfc3339("not a date")).toBeUndefined();
    expect(toRfc3339(undefined)).toBeUndefined();
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);

  it("formats recent times", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
  });
});

describe("parseDuration", () => {
  it("parses common windows", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("24h")).toBe(24 * 3_600_000);
    expect(parseDuration("7d")).toBe(7 * 86_400_000);
    expect(parseDuration("1w")).toBe(7 * 86_400_000);
    expect(parseDuration("1h30m")).toBe(90 * 60_000);
  });

  it("rejects bare numbers and junk", () => {
    expect(() => parseDuration("24")).toThrow(UsageError);
    expect(() => parseDuration("soon")).toThrow(UsageError);
    expect(() => parseDuration("")).toThrow(UsageError);
  });
});

describe("withinSince", () => {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  const recent = new Date(now - 3_600_000).toISOString();
  const old = new Date(now - 48 * 3_600_000).toISOString();

  it("keeps topics active inside the window", () => {
    expect(withinSince(old, recent, 24 * 3_600_000, now)).toBe(true);
    expect(withinSince(recent, recent, 24 * 3_600_000, now)).toBe(true);
    expect(withinSince(old, old, 24 * 3_600_000, now)).toBe(false);
    expect(withinSince(old, old, undefined, now)).toBe(true);
  });
});
