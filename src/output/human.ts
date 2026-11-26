/** Human-readable renderers: compact tables and plain-text topic views. */

import type { DegradationInfo } from "../core/degradation.ts";
import type { Category, Post, Topic, TopicDetail } from "../core/model.ts";
import type { AdapterInfo } from "../core/registry.ts";
import type { Site } from "../core/sites.ts";
import { relativeTime } from "../core/time.ts";
import { color } from "./color.ts";

export interface RenderOptions {
  width?: number;
  groupBySite?: boolean;
}

/** Terminal width, or 0 when output is piped (meaning: never truncate). */
export function terminalWidth(): number {
  if (!process.stdout.isTTY) return 0;
  return process.stdout.columns || 80;
}

function fit(text: string, width: number): string {
  if (width <= 0 || text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function stats(topic: Topic): string {
  const replies = topic.reply_count ?? "-";
  const views = topic.view_count ?? "-";
  return `${replies}/${views}`;
}

function categoryName(topic: Topic): string {
  return topic.category?.name ?? "-";
}

function authorName(topic: Topic): string {
  return topic.author?.username ?? "-";
}

function row(topic: Topic, index: number, width: number, indexWidth: number): string {
  const authorWidth = width > 0 ? Math.min(16, Math.max(8, Math.floor(width * 0.16))) : 0;
  const statsWidth = 11;
  const timeWidth = 9;
  const categoryWidth = width > 0 ? Math.min(18, Math.max(8, Math.floor(width * 0.2))) : 0;

  const fixed = indexWidth + authorWidth + statsWidth + timeWidth + categoryWidth + 10;
  const titleWidth = width > 0 ? Math.max(16, width - fixed) : 0;

  const cells = [
    pad(String(index), indexWidth),
    pad(fit(topic.title, titleWidth), titleWidth || topic.title.length),
    pad(fit(authorName(topic), authorWidth), authorWidth || authorName(topic).length),
    pad(stats(topic), statsWidth),
    pad(relativeTime(topic.last_activity_at || topic.created_at), timeWidth),
    fit(categoryName(topic), categoryWidth),
  ];

  return cells.join("  ").trimEnd();
}

export function renderTopicList(topics: Topic[], options: RenderOptions = {}): string {
  const width = options.width ?? terminalWidth();
  const indexWidth = Math.max(2, String(topics.length).length);
  const lines: string[] = [];

  const header = [
    pad("#", indexWidth),
    "TITLE",
    "AUTHOR",
    "REP/VIEW",
    "TIME",
    "CATEGORY",
  ].join("  ");
  lines.push(color.dim(fit(header, width || header.length)));

  let index = 0;
  let currentSite: string | undefined;
  for (const topic of topics) {
    index += 1;
    if (options.groupBySite && topic.site !== currentSite) {
      currentSite = topic.site;
      if (index > 1) lines.push("");
      lines.push(color.bold(color.cyan(`[${topic.site}]`)));
    }
    lines.push(row(topic, index, width, indexWidth));
  }

  return lines.join("\n");
}

function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line === "") {
        line = word;
      } else if (line.length + 1 + word.length > width) {
        output.push(line);
        line = word;
      } else {
        line += ` ${word}`;
      }
    }
    if (line) output.push(line);
  }
  return output.join("\n");
}

function postHeader(post: Post): string {
  const who = post.author?.username ? `@${post.author.username}` : "@unknown";
  return color.dim(`#${post.floor} ${who} · ${relativeTime(post.created_at)}`);
}

export function renderTopicDetail(detail: TopicDetail, options: RenderOptions = {}): string {
  const width = options.width ?? terminalWidth();
  const lines: string[] = [];

  lines.push(color.bold(detail.title));
  const meta = [
    detail.site,
    detail.category?.name,
    detail.author?.username ? `@${detail.author.username}` : undefined,
    `#${detail.id}`,
  ].filter(Boolean);
  lines.push(color.dim(meta.join(" · ")));
  if (detail.url) lines.push(color.dim(detail.url));
  lines.push("");

  for (const post of detail.posts) {
    lines.push(postHeader(post));
    lines.push(wrapText(post.content_text, width > 0 ? width : 100));
    lines.push("");
  }

  if (detail.truncated) {
    const omitted = detail.omitted_replies ?? 0;
    lines.push(color.yellow(`… ${omitted} repl${omitted === 1 ? "y" : "ies"} omitted (truncated)`));
  }

  return lines.join("\n").trimEnd();
}

export function renderCategories(siteName: string, categories: Category[]): string {
  const width = terminalWidth();
  const lines = [color.bold(color.cyan(`${siteName} categories`))];
  for (const category of categories) {
    const count = category.topic_count !== undefined ? color.dim(`(${category.topic_count})`) : "";
    const description = category.description ? color.dim(` — ${fit(category.description, width > 0 ? width - 30 : 0)}`) : "";
    lines.push(`${category.name} ${count}${description}`);
  }
  return lines.join("\n");
}

