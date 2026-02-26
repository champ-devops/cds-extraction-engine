# Plan: AI-Powered Agenda-to-Timestamp Interpolation

## Overview

This document outlines the approach for using AI models to automatically generate Timeline entries (timestamps) that link Agenda Items to specific moments in the meeting media. The goal is to minimize manual effort while preserving a human review path for low-confidence or ambiguous matches.

**Process Flow Reference:** Step 4 in README.md
> Use agenda items + utterances to synthesize suggested agenda timestamps (AI-assisted).

---

## Problem Statement

Given:
1. **Transcript Utterances**: Timed speech segments from the meeting (speaker, text, startMS, endMS)
2. **Agenda Items**: Hierarchical list of agenda items with titles and descriptions

Produce:
- **Timeline Entries**: Mapping each agenda item to its start/end time in the media
- **Revision-Aware Results**: Timeline linked to the transcript revision used for generation

### Challenges
- Agenda items may be **out of order** during the actual meeting
- Agenda items may be **revisited** multiple times
- Some agenda items may be **skipped** or only briefly mentioned
- Speakers almost always explicitly announce agenda item transitions, however this is not guaranteed
- **Parent/child relationships are for GROUPING only** - children are independent agenda items that can be discussed at any time, not necessarily within or adjacent to the parent's time range
- A parent item (e.g., "PUBLIC HEARING") may just be a section header with a brief announcement, while its children are discussed at completely different times in the meeting
- Some parents are exclusive for the grouping, such as Consent Agenda.  This is a special type that encompasses all items within.  

---

## Data Structures

### Input: Agenda Items (from PlayAPI)

```json
{
  "CustomerAgendaItemID": 29346,
  "Title": "Call Regular Meeting to Order",
  "Description": "",
  "OrderParentID": 0,
  "OrderOrdinal": 0,
  "Children": []
}
```

Key fields:
- `CustomerAgendaItemID` - Unique identifier (used as `ContainerID` in Timeline)
- `Title` - The agenda item title (primary match target)
- `Description` - Additional context (may contain names, topics)
- `OrderParentID` - 0 for top-level, parent ID for children
- `Children` - Nested agenda items

### Input: Transcript Utterances (from CoreAPI)

```json
{
  "_id": "01ABC...",
  "speakerOriginal": "A",
  "textOriginal": "Let's move on to the approval of the agenda.",
  "startMS": 60000,
  "endMS": 63500,
  "segmentIndex": 12
}
```

### Output: Timeline Entries (to CoreAPI)

```json
{
  "ContainerTypeID": 2,
  "ContainerID": 29352,
  "Title": "",
  "startMS": 60000,
  "endMS": 75000,
  "confidence": 0.92,
  "TimeTypeID": 1
}
```

Key fields:
- `ContainerTypeID` - Always `2` for agenda item links
- `ContainerID` - The `CustomerAgendaItemID` being linked
- `startMS` / `endMS` - Time range in the media (milliseconds, consistent with utterances)
- `confidence` - AI confidence score (0-1) for this timestamp match; null if human-generated
- `TimeTypeID` - Always `1` for standard timestamps

> **Note**: The legacy PlayAPI uses `TimeStartSeconds`/`TimeEndSeconds`. When syncing to PlayAPI, convert by dividing by 1000.

---

## AI Model Requirements

### Provider Agnostic Design

The system should support multiple AI providers:
- OpenAI GPT-4 / GPT-4o
- Anthropic Claude 3.5 / Claude 4
- DeepSeek
- Kimi (Moonshot)
- Google Gemini
- Local models (Ollama, etc.)

### Implementation Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Interpolation Service                 │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │   Prompt    │    │   Provider   │    │   Response    │   │
│  │  Builder    │───>│   Adapter    │───>│    Parser     │   │
│  └─────────────┘    └──────────────┘    └───────────────┘   │
│         │                  │                    │           │
│         v                  v                    v           │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │  Agenda +   │    │  OpenAI      │    │  Structured   │   │
│  │  Utterances │    │  Claude      │    │  Timeline     │   │
│  │  + Context  │    │  DeepSeek    │    │  Output       │   │
│  │             │    │  Kimi        │    │               │   │
│  │             │    │  Gemini      │    │               │   │
│  │             │    │  Local       │    │               │   │
│  └─────────────┘    └──────────────┘    └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Prompt Strategy

### System Prompt

