# Phase 2: AI Timeline Generation

## Overview

Phase 2 focuses on automatically aligning agenda items to transcript timestamps using AI. This is the core "intelligence" of the system that eliminates the manual work of linking agenda items to specific moments in meeting recordings.

**Status**: Planning

**Dependencies**: Phase 1 (Transcript Ingestion) complete, with transcript `modifiedAt` and editable text fields populated

**Focused implementation plan**: See `PLAN_AGENDA_TIMESTAMP_AUTOMATION.md` for the concrete job contract, provider orchestration, confidence model, and historical human-data strategy.

---

## Goals

1. Automatically match agenda items to their corresponding time ranges in transcripts
2. Provide confidence scores for each match
3. Support multiple AI providers for flexibility and cost optimization
4. Leverage transcription provider features where available (topic detection, custom vocabulary)
5. Handle edge cases: out-of-order items, revisited items, skipped items
6. Ensure generated timeline output is tied to a specific transcript revision/snapshot
7. Leverage authoritative caption hints (when available) to improve timestamp precision and text alignment

---

## Provider Feature Analysis

### Transcription-Time Features

These features are applied **during transcription** and can enhance the raw transcript data before AI timeline generation.

| Provider | Custom Topics | Custom Vocabulary | Topic Detection | Notes |
|----------|--------------|-------------------|-----------------|-------|
| **AssemblyAI** | ✅ Via LLM Gateway | ❌ Not available | ✅ IAB Categories (698 topics) | Custom topics require post-processing via LeMUR/LLM Gateway |
| **DeepGram** | ✅ `custom_topic` param | ✅ Keywords boosting | ✅ Built-in TSLM | Up to 100 custom topics; `strict` or `extended` mode |
| **Rev.ai** | ❌ Not available | ✅ Custom Vocabulary API | ✅ Topic Extraction API | Separate API call for topic extraction |

### Post-Processing Features

These features are applied **after transcription** to analyze and extract information from the transcript.

| Provider | LLM Integration | Timestamp Citations | Embeddings Support |
|----------|----------------|---------------------|-------------------|
| **AssemblyAI** | ✅ LeMUR + LLM Gateway | ✅ Via embeddings | ✅ Works with OpenAI embeddings |
| **DeepGram** | ❌ Not built-in | ❌ Manual | ❌ Manual |
| **Rev.ai** | ❌ Not built-in | ❌ Manual | ❌ Manual |

---

## Recommended Approach: Hybrid Strategy

Based on research, we recommend a **hybrid approach** that combines:

1. **Transcription-time enhancements** (where available)
2. **Post-transcription AI analysis** (primary method)
3. **Embedding-based citation retrieval** (for timestamp precision)

### Strategy A: DeepGram Custom Topics (Transcription-Time)

Use DeepGram's built-in custom topic detection during transcription:

```javascript
// During transcription request
const transcriptionOptions = {
  topics: true,
  custom_topic: [
    'Call Meeting to Order',
    'Approval of the Agenda',
    'Public Hearing',
    'Consent Agenda',
    'Budget Amendment',
    // ... flatten agenda item titles
  ],
  custom_topic_mode: 'extended' // Get custom + detected topics
};
```

**Pros:**
- Topics detected with timestamps at transcription time
- No additional API calls needed
- Up to 100 custom topics supported

**Cons:**
- Limited to 100 topics (may not cover all agenda items)
- Topic matching is fuzzy, not exact
- Still need AI to determine primary time ranges

### Strategy B: AssemblyAI LeMUR + Embeddings (Post-Processing)

Use AssemblyAI's LeMUR for analysis and embeddings for precise timestamps:

```javascript
// Step 1: Transcribe with speaker labels
const transcript = await assemblyai.transcribe({
  audio_url: mediaURL,
  speaker_labels: true
});

// Step 2: Create embeddings from transcript paragraphs
const embeddings = await createTranscriptEmbeddings(transcript);

// Step 3: Use LeMUR to identify agenda item discussions
const analysis = await lemur.task({
  transcript_ids: [transcript.id],
  prompt: `Given these agenda items: ${JSON.stringify(agendaItems)}
           Identify when each item is discussed in the transcript.
           Return a JSON array with agendaItemID and the quoted text where it's discussed.`
});

