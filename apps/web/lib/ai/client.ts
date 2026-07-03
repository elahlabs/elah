import type { TopicOption } from './types'

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

const SYSTEM_PROMPT = `You are a Creative Director for a browser-based AI video editor.

Your job is to transform a user's idea into a complete stock-media production plan using ONLY media that can realistically be found on stock websites like Pixabay or Pexels.

Your goal is NOT to write a story.
Your goal is to create a searchable production plan.

For every user request generate EXACTLY 3 completely different creative concepts.

Each concept should have a different mood, pacing or visual direction.

Examples:
• Cinematic
• Documentary
• Minimal
• Luxury
• Corporate
• Travel
• Emotional
• Fast paced
• Dark
• Futuristic
• Nature
• Vintage
• Cozy
• Motivational

Each concept must contain:

name
- Short memorable title
- 2-4 words

videotags
- 4 search queries
- 1-3 words each
- Extremely common stock-media search terms
- Never poetic
- Never abstract

GOOD
city timelapse
rain street
coffee shop
forest drone
woman typing
ocean waves
mountain sunrise

BAD
hope
dreams
finding yourself
urban loneliness
midnight memories

imagetags
- Same rules as videotags
- 4 search phrases

captions
Exactly 6 captions.

Rules:

Caption 1
Hero sentence
Maximum 5 words

Caption 2
ALL CAPS keyword

Caption 3
Short sentence

Caption 4
ALL CAPS keyword

Caption 5
Short sentence

Caption 6
Stylized ending

Examples:

"Find your calm."
"RAINY NIGHTS"
"The city never sleeps."
"TOKYO"
"Peace exists here."
"— MIDNIGHT ESCAPE —"

The concepts should feel visually different.

Example:

User:
Coffee shop

Concept 1
Warm cozy café

Concept 2
Modern workspace

Concept 3
Luxury espresso lifestyle

Return ONLY valid JSON matching the provided schema.`

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['options'],
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'videotags', 'imagetags', 'captions'],
        properties: {
          name: { type: 'string' },
          videotags: { type: 'array', items: { type: 'string' } },
          imagetags: { type: 'array', items: { type: 'string' } },
          captions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured on the server.')
  }
  return key
}

function cleanList(values: unknown, max: number, maxLen = 60): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max)
}

function sanitizeOptions(raw: unknown): TopicOption[] {
  if (!Array.isArray(raw)) return []
  const out: TopicOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
    const topic = {
      videotags: cleanList(o.videotags, 4),
      imagetags: cleanList(o.imagetags, 4),
      captions: cleanList(o.captions, 6, 80),
    }
    if (!name || !topic.videotags.length || !topic.imagetags.length || !topic.captions.length) continue
    out.push({ name, topic })
  }
  return out.slice(0, 3)
}

export async function generateTopicOptions(
  prompt: string,
  signal?: AbortSignal,
): Promise<TopicOption[]> {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.8,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'topic_options',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`OpenAI request failed with status ${res.status}`)
  }

  const data = await res.json()
  const message = data.choices?.[0]?.message
  if (typeof message?.refusal === 'string' && message.refusal) {
    throw new Error(message.refusal)
  }

  const parsed = JSON.parse(message?.content ?? '{}')
  const options = sanitizeOptions(parsed?.options)
  if (options.length === 0) {
    throw new Error('The model returned no usable options.')
  }
  return options
}
