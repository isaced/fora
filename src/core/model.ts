/**
 * The unified data model that every adapter maps its source into.
 *
 * Fields are normalised across engines: timestamps are UTC RFC 3339,
 * all bodies are plain text, and optional fields are simply omitted when
 * the source does not provide them. Adapters must never invent values.
 */

export interface Author {
  username: string;
  display_name?: string;
  avatar_url?: string;
}

export interface TopicCategory {
  id: string;
  name?: string;
}

/** A thread in a list view. */
export interface Topic {
  id: string;
  site: string;
  title: string;
  url: string;
  source_url?: string;
  author?: Author;
  category?: TopicCategory;
  tags?: string[];
  reply_count?: number;
  view_count?: number;
  like_count?: number;
  created_at: string;
  last_activity_at: string;
  excerpt?: string;
  pinned: boolean;
}

/** One floor inside a topic. */
export interface Post {
  id: string;
  topic_id: string;
  floor: number;
  author?: Author;
  content_text: string;
  content_html?: string;
  created_at: string;
  like_count?: number;
}

/** A topic with its posts and pagination metadata. */
export interface TopicDetail extends Topic {
  posts: Post[];
  post_count: number;
  page: number;
  pages: number;
  /** Set when the adapter knowingly returns fewer posts than the topic holds. */
  truncated?: boolean;
  /** Total replies on the thread, including ones the adapter never fetched. */
  total_replies?: number;
  /** Replies actually fetched by the adapter (may be capped). */
  fetched_replies?: number;
  /** How many replies were left out of `posts`, measured against `total_replies`. */
  omitted_replies?: number;
}

/** A native section concept (V2EX node, Discourse category, Flarum tag). */
export interface Category {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  topic_count?: number;
}