// Step 4: Use embeddings to find exact timestamps for each quote
for (const item of analysis.results) {
  const matches = await findRelevantMatches(embeddings, item.quote);
  item.startMS = matches[0].timestamp;
}
```

**Pros:**
- Most accurate timestamp retrieval
- LeMUR understands meeting context well
- Can handle complex reasoning about agenda flow

**Cons:**
- Requires AssemblyAI paid account
- Additional cost for LeMUR + embeddings
- More complex implementation

### Strategy C: Direct LLM Analysis (Provider-Agnostic)

Send transcript utterances + agenda items directly to any LLM:

```javascript
// Build prompt with utterances and agenda
const prompt = buildTimelinePrompt(agendaItems, utterances);

// Call any LLM provider
const response = await llmProvider.chat({
  model: 'claude-3-5-sonnet-20241022',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt }
  ],
  response_format: { type: 'json_object' }
});

// Parse structured response
const timeline = JSON.parse(response.content);
```

**Pros:**
- Works with any LLM provider
- Full control over prompting
- Can use local models (Ollama) for cost savings

**Cons:**
- May hit context limits on long meetings
- Requires careful chunking strategy
- Timestamp precision depends on prompt engineering

---

## Implementation Plan

### Phase 2.1: Core Infrastructure

| Task | Description | Priority |
|------|-------------|----------|
| 2.1.1 | Create AI provider adapter interface | High |
| 2.1.2 | Implement OpenAI adapter | High |
| 2.1.3 | Implement Anthropic (Claude) adapter | High |
| 2.1.4 | Create prompt builder service | High |
| 2.1.5 | Create response parser with validation | High |
| 2.1.6 | Add configuration for AI providers | High |

### Phase 2.2: Timeline Generation Service

| Task | Description | Priority |
|------|-------------|----------|
| 2.2.1 | Create agenda flattening utility | High |
| 2.2.2 | Implement utterance windowing/chunking | High |
| 2.2.3 | Create timeline generation endpoint | High |
| 2.2.4 | Implement async job processing | Medium |
| 2.2.5 | Add progress tracking | Medium |
| 2.2.6 | Persist transcript revision metadata with each timeline job/result | High |
| 2.2.7 | Incorporate caption hint signals into agenda-guided search | Medium |

### Phase 2.3: Provider-Specific Enhancements

| Task | Description | Priority |
|------|-------------|----------|
| 2.3.1 | Add DeepGram custom topics at transcription | Medium |
| 2.3.2 | Implement AssemblyAI LeMUR integration | Medium |
| 2.3.3 | Add embedding-based citation retrieval | Medium |
| 2.3.4 | Implement Rev.ai topic extraction integration | Low |

### Phase 2.4: Validation & Quality

| Task | Description | Priority |
|------|-------------|----------|
| 2.4.1 | Implement timeline validation rules | High |
| 2.4.2 | Add confidence scoring | High |
| 2.4.3 | Create human review flagging | Medium |
| 2.4.4 | Build accuracy comparison tooling | Medium |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Timeline Generation Service                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Routes (routes/)                                │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │ │
│  │  │ POST /timeline/  │  │ GET /timeline/   │  │ POST /timeline/  │      │ │
│  │  │ generate         │  │ results/:jobID   │  │ validate         │      │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      v                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Services (services/)                                 │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                   timelineGeneration.js                          │   │ │
│  │  │  - generateTimeline(transcriptID, agendaSource, options)         │   │ │
│  │  │  - validateTimeline(timeline, utterances, agenda)                │   │ │
│  │  │  - refineTimeline(timeline, feedback)                            │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                      promptBuilder.js                            │   │ │
│  │  │  - buildSystemPrompt(meetingContext)                             │   │ │
│  │  │  - buildUserPrompt(agendaItems, utterances)                      │   │ │
│  │  │  - chunkUtterances(utterances, strategy)                         │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      v                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Providers (providers/)                               │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐          │ │
│  │  │   openai   │ │ anthropic  │ │  deepseek  │ │   ollama   │          │ │
│  │  │    .js     │ │    .js     │ │    .js     │ │    .js     │          │ │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘          │ │
│  │  ┌────────────┐ ┌────────────┐                                        │ │
│  │  │    kimi    │ │   gemini   │                                        │ │
│  │  │    .js     │ │    .js     │                                        │ │
│  │  └────────────┘ └────────────┘                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      v                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                   Utilities (utils/)                                    │ │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐              │ │
│  │  │ agendaFlatten  │ │ responseParser │ │ tokenEstimator │              │ │
│  │  │     .js        │ │     .js        │ │     .js        │              │ │
│  │  └────────────────┘ └────────────────┘ └────────────────┘              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### POST /v1/timeline/generate

Start timeline generation for a transcript.

**Request:**
```json
{
  "transcriptID": "01ABC123...",
  "agendaSource": {
    "type": "playapi",
    "eventID": 1183
  },
  "options": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "strategy": "agenda-guided",
    "confidenceThreshold": 0.7,
    "useTranscriptionTopics": true,
    "transcriptRevision": "2026-02-09T23:21:51.000Z"
  }
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobID": "job_01XYZ789",
  "status": "processing",
  "estimatedDurationSeconds": 45
}
```

### GET /v1/timeline/results/:jobID

Get timeline generation results.

**Response (200 OK):**
```json
{
  "status": "completed",
  "timeline": [
    {
      "agendaItemID": 29346,
      "agendaTitle": "Call Regular Meeting to Order",
      "startMS": 0,
      "endMS": 5000,
      "confidence": 0.95,
      "matchedUtterances": [0, 1],
      "reasoning": "Speaker A calls the meeting to order at the very beginning"
    }
  ],
  "validation": {
    "errors": 0,
    "warnings": 2,
    "issues": [
      { "level": "warning", "itemID": 29356, "msg": "Low confidence match (0.62)" }
    ]
  },
  "stats": {
    "itemsMatched": 28,
    "itemsUnmatched": 3,
    "tokensUsed": 45000,
    "processingTimeMS": 12500,
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "transcriptRevision": "2026-02-09T23:21:51.000Z"
  }
}
```

### POST /v1/timeline/validate

Validate a timeline against utterances and agenda.

**Request:**
```json
{
  "timeline": [...],
  "transcriptID": "01ABC123...",
  "agendaSource": {
    "type": "playapi",
    "eventID": 1183
  }
}
```

**Response:**
```json
{
  "valid": false,
  "errors": 1,
  "warnings": 3,
  "issues": [
    { "level": "error", "itemID": 29352, "msg": "startMS >= endMS" },
    { "level": "warning", "itemID": 29353, "msg": "Significant overlap with item 29354" }
  ]
}
```

---

## Prompt Strategy

### System Prompt

```
You are an expert at analyzing meeting transcripts and identifying when specific 
agenda items are being discussed. Your task is to match agenda items to their 
corresponding time segments in the transcript.

