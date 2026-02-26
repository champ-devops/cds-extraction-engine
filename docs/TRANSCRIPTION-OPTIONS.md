# Transcription Options Reference

Options passed to the `POST /ingest/transcribe-media` endpoint under the `options` object.

---

## General Options

| Field | Type | Default | Description |
|---|---|---|---|
| `isDiarizationEnabled` | boolean | `true` | Enable speaker diarization (label separation). Alias: `speakerLabels`. |
| `speakerLabels` | boolean | `true` | Alias for `isDiarizationEnabled`. |
| `punctuate` | boolean | `true` | Add punctuation to the transcript. |
| `languageCode` | string | `'en'` | BCP-47 language code. AssemblyAI uses `en_us` format; the value is passed through as-is. |
| `model` | string | provider default | Provider model name (e.g., `nova-3` for Deepgram, `slam-1` for AssemblyAI). |

---

## Speaker Count Hints

| Field | Type | Description |
|---|---|---|
| `speakerCountExpected` | number | Exact expected speaker count. Takes precedence over min/max. |
| `speakerCountMin` | number | Minimum expected speaker count. |
| `speakerCountMax` | number | Maximum expected speaker count. |

**Provider support:**

| Provider | `speakerCountExpected` | `speakerCountMin` / `speakerCountMax` |
|---|---|---|
| AssemblyAI | `speakers_expected` | `speaker_options.min_speakers_expected` / `max_speakers_expected` |
| Deepgram | Ignored — emits `DEEPGRAM_IGNORED_SPEAKER_COUNT_HINTS` | Ignored |
| Rev.ai | Ignored — emits `REVAI_IGNORED_SPEAKER_COUNT_HINTS` | Ignored |

---

## Chunking Options

| Field | Type | Default | Description |
|---|---|---|---|
| `isChunkingEnabled` | boolean | `false` | Split audio on silence boundaries before submitting to provider. |
| `silenceNoiseDB` | number | `-35` | Silence detection threshold in dB (e.g., `-35`). |
| `silenceMinSecs` | number | `2` | Minimum silence duration in seconds to consider a split point. |
| `maxSegmentCount` | number | — | Fail the request if more than this many chunks are detected. |

---

## Vocabulary Hints

These fields let you supply domain-specific terms that the provider should favour during transcription.

### `keyTerms`

**Type:** `string[]`

An array of words or short phrases to hint to the provider. Terms are deduplicated and stripped of leading/trailing whitespace before being forwarded.

**Provider behaviour:**

| Provider | Model condition | API field | Limits | Warning(s) emitted |
|---|---|---|---|---|
| AssemblyAI | `slam-1` (default) | `keyterms_prompt` | Max 100 terms | `ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100` if >100 |
| AssemblyAI | any other model | `word_boost` | No documented cap | `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK` (informational) |
| Deepgram | `nova-3` or `flux` | `keyterm` query param (repeated) | Max 100 terms; each term ≤100 chars | `DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED`, `DEEPGRAM_KEY_TERMS_TRUNCATED_TO_100` |
| Deepgram | any other model | Not forwarded | — | `DEEPGRAM_KEY_TERMS_UNSUPPORTED_FOR_MODEL` |
| Rev.ai | all | `custom_vocabularies` (multipart JSON) | Each phrase ≤255 chars | `REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED`, `REVAI_IGNORED_KEY_TERMS` (if all filtered) |

### `hintBoostParam`

**Type:** `'low' | 'default' | 'high'`

Controls the boost intensity of AssemblyAI's `word_boost` feature. Only applies when using a **non-SLAM-1** model with `keyTerms` set. Deepgram and Rev.ai ignore this field.

- `'low'` — Subtle boost; less likely to force incorrect recognition.
- `'default'` — Standard boost (same as omitting the field).
- `'high'` — Aggressive boost; increases the chance terms are recognized but may introduce errors.

