# OpenRouter API reference (for Cosmion)

The parts of OpenRouter's API that Cosmion uses. Gathered from openrouter.ai's docs on
2026-10-17 and checked against the live API the same day. Items marked **(verify)** are
unclear and must be checked live before a spec depends on them; none are open.

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
| `session_id` | string, max 256 | groups related requests (not used by the CLI) |
| `provider` | object | routing preferences; provider-specific options under `provider.options[provider_slug]` |
| `user` | string | stable end-user id for abuse prevention |

Not every model supports every field. What a model accepts comes from model discovery
(below). Only send fields the chosen model supports.

**Response (200)**

As seen live (2026-10-17), abridged:

```json
{
  "created": 0,
  "data": [{ "b64_json": "<base64 image>", "media_type": "image/jpeg" }],
  "usage": {
    "prompt_tokens": 17, "completion_tokens": 16384, "total_tokens": 16401,
    "cost": 0.04, "is_byok": false,
    "cost_details": { "upstream_inference_cost": 0.04, "...": "..." },
    "completion_tokens_details": { "reasoning_tokens": 0, "image_tokens": 16384 }
  }
}
```

Response headers: `x-generation-id: gen-img-…` and `x-provider-name: Seed`.

- Images come back as **base64** in `data[].b64_json`, with the format in `media_type`
  (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`). Six models across five
  providers (Seed, Black Forest Labs, Google, Recraft, Sourceful) all did this; none
  returned a URL. Cosmion decodes them and writes the file where asked.
- `usage.cost` is the **actual cost in USD**, so it can be recorded in the ledger directly
  without a second request.
- The generation id and the provider that served it are in the **response headers**, not
  the body. `created` was `0`.
- Every image response has token counts, even for per-image models (whose counts mean
  nothing for price).
- With no options, models use their own default size: Seedream 4.5 gave 2048×2048, Gemini
  2.5 Flash Image 1024×1024.
- A model can return a format its `output_format` enum doesn't list: Riverflow v2.5 Fast
  lists only `jpeg` but returned WebP.

## Model discovery

### `GET /images/models`

Lists every image model. No auth required (checked live 2026-10-17, as are the
`endpoints` records).

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

**An absent key means unsupported.** So the CLI accepts an option only when its key is
present, and only the listed values.

## Cost

### What the live catalog looks like (checked 2026-10-17)

61 image models. Priced by their main output line:

| Output pricing | Models | Examples | Price known before generating? |
|----------------|--------|----------|--------------------------------|
| Per image (`unit: image`), sometimes tiered by `variant` | ~32 | Recraft, Seedream, Qwen, Flux 3, Riverflow, Grok Imagine | **Exact** for most: pick the line matching the chosen resolution/quality. But the catalog can be wrong (Riverflow, below) |
| Per megapixel | 4 | Flux.2 (pro, max, flex, klein) | **Not exactly**: Flux.2 has no `resolution` option, so the output size isn't known before generating, and billing isn't linear in megapixels (below) |
| Per token | ~20 | All Google Gemini, OpenAI and Microsoft image models, Tencent | **Not exactly**: the API gives the price per token but not how many tokens an image uses |
| No pricing listed | 5 | Krea models, Meta Muse | No |

Only 4 models have more than one provider, and only 2 of those differ in price (a few
Gemini models, by about 10%).

Variant names aren't standardized (`768`, `1k`, `1.5k`, `2k`, `4k`, `high_resolution`,
`low_1k`, `low_2k`, `medium_1k`, `medium_2k`), so matching a variant to the chosen
settings needs a small mapping.

Also seen in the live catalog (2026-10-17):

- `input_references` is a `range` descriptor giving how many references a model takes
  (e.g. `{ "type": "range", "min": 0, "max": 14 }`).
- `unit: request` exists: Recraft "styles" models charge `input_reference` once per
  request, not per image.
- One provider can list two endpoints at different prices (Gemini 3 Pro Image Preview:
  `google-ai-studio/global` and `google-ai-studio/global/flex`, the second at half
  price), so "several prices" isn't only "several providers".

### Charged vs listed (live generations, 2026-10-17)

| Model | Settings | Listed | Charged | Reading |
|-------|----------|--------|---------|---------|
| Seedream 4.5 | defaults (2048×2048) | $0.04 | $0.04 | Single line: exact |
| Seedream 5 Pro | 1K | $0.045 (no variant), $0.09 (`high_resolution`) | $0.045 | The variant-less line is the base tier |
| Seedream 5 Pro | 2K | same | $0.09 | `high_resolution` = above the lowest resolution |
| Recraft v4.1 Vector | 1:1, SVG | $0.08 | $0.08 | Exact |
| Flux.2 Klein 4B | 1:1 (1024×1024) | $0.014 / megapixel | $0.014 | |
| Flux.2 Klein 4B | 16:9 (1824×1024, 1.87 MP) | $0.014 / megapixel | $0.015 | **Not linear**: probably a first-megapixel price plus a cheaper rate after, which the catalog's single line doesn't show |
| Gemini 2.5 Flash Image | 1:1, run twice | $0.00003 / token | $0.03872 and $0.03870 (1295 and 1290 image tokens) | Token counts stable within 0.5% |
| Riverflow v2.5 Fast | 1K | $0.019 (no variant), $0.021 (`2k`) | $0.031378 | **Catalog wrong** |
| Riverflow v2.5 Fast | 2K | same | $0.031597 | **Catalog wrong** |

So: the variant-less line is the base price when variant lines also exist, and token
counts are stable for a given size. Per-megapixel lines aren't enough to price Flux.2, and
at least one provider charges something other than its listed price. The ledger records
the actual cost, which corrects both (below).

### How Cosmion shows price

- **Per-image models:** the exact price before generating. With variant lines, the line
  matching the chosen resolution (or `<quality>_<resolution>`) applies; a line without a
  variant is the base tier, and `high_resolution` means above the lowest resolution. If
  the last generation with
  the same model and settings was charged a different amount (as Riverflow is), show that
  actual cost instead, as an estimate, with both figures.
- **Per-megapixel models:** the actual cost of the last generation with the same model and
  settings, as an estimate. Before the first one, "price shown after the first image".
- **Several providers at different prices:** show the highest, so the shown price is a
  ceiling ("at most"); the actual is recorded after.
- **Per-token models:** the image itself uses a near-fixed number of tokens per size and
  quality (Gemini 2.5 Flash Image: within 0.5%, checked live 2026-10-17). The ledger
  stores each generation's **token counts** (`usage.prompt_tokens`,
  `usage.completion_tokens`), not just its cost. The price shown = tokens from the last
  generation with the same model and settings × the **current** per-token price from the
  catalog. So a per-token price change is picked up
  automatically. Before the first generation with those settings, it says the price will
  be shown after the first image.
  - The prompt's own tokens vary with its length, but cost a tiny fraction of a cent, so
    they barely move the shown price.
  - If a provider changes how many tokens an image uses, the shown price is off once,
    then corrects itself from the new generation.
- **No per-model code.** Pricing is computed from each line's `unit`, never from the
  model's name, so new models priced in a known unit work automatically.
  - **Unknown `unit`** (one OpenRouter adds later): show "Price not listed" until Cosmion
    supports it. Never guess.
  - **Unknown `variant` name** (can't be matched to the chosen settings): show the
    highest output line as a ceiling ("≤").
- **Keeping prices current:** the model catalog and its pricing are refreshed at least
  daily (the CLI caches it for up to 24 hours), so shown prices reflect current rates.
- **No pricing listed:** "Price not listed"; actual recorded after.
- **Reference images** add their own lines (`input_image`, `input_reference`); include
  them when present. **(verify)** Cosmion assumes they're charged once per request, not
  again for each image when `n` > 1. Unchecked live: it only matters for a model that
  charges per reference image and also allows `n` > 1.
- **After generating:** `usage.cost` in the response is the actual amount charged, and is
  what the ledger stores.

## Account

### `GET /key`: the current key

Returns, inside `data`, `limit` (spending limit or `null`), `limit_remaining`, `limit_reset`, `usage`,
`usage_daily` / `_weekly` / `_monthly`, `is_free_tier`, `label`, `expires_at`. Live
(2026-10-17) it also returns `is_management_key`, `budgets`, `effective_budget`, BYOK
usage fields and more; `label` defaults to a masked form of the key
(e.g. `sk-or-v1-abc...xyz`).

Useful for: checking a key works (`cosmion auth`), and showing remaining budget when the key
has a limit.

### `GET /credits`: account balance

Returns, inside `data` (checked live 2026-10-22, as for `GET /key`), `total_credits` and
`total_usage` (balance = credits − usage). The docs list a
403 "Only management keys can perform this operation", but an ordinary key gets 200
(checked live 2026-10-17). Still unchecked for OAuth-issued keys (relevant once `cosmion auth login` exists).

**A low balance blocks generating before it runs out.** Live, 2026-10-17: with a balance
of $0.52, `POST /images` returned 402 even for a $0.007 image, and nothing was charged.
OpenRouter evidently requires (or holds) more than the image's price; the threshold
isn't documented.

### `GET /generation?id=…`: stats for a past generation

Cost, `generation_time`, `latency`, `provider_name`, token counts. Not needed by the CLI:
`usage.cost` arrives in the response. The id comes in the `x-generation-id` response
header if timing details are ever wanted.

## Sign in: OAuth PKCE

1. Create a random `code_verifier`; `code_challenge` = base64url(SHA-256(verifier)).
2. Open the browser at
   `https://openrouter.ai/auth?callback_url=<url>&code_challenge=<challenge>&code_challenge_method=S256`.
3. The user logs in and approves; OpenRouter redirects to `callback_url?code=…`.
4. `POST /auth/keys` with `{ "code", "code_verifier", "code_challenge_method": "S256" }`
   → `{ "key": "sk-or-v1-…", "user_id": "…" }`. Store the key.

**Localhost callbacks work on any port** (e.g. `http://localhost:51423/callback`), made
for CLI and local apps: `cosmion auth login` (later) can start a temporary local server on
a free port. Such apps get the fixed title `localhost:<port>` on OpenRouter and don't
appear in its rankings; a public callback URL is needed for that.

## Attribution (optional headers)

- `HTTP-Referer`: the project's URL (the landing page or repo).
- `X-OpenRouter-Title` (or `X-Title`): `Cosmion`.

Shows Cosmion on openrouter.ai. The CLI sends the title now and the URL once there is one.

## Errors

Shape: `{ "error": { "code": <int>, "message": "<text>" } }`.

| Code | Meaning | CLI handling (`specs/001-cli` FR-040) |
|------|---------|----------------------------|
| 400 | Invalid parameters | Exit 2 with OpenRouter's message; likely a bug or unsupported option |
| 401 | Missing/invalid key | Exit 3 |
| 402 | Insufficient credits or key limit | Exit 4, saying which (`error.metadata.limit_source`, e.g. `"openrouter_credits"`, seen live 2026-10-17, with a `remedy_hint`) and linking to openrouter.ai/settings/credits |
| 404 | Unknown model/resource | Refresh the catalog; exit 5 |
| 429 | Rate limited | Exit 6, retryable; no automatic retry |
| 500, 502, 529 | Server or provider error | Exit 7, retryable |
| 524 | Timed out | Exit 7, retryable |

## Not used

- Chat completions with `modalities: ["image","text"]`: the older way to generate images.
  The Images API replaces it for Cosmion.
- The official `@openrouter/sdk` TypeScript package exists. Plain `fetch` is enough for
  the handful of endpoints above, avoids a dependency and keeps control over parsing
  (validated with zod). Revisit if the API surface Cosmion uses grows.