export function renderSites(sites: Site[]): string {
  const width = terminalWidth();
  const lines: string[] = [];
  const nameWidth = Math.min(24, Math.max(...sites.map((site) => site.name.length), 4));
  const engineWidth = Math.min(12, Math.max(...sites.map((site) => site.engine.length), 6));
  lines.push(color.dim(`${pad("NAME", nameWidth)}  ${pad("ENGINE", engineWidth)}  ${pad("SOURCE", 9)}  URL / TAGS`));
  for (const site of sites) {
    const url = site.base_url ?? "";
    const tags = site.tags && site.tags.length > 0 ? color.dim(` [${site.tags.join(", ")}]`) : "";
    lines.push(
      `${pad(site.name, nameWidth)}  ${pad(site.engine, engineWidth)}  ${pad(site.source, 9)}  ${fit(url, width > 0 ? width - nameWidth - engineWidth - 20 : 0)}${tags}`,
    );
  }
  return lines.join("\n");
}

function capabilityMark(value: boolean): string {
  return value ? color.green("yes") : color.dim("no");
}

export function renderEngines(infos: AdapterInfo[]): string {
  const engines = infos.map((info) => info.engine);
  const engineWidth = Math.min(12, Math.max(...engines.map((engine) => engine.length), 6));
  const lines = [
    color.dim(
      `${pad("ENGINE", engineWidth)}  HOT  LATEST  PERIOD  TOPIC  SEARCH  CATEGORIES  SOURCE`,
    ),
  ];
  for (const info of infos) {
    const caps = info.capabilities;
    lines.push(
      [
        pad(info.engine, engineWidth),
        pad(capabilityMark(caps.hot), 3),
        pad(capabilityMark(caps.latest), 6),
        pad(capabilityMark(caps.hotPeriods), 6),
        pad(capabilityMark(caps.topic), 5),
        pad(capabilityMark(caps.search), 6),
        pad(capabilityMark(caps.categories), 10),
        info.source,
      ].join("  "),
    );
  }
  return lines.join("\n");
}

export interface DigestTopic extends Topic {
  top_replies?: Post[];
  omitted_replies?: number;
}

export interface DigestGroup {
  site: string;
  topics: DigestTopic[];
  error?: string;
  degraded?: DegradationInfo;
}

export function renderDigest(groups: DigestGroup[], options: RenderOptions = {}): string {
  const width = options.width ?? terminalWidth();
  const lines: string[] = [];
  let index = 0;

  for (const group of groups) {
    if (lines.length > 0) lines.push("");
    lines.push(color.bold(color.cyan(`[${group.site}]`)));
    if (group.error) {
      lines.push(color.yellow(`  ! ${group.error}`));
      if (group.degraded) lines.push(color.yellow(`  ! degraded to ${group.degraded.to} (${group.degraded.limitations.join(", ")})`));
      continue;
    }
    if (group.degraded) {
      lines.push(color.yellow(`  ! degraded to ${group.degraded.to} (${group.degraded.limitations.join(", ")})`));
    }
    if (group.topics.length === 0) {
      lines.push(color.dim("  (no topics in this window)"));
      continue;
    }
    for (const topic of group.topics) {
      index += 1;
      lines.push(`  ${String(index).padStart(2)}. ${color.bold(topic.title)} ${color.dim(stats(topic))}`);
      lines.push(`      ${color.dim(`${authorName(topic)} · ${relativeTime(topic.last_activity_at || topic.created_at)}`)}`);
      if (topic.excerpt) lines.push(wrapText(topic.excerpt, width > 0 ? width - 6 : 0).split("\n").map((line) => `      ${line}`).join("\n"));
      for (const reply of topic.top_replies ?? []) {
        const who = reply.author?.username ? `@${reply.author.username}` : "@unknown";
        const text = (reply.content_text ?? "").replace(/\s+/g, " ").slice(0, 180);
        lines.push(`      ${color.dim(`↳ ${who}:`)} ${text}`);
      }
      if (topic.omitted_replies) lines.push(color.dim(`      … ${topic.omitted_replies} more repl${topic.omitted_replies === 1 ? "y" : "ies"}`));
    }
  }

  return lines.join("\n");
}

export interface DoctorSiteReport {
  name: string;
  engine: string;
  route?: "http" | "browser" | "rss";
  reachable: boolean | "unknown";
  error?: string;
}

export function renderDoctor(report: { sites: DoctorSiteReport[]; engines: string[] }): string {
  const lines: string[] = [color.bold("fora doctor")];
  lines.push(color.dim(`loaded engines: ${report.engines.join(", ") || "(none)"}`));
  lines.push("");
  lines.push(color.dim("SITE                   ENGINE     ROUTE  STATUS"));
  for (const site of report.sites) {
    const status =
      site.reachable === true
        ? color.green("reachable")
        : site.reachable === "unknown"
          ? color.yellow("unknown")
          : color.red("unreachable");
    const suffix = site.error ? color.dim(` — ${site.error}`) : "";
    lines.push(
      `${pad(site.name, 22)} ${pad(site.engine, 10)} ${pad(site.route ?? "-", 6)} ${status}${suffix}`,
    );
  }
  return lines.join("\n");
}