CRITICAL RULES:
1. Each agenda item should have ONE primary time range (when it's actively discussed)
2. If an item is revisited, use the FIRST substantive discussion
3. Parent/child relationships are for GROUPING only - treat each item independently
   - A parent (e.g., "PUBLIC HEARING") gets its own timestamp when announced
   - Children get their own separate timestamps when discussed
   - Children do NOT need to fall within the parent's time range
4. Brief mentions or procedural references don't count as "discussing" an item
5. Some items may have no corresponding discussion - return null for those
6. All times are in MILLISECONDS (both input utterances and output timestamps)
7. Use the ACTUAL startMS from utterances - do not estimate or interpolate

CONFIDENCE SCORING:
- 0.9-1.0: Explicit verbal announcement of the agenda item
- 0.7-0.9: Clear contextual match (topic discussed matches item title/description)
- 0.5-0.7: Probable match based on content
- 0.0-0.5: Uncertain - flag for human review
```

### User Prompt Template

```
## MEETING CONTEXT
- Title: {eventTitle}
- Date: {eventDate}
- Body: {organizationName}

## AGENDA ITEMS
{agenda_items_json}

## TRANSCRIPT UTTERANCES
{utterances_json}

## TASK

For each agenda item, identify when it is being discussed in the transcript.
Return a JSON array with this structure:

```json
[
  {
    "agendaItemID": 29346,
    "agendaTitle": "Call Regular Meeting to Order",
    "startMS": 0,
    "endMS": 5000,
    "confidence": 0.95,
    "matchedUtteranceIndices": [0, 1],
    "reasoning": "Speaker A calls the meeting to order at the very beginning"
  }
]
```

For items with no clear discussion:
```json
{
  "agendaItemID": 29356,
  "agendaTitle": "Acknowledgements",
  "startMS": null,
  "endMS": null,
  "confidence": 0,
  "matchedUtteranceIndices": [],
  "reasoning": "No acknowledgements section was mentioned in the transcript"
}
```
```

---

## Chunking Strategies

### Option A: Sliding Window

For long meetings, process transcript in overlapping chunks:

```javascript
const CHUNK_SIZE_MS = 30 * 60 * 1000; // 30 minutes
const OVERLAP_MS = 5 * 60 * 1000;     // 5 minute overlap

function* chunkUtterances(utterances) {
  let startMS = 0;
  const maxMS = utterances[utterances.length - 1].endMS;
  
  while (startMS < maxMS) {
    const endMS = startMS + CHUNK_SIZE_MS;
    const chunk = utterances.filter(u => 
      u.startMS >= startMS && u.startMS < endMS
    );
    yield { chunk, startMS, endMS };
    startMS += CHUNK_SIZE_MS - OVERLAP_MS;
  }
}
```

### Option B: Agenda-Guided Search (Recommended)

For each agenda item, search utterances for relevant terms then send only those windows to AI:

```javascript
async function findAgendaItemWindow(agendaItem, utterances) {
  // Extract key terms from agenda item
  const terms = extractKeyTerms(agendaItem.title, agendaItem.description);
  
  // Find utterances mentioning these terms
  const matches = utterances.filter(u => 
    terms.some(term => u.textOriginal.toLowerCase().includes(term.toLowerCase()))
  );
  
  if (matches.length === 0) {
    // Fall back to sending surrounding context
    return null;
  }
  
  // Get window around first match (±2 minutes)
  const firstMatch = matches[0];
  const windowStart = Math.max(0, firstMatch.startMS - 120000);
  const windowEnd = firstMatch.endMS + 120000;
  
  return utterances.filter(u => 
    u.startMS >= windowStart && u.endMS <= windowEnd
  );
}
```

---

## Validation Rules

```javascript
function validateTimeline(timeline, utterances, agenda) {
  const issues = [];
  const mediaMaxMS = utterances[utterances.length - 1].endMS;
  
  for (const entry of timeline) {
    // Rule 1: Time range sanity
    if (entry.startMS !== null) {
      if (entry.startMS >= entry.endMS) {
        issues.push({ level: 'error', itemID: entry.agendaItemID, msg: 'startMS >= endMS' });
      }
      if (entry.startMS < 0 || entry.endMS > mediaMaxMS) {
        issues.push({ level: 'error', itemID: entry.agendaItemID, msg: 'Time outside media duration' });
      }
    }
    
    // Rule 2: Confidence threshold
    if (entry.confidence > 0 && entry.confidence < 0.7) {
      issues.push({ level: 'warning', itemID: entry.agendaItemID, msg: `Low confidence (${entry.confidence})` });
    }
    
    // Rule 3: Missing timestamps for items that should have them
    if (entry.startMS === null && !isOptionalAgendaItem(entry.agendaItemID, agenda)) {
      issues.push({ level: 'warning', itemID: entry.agendaItemID, msg: 'No timestamp found' });
    }
  }
  
  // Rule 4: Check for significant overlaps (but allow some - meetings are messy)
  for (let i = 0; i < timeline.length; i++) {
    for (let j = i + 1; j < timeline.length; j++) {
      if (timeline[i].startMS && timeline[j].startMS) {
        const overlap = calculateOverlap(timeline[i], timeline[j]);
        if (overlap > 0.5) { // More than 50% overlap
          issues.push({ 
            level: 'warning', 
            itemID: timeline[i].agendaItemID, 
            msg: `Significant overlap with item ${timeline[j].agendaItemID}` 
          });
        }
      }
    }
  }
  
  // Rule 5: Coverage check
  const coveredMS = timeline
    .filter(t => t.startMS !== null)
    .reduce((sum, t) => sum + (t.endMS - t.startMS), 0);
  
  if (coveredMS < mediaMaxMS * 0.5) {
    issues.push({ level: 'info', msg: `Only ${Math.round(coveredMS/mediaMaxMS*100)}% of meeting covered` });
  }
  
  return issues;
}
```

Additional rule for asynchronous processing:
- Reject or mark stale any result where transcript `modifiedAt` changed after job start.
- Require regeneration when the transcript revision used by timeline no longer matches current transcript revision.

---

## Provider Adapter Interface

```javascript
/**
 * AI Provider Adapter Interface
 * All providers must implement this interface
 */
class AIProviderAdapter {
  /**
   * @param {object} config - Provider configuration
   * @param {string} config.apiKey - API key
   * @param {string} config.model - Model identifier
   * @param {string} [config.baseUrl] - Custom base URL (for local/proxy)
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate timeline from agenda + utterances
   * @param {object} params
   * @param {object[]} params.agendaItems - Flattened agenda items
   * @param {object[]} params.utterances - Transcript utterances
   * @param {object} params.context - Meeting context (title, date, etc.)
   * @param {object} [params.options] - Additional options
   * @returns {Promise<object>} Timeline entries with confidence and stats
   */
  async generateTimeline(params) {
    throw new Error('Not implemented');
  }

  /**
   * Estimate token count for input
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    // Default: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get maximum context window for this provider/model
   * @returns {number} Max tokens
   */
  getMaxContextTokens() {
    throw new Error('Not implemented');
  }
}
```

---

## Configuration

### Environment Variables

```bash
# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=...
KIMI_API_KEY=...
GOOGLE_AI_API_KEY=...

# Provider Selection
AI_DEFAULT_PROVIDER=anthropic
AI_DEFAULT_MODEL=claude-3-5-sonnet-20241022

# Timeline Generation
TIMELINE_CONFIDENCE_THRESHOLD=0.7
TIMELINE_CHUNK_SIZE_MINUTES=30
TIMELINE_OVERLAP_MINUTES=5
```

### Config File

```json
{
  "aiProviders": {
    "default": "anthropic",
    "providers": {
      "openai": {
        "apiKey": "${OPENAI_API_KEY}",
        "model": "gpt-4o",
        "baseUrl": "https://api.openai.com/v1",
        "maxContextTokens": 128000
      },
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "model": "claude-3-5-sonnet-20241022",
        "baseUrl": "https://api.anthropic.com/v1",
        "maxContextTokens": 200000
      },
      "deepseek": {
        "apiKey": "${DEEPSEEK_API_KEY}",
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1",
        "maxContextTokens": 64000
      },
      "kimi": {
        "apiKey": "${KIMI_API_KEY}",
        "model": "moonshot-v1-128k",
        "baseUrl": "https://api.moonshot.cn/v1",
        "maxContextTokens": 128000
      },
      "ollama": {
        "model": "llama3:70b",
        "baseUrl": "http://localhost:11434/api",
        "maxContextTokens": 8000
      }
    }
  },
  "timeline": {
    "defaultConfidenceThreshold": 0.7,
    "maxRetries": 3,
    "chunkSizeMinutes": 30,
    "overlapMinutes": 5,
    "strategy": "agenda-guided"
  }
}
```

---

## Cost Estimation

### Token Usage per Meeting

| Meeting Length | Utterances | Est. Input Tokens | Est. Output Tokens |
|----------------|------------|-------------------|-------------------|
| 1 hour | ~300 | ~25,000 | ~2,000 |
| 2 hours | ~600 | ~50,000 | ~3,000 |
| 3 hours | ~900 | ~75,000 | ~4,000 |
| 4 hours | ~1200 | ~100,000 | ~5,000 |

### Provider Cost Comparison (estimated)

| Provider | Model | Input/1M | Output/1M | Est. Cost (2hr meeting) |
|----------|-------|----------|-----------|------------------------|
| OpenAI | GPT-4o | $2.50 | $10.00 | ~$0.16 |
| Anthropic | Claude 3.5 Sonnet | $3.00 | $15.00 | ~$0.20 |
| DeepSeek | deepseek-chat | $0.14 | $0.28 | ~$0.01 |
| Kimi | moonshot-v1-128k | $0.12 | $0.12 | ~$0.01 |
| Ollama | Local | Free | Free | $0.00 (hardware cost) |

*Note: Costs are approximate and subject to change. Check provider pricing pages for current rates.*

---

## Success Criteria

Phase 2 is complete when:

1. **Core functionality works**: Submit transcript + agenda → receive timeline with timestamps
2. **Multi-provider support**: At least OpenAI and Anthropic working
3. **Accuracy baseline established**: Compare against human-generated timelines, achieve >80% match rate
4. **Confidence scoring works**: Low-confidence items (<0.7) properly flagged for review
5. **Validation catches errors**: Invalid time ranges, overlaps, and coverage issues detected
6. **Revision consistency enforced**: Timeline records include transcript revision and stale results are detected
7. **Performance acceptable**: Timeline generated in <60 seconds for 2-hour meeting
8. **Documentation complete**: API endpoints documented, provider setup guides available

---

## Testing Strategy

### Unit Tests

- Prompt builder with various agenda structures
- Response parser with valid/invalid AI responses
- Validation rules with edge cases
- Token estimation accuracy

### Integration Tests

- Full pipeline: transcript → agenda → timeline
- Provider failover (if primary fails, try secondary)
- Chunking with long meetings
- Real sample data from `docs/` folder

### Accuracy Tests

- Compare AI-generated timelines against human baselines
- Measure per-item accuracy (correct within ±30 seconds)
- Track confidence correlation with accuracy

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI hallucination (wrong timestamps) | High | Validation rules + confidence thresholds + human review |
| Context window exceeded | Medium | Chunking strategies + agenda-guided search |
| Provider API rate limits | Medium | Queue with backoff + provider rotation |
| High costs for large meetings | Medium | Local model option + smart chunking |
| Inconsistent results across runs | Medium | Temperature=0 + seed parameter where available |

---

## Future Enhancements (Post Phase 2)

1. **Learning from corrections**: Store human corrections to improve prompts
2. **Customer-specific tuning**: Adjust prompts based on meeting patterns
3. **Embedding-based refinement**: Use AssemblyAI LeMUR + embeddings for higher precision
4. **Real-time preview**: Show timeline confidence as meeting progresses
5. **Multi-language support**: Handle non-English meetings

---

## Related Documents

- `PLAN_OVERALL.md` - Overall project roadmap
- `PLAN_PHASE_1.md` - Transcript ingestion (dependency)
- `PLAN_PHASE_3_TRANSCRIPT_EDITING_CAPTIONS.md` - Transcript revision and caption lifecycle context
- `PLAN_AI_INTERPOLATION.md` - Original design document
- `API-ENDPOINTS.md` - API documentation
