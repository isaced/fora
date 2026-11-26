/**
 * The single central list of built-in engine adapters (SPEC §4).
 */

import type { Adapter } from "./adapter.ts";
import discourse from "../adapters/discourse/index.ts";
import flarum from "../adapters/flarum/index.ts";
import hn from "../adapters/hn/index.ts";
import nodebb from "../adapters/nodebb/index.ts";
import rss from "../adapters/rss/index.ts";
import v2ex from "../adapters/v2ex/index.ts";

export const builtinAdapters: Adapter[] = [discourse, v2ex, hn, flarum, nodebb, rss];