```
You are an expert at analyzing meeting transcripts and identifying when specific 
agenda items are being discussed. Your task is to match agenda items to their 
corresponding time segments in the transcript.

Rules:
1. Each agenda item should have ONE primary time range (when it's actively discussed)
2. If an item is revisited, use the FIRST substantive discussion
3. Parent/child relationships are for GROUPING only - treat each item independently
   - A parent (e.g., "PUBLIC HEARING") gets its own timestamp when announced
   - Children get their own separate timestamps when discussed
   - Children do NOT need to fall within the parent's time range
4. Brief mentions or procedural references don't count as "discussing" an item
5. Some items may have no corresponding discussion - return null for those
6. All times are in MILLISECONDS (both input utterances and output timestamps)
7. Timeline results must include transcript revision metadata so stale results can be detected after transcript edits
```

### User Prompt Template

```
## AGENDA ITEMS

{agenda_items_json}

## TRANSCRIPT UTTERANCES

{utterances_json}

## TASK

For each agenda item, identify when it is being discussed in the transcript.
Return a JSON array with the following structure:

```json
[
  {
    "agendaItemID": 29346,
    "agendaTitle": "Call Regular Meeting to Order",
    "startMS": 0,
    "endMS": 5000,
    "confidence": 0.95,
    "matchedUtterances": [0, 1],
    "reasoning": "Speaker A calls the meeting to order at the very beginning"
  }
]
```

For items with no clear discussion, return:
```json
{
  "agendaItemID": 29356,
  "agendaTitle": "Acknowledgements",
  "startMS": null,
  "endMS": null,
  "confidence": 0,
  "matchedUtterances": [],
  "reasoning": "No acknowledgements section was mentioned in the transcript"
}
```
```

---

## Chunking Strategy

Long meetings may exceed context limits. Strategy:

### Option A: Sliding Window
1. Process transcript in overlapping chunks (e.g., 30 minutes with 5-minute overlap)
2. Merge results, preferring matches from chunk centers
3. Handle edge cases where agenda item spans chunks

### Option B: Two-Pass Approach
1. **Pass 1**: Summarize each ~10 minute segment (who spoke, topics discussed)
2. **Pass 2**: Match agenda items against summaries to get approximate locations
3. **Pass 3**: Refine timestamps using detailed utterances in the target range

### Option C: Agenda-Guided Search (Recommended)
1. For each agenda item, extract key terms from title/description
2. Search utterances for those terms + context
3. Send only relevant utterance windows to AI for precise timestamp extraction
4. This minimizes token usage and improves accuracy

---

## Output Validation

Before accepting AI-generated timestamps:

### Validation Rules

1. **Time Range Sanity**
   - `startMS` must be < `endMS`
   - Times must be within media duration
   - No negative values

2. **Overlap Detection**
   - Warn if items overlap significantly (may indicate misalignment)
   - Note: Parent/child is for grouping only - children do NOT need to fall within parent's time range
   - Sequential items (by OrderOrdinal) are often but not always sequential in time

3. **Coverage Check**
   - Warn if significant gaps exist between items
   - Warn if total covered time < 50% of meeting length

4. **Confidence Threshold**
   - Only auto-accept items with confidence > 0.7
   - Flag low-confidence items for human review

### Post-Processing

```javascript
function validateTimeline(timeline, utterances, agenda) {
  const issues = [];
  
  // Check each timeline entry
  for (const entry of timeline) {
    if (entry.startMS === null) {
      issues.push({ level: 'info', item: entry.agendaItemID, msg: 'No timestamp found' });
      continue;
    }
    
    if (entry.startMS >= entry.endMS) {
      issues.push({ level: 'error', item: entry.agendaItemID, msg: 'Invalid time range' });
    }
    
    if (entry.confidence < 0.7) {
      issues.push({ level: 'warning', item: entry.agendaItemID, msg: 'Low confidence match' });
    }
  }
  
  return issues;
}
```

---

## API Design

### Endpoint: Generate Timeline

```
POST /v1/timeline/generate
```

**Request:**
```json
{
  "transcriptID": "01ABC...",
  "transcriptRevision": "2026-02-09T23:21:51.000Z",
  "agendaSource": {
    "type": "playapi",
    "eventID": 1183
  },
  "options": {
    "provider": "claude",
    "model": "claude-3-5-sonnet-20241022",
    "confidenceThreshold": 0.7,
    "strategy": "agenda-guided"
  }
}
```

**Response:**
```json
{
  "success": true,
  "jobID": "job_01XYZ...",
  "status": "processing",
  "transcriptRevision": "2026-02-09T23:21:51.000Z"
}
```

### Endpoint: Get Timeline Results

```
GET /v1/timeline/results/{jobID}
```

