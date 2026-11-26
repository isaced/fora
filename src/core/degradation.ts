/** Runtime transport downgrade info, reported to agents in command output. */

export interface DegradationInfo {
  site: string;
  from: string;
  to: string;
  reason: string;
  limitations: string[];
}

export type DegradationStore = Map<string, DegradationInfo>;

export function degradedSites(store: DegradationStore | undefined, names: readonly string[]): DegradationInfo[] {
  if (!store) return [];
  return names
    .map((name) => store.get(name))
    .filter((info): info is DegradationInfo => Boolean(info));
}

/** JSON metadata attached to list/digest payloads when a fallback was used. */
export function degradationMeta(infos: DegradationInfo[]): Record<string, unknown> {
  if (infos.length === 0) return {};
  return {
    degraded_sites: infos.map(({ site, from, to, reason, limitations }) => ({
      site,
      from,
      to,
      reason,
      limitations,
    })),
  };
}

/** One-line human warning for a degraded site. */
export function formatDegradation(info: DegradationInfo): string {
  return `${info.site}: fell back to ${info.to} (${info.limitations.join(", ")}); ${info.reason}`;
}
