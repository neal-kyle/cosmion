# OpenRouter API reference (for Oriel)

The parts of OpenRouter's API that Oriel uses. Gathered from openrouter.ai's docs on
2026-10-17. Items marked **(verify)** were unclear in the docs and must be checked
against the live API before the spec that depends on them is approved.

All endpoints are under `https://openrouter.ai/api/v1` and take
`Authorization: Bearer <key>`. Field names below are as sent over HTTP (snake_case).

---

## Generate an image: `POST /images`

OpenRouter has a dedicated **Images API** with normalized parameters across models. Use
this, not the chat completions endpoint with `modalities: ["image"]`.

**Request body**

| Field | Type | Notes |
|-------|------|-------|
| `model` | string, required | e.g. `bytedance-seed/seedream-4.5` |
| `prompt` | string, required | min length 1 |
| `aspect_ratio` | enum | `1:1`, `1:2`, `1:4`, `1:8`, `2:1`, `2:3`, `2.35:1`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:2`, `5:4`, `5:7`, `7:5`, `8:1`, `9:16`, `16:9`, `9:19.5`, `19.5:9`, `9:20`, `20:9`, `9:21`, `21:9`, `auto` |
| `resolution` | enum | `512`, `768`, `1K`, `2K`, `4K` |
| `quality` | enum | `auto`, `low`, `medium`, `high`, `xhigh`, `max` |
| `background` | enum | `auto`, `transparent`, `opaque` |
| `n` | integer 1–10 | upper bound on number of images |
| `seed` | integer | deterministic sampling |
| `output_format` | enum | `png`, `jpeg`, `webp`, `svg` |
| `output_compression` | integer 0–100 | for webp/jpeg |
| `input_references` | array, max 16 | reference images for image-to-image: `{ "type": "image_url", "image_url": { "url": "<https URL or base64 data URL>" } }` |
| `size` | string | shorthand for dimensions or tier; prefer `aspect_ratio` + `resolution` |
| `stream` | boolean | partial images as SSE events; only providers with native streaming (currently OpenAI), others ignore it |
| `session_id` | string, max 256 | groups related requests: maps naturally to an Oriel thread id |
| `provider` | object | routing preferences; provider-specific options under `provider.options[provider_slug]` |
| `user` | string | stable end-user id for abuse prevention |

Not every model supports every field. What a model accepts comes from model discovery
(below). Only send fields the chosen model supports.

**Response (200)**

```json
{
  "created": 1748372400,
  "data": [{ "b64_json": "<base64 image>" }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 4175, "total_tokens": 4175, "cost": 0.04 }
}
```

- Images come back as **base64** in `data[].b64_json`. Oriel decodes them and writes the
  file: the CLI where asked, the app into its library. **(verify)** whether any providers return a URL instead, and any other
  fields per item.
- `usage.cost` is the **actual cost in USD**, so it can be recorded in the ledger directly
  without a second request.
- **(verify)** whether the response includes a generation `id` (needed only for the
  generation stats endpoint below).

## Model discovery

### `GET /images/models`

Lists every image model. No auth required in the docs' examples.

Per model: `id`, `name`, `description`, `created`,
`architecture.input_modalities` (e.g. `["text","image"]`; `image` means it accepts
reference images), `architecture.output_modalities`, `supported_parameters` (union across
all providers serving the model), `supports_streaming`, and `endpoints` (path to the
per-provider records).

### `GET /images/models/{author}/{slug}/endpoints`

The definitive capabilities and **pricing**, per provider serving the model:

| Field | Meaning |
|-------|---------|
| `provider_name`, `provider_slug`, `provider_tag` | Who serves it; `provider_tag` pins requests to this provider (`null` if not pinnable) |
| `supported_parameters` | What *this* endpoint accepts (subset of the model-level union) |
| `allowed_passthrough_parameters` | Provider-specific keys for `provider.options[provider_slug]` |
| `supports_streaming` | Native SSE streaming |
| `pricing` | List of lines: `billable` (`output_image`, `input_image`, `input_reference`, `input_text`, `input_font`), `unit` (`image`, `megapixel`, `token`, `request`), `cost_usd`, optional `variant` (a tier, e.g. `1k`, `2k`, `4k`, `high_resolution`, `low_1k`, `medium_2k`) |

### Capability descriptors (`supported_parameters`)

| Type | Shape | Meaning |
|------|-------|---------|
| `enum` | `{ "type": "enum", "values": ["1K","2K","4K"] }` | allowed values |
| `range` | `{ "type": "range", "min": 0, "max": 100 }` | any integer in range |
| `boolean` | `{ "type": "boolean" }` | supported |

**An absent key means unsupported.** This is exactly what the prompt box needs: show a
control only when its key is present, and offer only the listed values.

## Cost

### What the live catalog looks like (checked 2026-10-17)

61 image models. Priced by their main output line:

| Output pricing | Models | Examples | Price known before generating? |
|----------------|--------|----------|--------------------------------|
| Per image (`unit: image`), sometimes tiered by `variant` | ~32 | Recraft, Seedream, Qwen, Flux 3, Riverflow, Grok Imagine | **Exact**: pick the line matching the chosen resolution/quality |
| Per megapixel | 4 | Flux.2 (pro, max, flex, klein) | **Exact**, computed from the output dimensions (resolution × aspect ratio) |
| Per token | ~20 | All Google Gemini, OpenAI and Microsoft image models, Tencent | **Not exactly**: the API gives the price per token but not how many tokens an image uses |
| No pricing listed | 5 | Krea models, Meta Muse | No |

Only 4 models have more than one provider, and only 2 of those differ in price (a few
Gemini models, by about 10%).

Variant names aren't standardized (`1k`, `2k`, `high_resolution`, `low_1k`,
`medium_2k`), so matching a variant to the chosen settings needs a small mapping.
**(verify)** how the provider applies the line without a variant when variant lines also
exist (e.g. Seedream 5 Pro).

### How Oriel shows price

- **Per-image and per-megapixel models:** the exact price before generating.
- **Several providers at different prices:** show the highest, so the shown price is a
  ceiling ("at most"); the actual is recorded after.
- **Per-token models:** the image itself uses a fixed number of tokens per size and
  quality **(verify per provider)**. Each product's history (the CLI's ledger, the app's
  library) stores each generation's **token counts** (`usage.prompt_tokens`,
  `usage.completion_tokens`), not just its cost. The price shown = tokens from the last
  generation with the same model and settings × the **current** per-token price from the
  catalog. So a per-token price change is picked up
  automatically. Before the first generation with those settings, it says the price will
  be shown after the first image.
  - The prompt's own tokens vary with its length, but cost a tiny fraction of a cent, so
    the displayed price (rounded to the cent) doesn't move.
  - If a provider changes how many tokens an image uses, the shown price is off once,
    then corrects itself from the new generation.
- **No per-model code.** Pricing is computed from each line's `unit`, never from the
  model's name, so new models priced in a known unit work automatically.
  - **Unknown `unit`** (one OpenRouter adds later): show "Price not listed" until Oriel
    supports it. Never guess.
  - **Unknown `variant` name** (can't be matched to the chosen settings): show the
    highest output line as a ceiling ("≤").
- **Keeping prices current:** the model catalog and its pricing are refreshed at least
  daily (the CLI caches it for up to 24 hours; the app refreshes on launch and daily), so
  shown prices reflect current rates.
- **No pricing listed:** "Price not listed"; actual recorded after.
- **Reference images** add their own lines (`input_image`, `input_reference`); include
  them when present.
- **After generating:** `usage.cost` in the response is the actual amount charged, and is
  what the CLI's ledger and the app's library store.

## Account

### `GET /key`: the current key

Returns `limit` (spending limit or `null`), `limit_remaining`, `limit_reset`, `usage`,
`usage_daily` / `_weekly` / `_monthly`, `is_free_tier`, `label`, `expires_at`.

Useful for: checking a key works (`oriel auth`), and showing remaining budget when the key
has a limit.

### `GET /credits`: account balance

Returns `total_credits` and `total_usage` (balance = credits − usage). **(verify)** The
docs list a 403 "Only management keys can perform this operation" for this endpoint. If
ordinary or OAuth-issued keys can't call it, show the key's `limit_remaining` instead,
or no balance.

### `GET /generation?id=…`: stats for a past generation

Cost, `generation_time`, `latency`, `provider_name`, token counts. Probably unnecessary
since `usage.cost` arrives in the response; possibly useful for provider and timing in
the image details panel, if the images response includes an `id`.

## Sign in: OAuth PKCE

1. Create a random `code_verifier`; `code_challenge` = base64url(SHA-256(verifier)).
2. Open the browser at
   `https://openrouter.ai/auth?callback_url=<url>&code_challenge=<challenge>&code_challenge_method=S256`.