**Response:**
```json
{
  "status": "completed",
  "timeline": [
    {
      "agendaItemID": 29346,
      "startMS": 0,
      "endMS": 5000,
      "confidence": 0.95
    }
  ],
  "validation": {
    "errors": 0,
    "warnings": 2,
    "issues": [...]
  },
  "stats": {
    "itemsMatched": 28,
    "itemsUnmatched": 3,
    "tokensUsed": 45000,
    "processingTimeMS": 12500
  }
}
```

---

## Provider Adapter Interface

```javascript
/**
 * AI Provider Adapter Interface
 */
class AIProviderAdapter {
  /**
   * @param {object} config - Provider configuration
   * @param {string} config.apiKey - API key
   * @param {string} config.model - Model identifier
   * @param {string} [config.baseUrl] - Custom base URL (for local/proxy)
   */
  constructor(config) {}

  /**
   * Generate timeline from agenda + utterances
   * @param {object} params
   * @param {object[]} params.agendaItems - Flattened agenda items
   * @param {object[]} params.utterances - Transcript utterances
   * @param {object} params.context - Meeting context (title, date, etc.)
   * @returns {Promise<object[]>} Timeline entries with confidence
   */
  async generateTimeline(params) {}

  /**
   * Get token count estimate
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {}
}
```

### Provider Implementations

```
src/providers/
├── index.js           # Provider factory
├── openai.js          # OpenAI GPT-4
├── anthropic.js       # Claude
├── deepseek.js        # DeepSeek
├── kimi.js            # Kimi/Moonshot
├── gemini.js          # Google Gemini
└── ollama.js          # Local models via Ollama
```

---

## Configuration

Add to `FULL_CONFIG_JSON64`:

```json
{
  "aiProviders": {
    "default": "claude",
    "providers": {
      "openai": {
        "apiKey": "sk-...",
        "model": "gpt-4o",
        "baseUrl": "https://api.openai.com/v1"
      },
      "claude": {
        "apiKey": "sk-ant-...",
        "model": "claude-3-5-sonnet-20241022",
        "baseUrl": "https://api.anthropic.com/v1"
      },
      "deepseek": {
        "apiKey": "...",
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1"
      },
      "kimi": {
        "apiKey": "...",
        "model": "moonshot-v1-128k",
        "baseUrl": "https://api.moonshot.cn/v1"
      }
    }
  },
  "timeline": {
    "defaultConfidenceThreshold": 0.7,
    "maxRetries": 3,
    "chunkSizeMinutes": 30,
    "overlapMinutes": 5
  }
}
```

---

## Example: Spring Hill Meeting

### Input Agenda (simplified)

| ID | Title | Parent |
|----|-------|--------|
| 29346 | Call Regular Meeting to Order | - |
| 29347 | Stipulation of Members Present | - |
| 29350 | Invocation | - |
| 29351 | Pledge of Allegiance | - |
| 29352 | Approval of the Agenda | - |
| 29353 | Mayor's Comments | - |
| 29394 | → Retirement Presentation (Doyle McCrary) | 29353 |
| 29354 | City Administrator/Department Head Comments | - |
| ... | ... | ... |

### Expected Output (from human-generated reference)

| Agenda ID | Title | startMS | endMS | confidence |
|-----------|-------|---------|-------|------------|
| 29346 | Call Regular Meeting to Order | 0 | 5000 | 0.95 |
| 29347 | Stipulation of Members Present | 5000 | 13000 | 0.90 |
| 29350 | Invocation | 13000 | 37000 | 0.92 |
| 29351 | Pledge of Allegiance | 37000 | 60000 | 0.88 |
| 29352 | Approval of the Agenda | 60000 | 75000 | 0.85 |
| 29353 | Mayor's Comments | 75000 | 78000 | 0.80 |
| 29394 | Retirement Presentation | 78000 | 275000 | 0.94 |
| 29354 | City Administrator Comments | 275000 | 281000 | 0.75 |

> **Note**: Confidence scores shown are examples of what AI would generate. Human-generated timestamps would have `confidence: null` or `confidence: 1.0`.

### AI Reasoning Example

For agenda item "Invocation" (ID 29350):

