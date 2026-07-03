/**
 * Shared shapes for the Agentic AI topic generator (app/api/ai/*).
 *
 * `GeneratedTopic` mirrors the curated `PIXABAY_TOPICS` entries in the
 * production playground: search tags for the Pixabay proxies plus caption
 * copy for the text lanes. The LLM produces these; the existing
 * `loadPixabayTopic` pipeline consumes them unchanged.
 */

export interface GeneratedTopic {
  videotags: string[]
  imagetags: string[]
  captions: string[]
}

/** One creative direction offered to the user. */
export interface TopicOption {
  /** Short 2–4 word title, e.g. "Neon Nights". */
  name: string
  topic: GeneratedTopic
}

/** Response body of POST /api/ai/topics. */
export interface TopicOptionsResponse {
  options: TopicOption[]
}