3. The user logs in and approves; OpenRouter redirects to `callback_url?code=…`.
4. `POST /auth/keys` with `{ "code", "code_verifier", "code_challenge_method": "S256" }`
   → `{ "key": "sk-or-v1-…", "user_id": "…" }`. Store the key.

**Localhost callbacks work on any port** (e.g. `http://localhost:51423/callback`), made
for CLI and local apps: the app and CLI can start a temporary local server on a free
port. Such apps get the fixed title `localhost:<port>` on OpenRouter and don't appear in
its rankings; a public callback URL is needed for that (not a concern for v0.1).

## App attribution (optional headers)

- `HTTP-Referer`: app URL (e.g. the landing page or repo).
- `X-OpenRouter-Title` (or `X-Title`): `Oriel`.

Shows the app on openrouter.ai. Send from both the app and the CLI once there's a URL.

## Errors

Shape: `{ "error": { "code": <int>, "message": "<text>" } }`.

| Code | Meaning | Oriel's handling (to spec) |
|------|---------|----------------------------|
| 400 | Invalid parameters | Show message; likely a bug or unsupported option |
| 401 | Missing/invalid key | Prompt to sign in again; CLI exit code for auth failure |
| 402 | Insufficient credits | Link to openrouter.ai/credits |
| 404 | Unknown model/resource | Model removed: refresh catalog |
| 429 | Rate limited | Wait and retry, or tell the user |
| 500, 502, 529 | Server or provider error | Retryable; tell the user |
| 524 | Timed out | Retryable |

## Not used

- Chat completions with `modalities: ["image","text"]`: the older way to generate images.
  The Images API replaces it for Oriel.
- The official `@openrouter/sdk` TypeScript package exists. Plain `fetch` is enough for
  the handful of endpoints above, avoids a dependency and keeps control over parsing
  (validated with zod). Revisit if the API surface Oriel uses grows.