```
Reasoning: At segment index 5 (startMS: 13000), Speaker A says "We will begin 
tonight with Mr. Eric Drook from Christ Chapel Church" followed by a prayer. 
The invocation ends at approximately 37000ms when "Amen" is spoken. 
Confidence: 0.92
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Provider adapter interface
- [ ] OpenAI provider implementation
- [ ] Claude provider implementation
- [ ] Prompt builder
- [ ] Response parser

### Phase 2: Timeline Generation
- [ ] Agenda flattening utility
- [ ] Utterance windowing
- [ ] Timeline generation endpoint
- [ ] Job queue integration

### Phase 3: Validation & Refinement
- [ ] Output validation rules
- [ ] Confidence scoring
- [ ] Human review flagging
- [ ] Iterative refinement support

### Phase 4: Additional Providers
- [ ] DeepSeek provider
- [ ] Kimi provider
- [ ] Gemini provider
- [ ] Ollama/local provider

---

## Speaker Identification Enhancement (FUTURE)

> **Status**: Deferred for future implementation. Voice enrollment capabilities are expected to improve across providers. Revisit periodically.

### The Problem
Transcription providers return generic speaker labels (A, B, C or 0, 1, 2) but we want to identify speakers by their actual names (e.g., "Mayor Johnson", "Alderman Smith").

### Provider Capabilities

| Provider                      | Voice Enrollment | Name-Based ID | Notes                    |
|-------------------------------|------------------|---------------|--------------------------|
| **AssemblyAI**                | ❌ No            | ✅ Yes        | Infers names from conversation context using `known_values` parameter |
| **DeepGram**                  | ❌ No            | ❌ No         | Only automatic diarization with numeric labels |
| **Azure Speaker Recognition** | ✅ Yes           | ✅ Yes        | Full voice enrollment/voiceprint system (separate service) |
| **Rev.ai**                    | ❌ No            | ❌ No         | Only automatic diarization |

### AssemblyAI Speaker Identification (Recommended)

AssemblyAI offers "Speaker Identification" which takes a list of expected speaker names and infers who is speaking based on **conversation context** (not voice samples):

```json
{
  "audio_url": "https://example.com/meeting.mp3",
  "speaker_labels": true,
  "speech_understanding": {
    "request": {
      "speaker_identification": {
        "speaker_type": "name",
        "known_values": ["Mayor Johnson", "Alderman Smith", "City Administrator Brown"]
      }
    }
  }
}
```

**How it works:**
- The AI reads the transcript and infers speaker identities from context clues
- E.g., "Thank you, Mayor" → the person being addressed is the Mayor
- Works best when speakers are introduced or referred to by name in the audio

**Limitations:**
- Requires names to be mentioned or inferable from context
- Won't work if speakers never identify themselves or each other

### Azure Speaker Recognition (Voice Enrollment)

For scenarios requiring voice-based identification, **Azure Speaker Recognition** provides true voiceprint enrollment:

1. **Enrollment Phase**: Upload 20+ seconds of audio per speaker to create a voiceprint
2. **Identification Phase**: Submit meeting audio to identify enrolled speakers

```
POST /speaker-recognition/identification/text-independent/profiles/{profileId}/enrollments
Content-Type: audio/wav

[Audio data of speaker sample]
```

**Trade-offs:**
- ✅ True voice-based identification (doesn't rely on context)
- ✅ Works even if speakers never mention names
- ❌ Requires separate enrollment step per speaker
- ❌ Additional API integration and cost
- ❌ Need to maintain speaker profile database

### Hybrid Approach (Recommended)

For municipal meetings, we recommend a hybrid approach:

1. **First Pass**: Use AssemblyAI with `known_values` containing expected speakers (board members, staff)
2. **Fallback**: For unidentified speakers (public commenters), keep generic labels
3. **Optional**: For customers wanting voice-based ID, integrate Azure Speaker Recognition

### Speaker Sample Audio Storage

If implementing voice enrollment:

```json
{
  "speakerProfiles": {
    "MAYOR_JOHNSON": {
      "displayName": "Mayor Johnson",
      "enrollmentAudioURLs": [
        "https://storage.example.com/speakers/mayor_johnson_sample1.wav",
        "https://storage.example.com/speakers/mayor_johnson_sample2.wav"
      ],
      "azureProfileId": "abc123-def456",
      "enrolledAt": "2025-01-15T10:00:00Z",
      "enrollmentDurationSeconds": 45
    }
  }
}
```

**Audio Requirements:**
- Minimum 20 seconds of clear speech per speaker
- WAV format recommended (uncompressed)
- Single speaker per file
- Minimal background noise

---

## Future Enhancements

1. **Learning from Corrections**: Store human corrections to improve future accuracy
2. **Customer-Specific Training**: Fine-tune prompts based on customer meeting patterns
3. **Real-Time Processing**: Generate timestamps as live stream progresses
4. **Multi-Language Support**: Handle meetings in languages other than English
5. **Attachment Context**: Use agenda item attachments to improve matching accuracy
6. **Voice Enrollment Integration**: Integrate Azure Speaker Recognition for voice-based speaker identification (see "Speaker Identification Enhancement" section above)

---

## References

- README.md - Process Flow section
- `docs/shtn_1183.champds.playapi.json` - Example PlayAPI response with Agenda and Timeline
- `docs/shtn_20250721.json` - Example AssemblyAI response with utterances