If an unrecognized value is supplied, the field is ignored and the warning `ASSEMBLYAI_INVALID_HINT_BOOST_PARAM` is emitted.

---

## Warning Code Reference

| Code | Provider | Meaning |
|---|---|---|
| `ASSEMBLYAI_KEY_TERMS_TRUNCATED_TO_100` | AssemblyAI | More than 100 terms supplied for SLAM-1; only the first 100 were sent. |
| `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK` | AssemblyAI | Non-SLAM-1 model detected; terms were sent via `word_boost` instead of `keyterms_prompt`. |
| `ASSEMBLYAI_INVALID_HINT_BOOST_PARAM` | AssemblyAI | `hintBoostParam` value is not `'low'`, `'default'`, or `'high'`; it was ignored. |
| `ASSEMBLYAI_IGNORED_SPEAKER_RANGE_WHEN_EXPECTED_SET` | AssemblyAI | `speakerCountExpected` was set, so min/max range was ignored. |
| `ASSEMBLYAI_SWAPPED_INVALID_SPEAKER_RANGE` | AssemblyAI | `speakerCountMin` was greater than `speakerCountMax`; values were swapped. |
| `DEEPGRAM_IGNORED_SPEAKER_COUNT_HINTS` | Deepgram | Speaker count hints are not supported by Deepgram; they were ignored. |
| `DEEPGRAM_KEY_TERMS_UNSUPPORTED_FOR_MODEL` | Deepgram | The selected Deepgram model does not support `keyterm`; terms were ignored. |
| `DEEPGRAM_KEY_TERMS_TOO_LONG_FILTERED` | Deepgram | One or more terms exceeded 100 characters and were removed. |
| `DEEPGRAM_KEY_TERMS_TRUNCATED_TO_100` | Deepgram | More than 100 terms supplied after length filtering; only the first 100 were sent. |
| `REVAI_IGNORED_SPEAKER_COUNT_HINTS` | Rev.ai | Speaker count hints are not supported by Rev.ai; they were ignored. |
| `REVAI_IGNORED_MODEL` | Rev.ai | Model selection is not supported by Rev.ai; it was ignored. |
| `REVAI_KEY_TERM_PHRASE_TOO_LONG_FILTERED` | Rev.ai | One or more phrases exceeded 255 characters and were removed. |
| `REVAI_IGNORED_KEY_TERMS` | Rev.ai | All supplied key terms were filtered out (all exceeded 255 chars); no vocabulary was sent. |

---

## Examples

### AssemblyAI — SLAM-1 with key terms

```json
{
  "provider": "ASSEMBLYAI",
  "options": {
    "keyTerms": ["city council", "bylaw 4231", "rezoning"]
  }
}
```

Terms are sent as `keyterms_prompt` to the SLAM-1 model.

---

### AssemblyAI — Non-SLAM-1 with word_boost

```json
{
  "provider": "ASSEMBLYAI",
  "options": {
    "model": "best",
    "keyTerms": ["Nguyen", "Kowalczyk", "Okonkwo"],
    "hintBoostParam": "high"
  }
}
```

Terms are sent via `word_boost` with `boost_param: "high"`. Warning `ASSEMBLYAI_KEY_TERMS_USING_WORD_BOOST_FALLBACK` is included in the response.

---

### Deepgram — nova-3 with key terms

```json
{
  "provider": "DEEPGRAM",
  "options": {
    "model": "nova-3",
    "keyTerms": ["alderman", "quorum", "subdivision"]
  }
}
```

Each term becomes a `keyterm=...` query parameter on the Deepgram `/listen` request.

---

### Rev.ai — custom vocabulary

```json
{
  "provider": "REVAI",
  "options": {
    "keyTerms": ["Kowalczyk", "SEPA", "traffic impact analysis"]
  }
}
```

Terms are submitted as `custom_vocabularies: [{ "phrases": [...] }]` in the multipart form body.
