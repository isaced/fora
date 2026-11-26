/** Render an error message consistently for CLI-level fallbacks. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Shared layout for readable, multi-line CLI errors. */

export interface ErrorSection {
  heading?: string;
  lines: string[];
}

/** Wrap prose at word boundaries, keeping any existing indentation. */
export function wrapText(text: string, width = 88, indent = ""): string {
  return wrapLine(`${indent}${text}`, width + indent.length).join("\n");
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const words = line.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(`${indent}${current}`);
      current = word;
    }
  }
  if (current) lines.push(`${indent}${current}`);
  return lines;
}

/**
 * Turn a short headline plus grouped hints into an indented block:
 *
 *   headline
 *
 *     Heading:
 *       detail
 */
export function formatCliError(title: string, sections: ErrorSection[] = []): string {
  const blocks = [title];
  for (const section of sections) {
    const lines = section.lines.filter((line) => line.length > 0).flatMap((line) => wrapLine(line, 88));
    if (lines.length === 0) continue;
    blocks.push("");
    if (section.heading) blocks.push(`  ${section.heading}`);
    blocks.push(...lines.map((line) => `    ${line}`));
  }
  return blocks.join("\n");
}

/** Wrap a comma-separated list so long value lists stay scannable. */
export function wrapValues(values: string[], maxWidth = 76): string[] {
  const lines: string[] = [];
  let current = "";
  for (const value of values) {
    const candidate = current ? `${current}, ${value}` : value;
    if (current && candidate.length > maxWidth) {
      lines.push(`${current},`);
      current = value;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Readable guidance for a site that is missing its URL in config. */
export function missingBaseUrlError(name: string, feed = false): string {
  return formatCliError(
    feed ? `RSS site "${name}" needs base_url set to the feed URL` : `site "${name}" has no base_url`,
    [
      {
        heading: "Set it in config:",
        lines: [`base_url: ${feed ? "https://example.com/feed.xml" : "https://example.com"}   # ${name}`],
      },
      { heading: "Inspect sites:", lines: ["fora sites list"] },
    ],
  );
}

/** A consistently formatted "known sites" section for site errors. */
export function knownSitesSection(names: string[]): ErrorSection {
  const shown = names.slice(0, 12);
  const lines = wrapValues(shown);
  if (names.length > shown.length) lines.push(`… and ${names.length - shown.length} more`);
  return {
    heading:
      names.length > shown.length
        ? `Known sites (showing ${shown.length} of ${names.length}):`
        : "Known sites:",
    lines,
  };
}
