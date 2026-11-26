import { describe, expect, it } from "bun:test";
import { decodeEntities, excerptOf, htmlToText, truncate } from "./html.ts";

describe("htmlToText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToText("<p>Hello &amp; <b>world</b></p>")).toBe("Hello & world");
  });

  it("turns block boundaries into newlines", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\ntwo");
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });

  it("decodes numeric and hex entities", () => {
    expect(decodeEntities("&#39;&#x2F;&nbsp;")).toBe("'/ ");
  });

  it("drops script and style content", () => {
    expect(htmlToText("<style>x{}</style><script>alert(1)</script>ok")).toBe("ok");
  });

  it("returns empty for empty input", () => {
    expect(htmlToText(undefined)).toBe("");
  });
});

describe("excerptOf", () => {
  it("collapses whitespace and caps length with an ellipsis", () => {
    const text = excerptOf("<p>a   b</p><p>c</p>", 3);
    expect(text).toBe("a b…");
  });
});

describe("truncate", () => {
  it("adds an ellipsis when too long", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("ab", 4)).toBe("ab");
    expect(truncate("abc", 0)).toBe("");
  });
});
