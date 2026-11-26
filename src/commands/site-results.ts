import { errorMessage, formatCliError } from "../core/error-format.ts";
import { errorCodeOf, exitCodeOf, SiteBatchError, type SiteFailure } from "../core/errors.ts";

export interface SiteOutcome {
  site: string;
  failure?: SiteFailure & { exitCode: number };
}

export function siteFailure(site: string, error: unknown): NonNullable<SiteOutcome["failure"]> {
  return { site, code: errorCodeOf(error), message: errorMessage(error), exitCode: exitCodeOf(error) };
}

export function reportSiteResults(outcomes: SiteOutcome[], warnOnPartialFailure = false): {
  succeeded_sites: string[];
  failed_sites: SiteFailure[];
} {
  const succeeded = outcomes.filter((outcome) => !outcome.failure).map((outcome) => outcome.site);
  const failures = outcomes.flatMap((outcome) => outcome.failure ? [outcome.failure] : []);
  const failed = failures.map(({ site, code, message }) => ({ site, code, message }));
  if (failed.length > 0) {
    const allFailed = succeeded.length === 0;
    const report = formatCliError(allFailed ? `all ${failed.length} site(s) failed` : "some sites failed", [
      { heading: "Failures:", lines: failed.map(({ site, message }) => `${site}: ${message}`) },
    ]);
    if (allFailed) {
      const first = failures[0]!;
      const sameError = failures.every(({ code, exitCode }) => code === first.code && exitCode === first.exitCode);
      throw new SiteBatchError(sameError ? first.code : "generic", report, sameError ? first.exitCode : 1, failed);
    }
    if (warnOnPartialFailure) process.stderr.write(`fora: ${report}\n`);
  }
  return { succeeded_sites: succeeded, failed_sites: failed };
}
