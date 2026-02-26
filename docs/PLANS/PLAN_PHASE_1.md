# Phase 1: Transcript Ingestion

## Overview

Phase 1 focuses on establishing the foundational transcript ingestion infrastructure. This is the "quick win" phase that enables all downstream functionality by getting transcripts into the system.

**Status**: In Progress

---

## Goals

1. Ingest transcripts from multiple sources into CoreAPI
2. Normalize provider-specific formats into a common structure
3. Store both full transcript and individual utterances
4. Maintain audit trail with provider metadata
5. Persist transcript fields in a way that is forward-compatible with human transcript editing

---

## Scope

### In Scope
- Path 1: Provider JSON Import (AssemblyAI, DeepGram)
- Path 2: Media-Based Transcription (async job submission)
- Path 3: Caption File Import (SRT, VTT) as transcript hint input
- CoreAPI client for persistence
- Parser modules for each provider format
- Basic error handling and validation
- Set initial `textModified`/`speakerModified` values and `modifiedAt` for downstream edit/caption phases
- Track whether imported captions are authoritative human input (`isAuthoritativeCaption`)

### Out of Scope (Future Phases)
- AI-powered timeline generation
- Transcript editing workflows (single/bulk speaker correction UI/API)
- Caption generation from transcript text (SRT/VTT export + regeneration rules)
- Summary generation
- Minutes output formatting
- Accessibility audio
- Additional transcription providers beyond AssemblyAI/DeepGram

---

## Phase 1.5: Mandatory Silence Detection Preprocessing

Silence detection is required on every AAC file used for transcription.

### Goals
- Detect and persist silence intervals for every media file processed in Path 2
- Prevent provider issues on long-silence recordings by supporting optional non-silent chunk submission
- Preserve accurate full-media timestamps regardless of chunking strategy

### Required Outputs (per file)
- `silenceIntervals`: array of `{ startMS, endMS, durationMS }`
- `isSilenceAnalyzed`: boolean status marker
- `silenceAnalysisMeta`: threshold config + tool version + analyzedAt timestamp
- `chunkMap` (when chunking enabled): mapping from chunk timeline to original timeline

### Default Processing Rule
1. Acquire or generate AAC
2. Run silence analysis (`ffmpeg silencedetect`)
3. Persist silence metadata
4. Submit either full AAC or non-silent chunks based on provider/config
5. Re-map provider timestamps to original full-media timeline before persistence

### Failure Policy
- If silence analysis fails, mark transcript as failed and do not submit to provider
- If chunk re-timing validation fails, reject ingestion result and flag for retry/manual review

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Transcript Ingestion Service                  │
│                         (Port 7002)                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     Routes (routes/)                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │  │
│  │  │ POST         │ │ POST         │ │ POST         │        │  │
│  │  │ /provider-   │ │ /transcribe- │ │ /caption-    │        │  │
│  │  │ json         │ │ media        │ │ file         │        │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              v                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Services (services/)                        │ │
│  │  ┌───────────────────────────────────────────────────────┐  │ │
│  │  │           transcriptIngestion.js                      │  │ │
│  │  │  - processProviderJSON()                              │  │ │
│  │  │  - submitMediaForTranscription()                      │  │ │
│  │  │  - processCaptionFile()                               │  │ │
│  │  └───────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              v                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   Parsers (parsers/)                        │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐               │ │
│  │  │ assemblyai │ │  deepgram  │ │    srt     │               │ │
│  │  │    .js     │ │    .js     │ │    .js     │               │ │
│  │  └────────────┘ └────────────┘ └────────────┘               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              v                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Clients (clients/)                          │ │
│  │  ┌───────────────────────────────────────────────────────┐  │ │
│  │  │              coreApiClient.js                         │  │ │
│  │  │  - createTranscript()                                 │  │ │
│  │  │  - createTranscriptUtterances()                       │  │ │
│  │  └───────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                               │
                               v
                    ┌────────────────────┐
                    │      CoreAPI       │
                    │    (Port 7001)     │
                    │  - transcripts     │
                    │  - utterances      │
                    └────────────────────┘
```

---

## Tasks

### 1.1 Project Setup
- [x] Initialize Node.js project with Fastify
- [x] Set up project structure (routes/, services/, parsers/, clients/, config/)
- [x] Configure environment variables
- [x] Create README with setup instructions
- [x] Add basic logging infrastructure
- [x] Add health check endpoint
- [x] Add connection tester for external services (DFW, AssemblyAI, DeepGram, CoreAPI)

### 1.2 CoreAPI Client
- [x] Create coreApiClient.js with base configuration
- [ ] Implement `createTranscript()` method
- [ ] Implement `createTranscriptUtterances()` method (bulk insert)
- [ ] Implement `getTranscript()` method
- [ ] Implement `updateTranscript()` method
- [ ] Add retry logic for transient failures
- [ ] Add request/response logging

### 1.3 Provider Parsers
- [x] Create parser index with factory pattern
- [x] Implement AssemblyAI parser
  - [x] Parse utterances with speaker labels
  - [x] Extract provider metadata
  - [x] Handle word-level timing (if available)
  - [ ] Validate required fields
- [x] Implement DeepGram parser
  - [x] Parse utterances from alternatives
  - [x] Extract provider metadata
  - [x] Handle multi-channel audio
  - [ ] Validate required fields
- [x] Implement SRT parser
  - [x] Parse caption cues to utterances
  - [x] Handle timing format conversion
  - [ ] Support VTT format
  - [ ] Validate required fields

### 1.4 Ingestion Routes
- [x] Create route structure
- [ ] **Path 1: POST /v1/ingest/provider-json**
  - [ ] Accept provider JSON body
  - [ ] Detect provider type (or accept as parameter)
  - [ ] Parse using appropriate parser
  - [ ] Create transcript document via CoreAPI
  - [ ] Create utterance documents via CoreAPI
  - [ ] Return transcript ID and summary
- [ ] **Path 2: POST /v1/ingest/transcribe-media**
  - [ ] Accept mediaPath and provider preference
  - [ ] Implement media acquisition service
    - [ ] Check local storage for pre-extracted `.aac` first
    - [ ] If no local `.aac`, download `.mp4` from DFW HTTPS source
  - [ ] Implement audio extraction service
    - [ ] Extract AAC from MP4 using ffmpeg (passthrough, no re-encode)
    - [ ] Keep extracted `.aac` in local cache for temporary reprocessing reuse
  - [ ] Implement provider submission service
    - [ ] AssemblyAI: Upload audio → Submit job
    - [ ] DeepGram: Upload audio → Submit job
  - [ ] Create transcript record in CoreAPI (status: pending)
  - [ ] Submit polling job to CoreAPI JobQueue
  - [ ] Implement temp file cleanup
    - [ ] Delete downloaded `.mp4` immediately after successful AAC extraction/upload
    - [ ] Retain `.aac` for configured TTL before cleanup
  - [ ] Return transcriptID, coreApiJobID, providerJobID
- [ ] **Path 3: POST /v1/ingest/caption-file**
  - [ ] Accept SRT/VTT file content
  - [ ] Parse captions to utterances
  - [ ] Mark caption payload with `isAuthoritativeCaption` when human-supplied
  - [ ] Store caption cues for later reconciliation with provider transcript
  - [ ] Create transcript hint records and utterances
  - [ ] Return transcript ID

### 1.5 Ingestion Service
- [x] Create transcriptIngestion.js service
- [ ] Implement `processProviderJSON(customerID, providerName, jsonData, options)`
  - [ ] Validate input
  - [ ] Parse using appropriate parser
  - [ ] Build transcript document
  - [ ] Build utterance documents
  - [ ] Persist via CoreAPI client
  - [ ] Return result summary
- [ ] Implement `submitMediaForTranscription(customerID, mediaPath, provider, options)`
  - [ ] Acquire media via mediaAcquisition service (local AAC → DFW MP4)
  - [ ] Extract audio if MP4 (via audioExtraction service)
  - [ ] Upload to provider and submit transcription job
  - [ ] Create pending transcript record in CoreAPI
  - [ ] Submit polling job to CoreAPI JobQueue
  - [ ] Cleanup temp files (`.mp4` immediate, `.aac` by TTL)
  - [ ] Return { transcriptID, coreApiJobID, providerJobID, mediaSource }
- [ ] Implement `processCaptionFile(customerID, captionContent, format, options)`
  - [ ] Detect format if not specified
  - [ ] Parse caption file
  - [ ] Record `isAuthoritativeCaption` and caption-source metadata
  - [ ] Build transcript and utterances with `textOriginal` + initial `textModified`
  - [ ] Set transcript `modifiedAt` and `textOriginalAt` values consistently
  - [ ] Persist via CoreAPI
  - [ ] Return result summary

### 1.10 Silence Detection and Re-Timing (Phase 1.5)
- [ ] Implement `analyzeSilence(audioPath, options)` service
  - [ ] Run `ffmpeg silencedetect` with configurable thresholds
  - [ ] Parse intervals to normalized milliseconds
  - [ ] Return `{ silenceIntervals, totalSilenceMS, analyzedDurationMS }`
- [ ] Persist silence analysis metadata with transcript/media linkage
  - [ ] `isSilenceAnalyzed`
  - [ ] `silenceIntervals`
  - [ ] `silenceAnalysisMeta`
- [ ] Implement optional non-silent chunk builder
  - [ ] Create chunk timeline map for each submitted segment
  - [ ] Keep minimum chunk size and merge-close-gaps safeguards
- [ ] Implement timestamp re-mapping utility
  - [ ] Convert provider chunk-relative start/end to full-media `startMS`/`endMS`
  - [ ] Validate remap monotonicity and bounds
- [ ] Add integration tests for:
  - [ ] file with no silence
  - [ ] file with long silence gap(s)
  - [ ] chunked submission with successful re-map
  - [ ] failed silence analysis handling

### 1.6 Forward-Compatibility for Transcript Edits/Captions
- [ ] Ensure all ingestion paths initialize editable fields consistently
  - [ ] `textModified = textOriginal` on create
  - [ ] `speakerModified = speakerOriginal` on create
  - [ ] `transcripts.modifiedAt` set on initial ingest
- [ ] Return transcript metadata needed by later phases
  - [ ] Include `modifiedAt` in ingestion responses
  - [ ] Include source marker in transcript metadata (`AUTOGEN:*` / `HUMAN:*`)
- [ ] Document revision assumptions used by Phase 2/3 plans

### 1.7 Validation & Error Handling
- [ ] Validate utterance time ranges (startMS < endMS)
- [ ] Validate speaker labels
- [ ] Handle empty/null text segments
- [ ] Standardize error response format
- [ ] Add input validation schemas (Fastify JSON Schema)

### 1.8 Testing
- [ ] Unit tests for each parser
- [ ] Unit tests for CoreAPI client
- [ ] Integration tests for ingestion routes
- [ ] Test with sample data files:
  - [ ] shtn_1137_assemblyai.json
  - [ ] shtn_1137_deepgram.json
  - [ ] sample-caption.srt

### 1.9 Documentation
- [x] README with project overview
- [x] API-ENDPOINTS.md with route documentation
- [x] PROVIDER-FORMATS.md with format details
- [ ] Add example requests/responses to docs
- [ ] Document error codes

---

## API Endpoints

### POST /v1/ingest/provider-json

Import a transcript from a transcription provider's JSON response.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerID | string | Yes | Customer identifier |

**Request Body:**
```json
{
  "provider": "assemblyai",
  "mediaID": "media_01ABC123",
  "externalMediaID": "shtn_1137",
  "providerData": { /* Full provider JSON response */ }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "transcriptID": "01ABC123...",
  "summary": {
    "utteranceCount": 342,
    "speakerCount": 8,
    "durationMS": 9757000,
    "provider": "assemblyai"
  }
}
```

### POST /v1/ingest/transcribe-media

Submit media for transcription by an external provider. This endpoint handles media acquisition from multiple sources, audio extraction, and job submission.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerID | string | Yes | Customer identifier |

**Request Body:**
```json
{
  "mediaPath": "shtn_1137/shtn_1137.mp4",
  "mediaID": "media_01ABC123",
  "externalMediaID": "shtn_1137",
  "provider": "assemblyai",
  "options": {
    "speakerLabels": true,
    "languageCode": "en_us"
  }
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "coreApiJobID": "job_01XYZ789",
  "transcriptID": "01ABC123...",
  "providerJobID": "abc123-def456",
  "status": "pending",
  "mediaSource": "dfw",
  "audioExtracted": true
}
```

---

## Path 2: Media Acquisition & Processing Pipeline

### Overview

Path 2 handles the complete workflow from media path to transcription job submission:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Media Acquisition Pipeline                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: mediaPath (e.g., "shtn_1137/shtn_1137.mp4")                         │
│                              │                                              │
│                              v                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              1. Check LOCAL AAC Cache                                 │  │
│  │  Path: {LOCAL_MEDIA_BASE}/{mediaPath}.aac                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                    │ Found?                                                 │
│            ┌──────┴──────┐                                                  │
│            │ Yes         │ No                                               │
│            v             v                                                  │
│       Use Local AAC  ┌──────────────────────────────────────────────────┐  │
│                      │         2. Fetch MP4 from DFW (HTTPS)            │  │
│                      │  URL: {DFW_BASE_URL}/{mediaPath}                 │  │
│                      │  Download MP4 to temp storage                    │  │
│                      └──────────────────────────────────────────────────┘  │
│                                      │                                      │
│                                      v                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              3. Audio Extraction                                      │  │
│  │  ffmpeg -i input.mp4 -vn -acodec copy output.aac                      │  │
│  │  (Lossless passthrough - no re-encoding)                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              v                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              4. Upload AAC to Provider                                │  │
│  │  - AssemblyAI: POST /v2/upload → returns upload_url                   │  │
│  │  - DeepGram: Direct URL or upload                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              v                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              5. Submit Transcription Job                              │  │
│  │  - Call provider API to start transcription                           │  │
│  │  - Receive providerJobID                                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              v                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              6. Create Records in CoreAPI                             │  │
│  │  A. Create Transcript (status: "pending")                             │  │
│  │     - providerJobID stored for later polling                          │  │
│  │  B. Submit Job to CoreAPI JobQueue                                    │  │
│  │     - scope: "transcription-poll"                                     │  │
│  │     - payload: { transcriptID, providerJobID, provider }              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              v                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              7. Cleanup Temp Files                                    │  │
│  │  - Remove downloaded MP4 immediately after AAC extraction/upload      │  │
│  │  - Keep AAC for reprocessing window (`LOCAL_AAC_CACHE_SECS`)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Configuration

```javascript
// Environment Variables for Path 2
const mediaConfig = {
  // Local storage (mounted volume or local disk)
  localBasePath: process.env.LOCAL_MEDIA_BASE_PATH || '/mnt/media',

  // DFW authoritative HTTPS source
  dfwBaseURL: process.env.DFW_MEDIA_BASE_URL,       // e.g., 'https://media.dfw.example.com'

  // Temp/local storage for processing and short-lived AAC cache
  tempBasePath: process.env.TEMP_MEDIA_PATH || '/tmp/media-processing',
  localAACCacheTTLMS: Number(process.env.LOCAL_AAC_CACHE_SECS || 86400) * 1000 // 24h default
};
```

### Media Acquisition Service

```javascript
// services/mediaAcquisition.js

/**
 * Acquire media file from available sources
 * Priority: Local AAC cache → DFW MP4
 * 
 * @param {string} mediaPath - Relative path (e.g., "shtn_1137/shtn_1137.mp4")
 * @returns {Promise<{localPath: string, source: string, isAudio: boolean}>}
 */
async function acquireMedia(mediaPath) {
  // Check for pre-extracted audio first (.aac version)
  const audioPath = mediaPath.replace(/\.mp4$/, '.aac');

  // 1. Check LOCAL AAC cache
  const localAudioPath = path.join(config.localBasePath, audioPath);
  if (await fileExists(localAudioPath)) {
    return { localPath: localAudioPath, source: 'local', isAudio: true };
  }

  // 2. Fetch MP4 from DFW (HTTPS)
  const dfwURL = `${config.dfwBaseURL}/${mediaPath}`;
  const tempPath = await downloadFromHTTPS(dfwURL, mediaPath);
  return { localPath: tempPath, source: 'dfw', isAudio: false };
}
```

### Audio Extraction

```javascript
// services/audioExtraction.js

/**
 * Extract AAC audio from MP4 video (lossless passthrough)
 * 
 * @param {string} inputPath - Path to MP4 file
 * @returns {Promise<string>} - Path to extracted AAC file
 */
async function extractAudio(inputPath) {
  const outputPath = inputPath.replace(/\.mp4$/, '.aac');
  
  // ffmpeg -i input.mp4 -vn -acodec copy output.aac
  // -vn = no video
  // -acodec copy = passthrough (no re-encoding)
  await execAsync(`ffmpeg -i "${inputPath}" -vn -acodec copy "${outputPath}"`);
  
  return outputPath;
}
```

### Provider Job Submission

```javascript
// services/providerSubmission.js

/**
 * Upload audio and submit transcription job to provider
 * 
 * @param {string} audioPath - Path to audio file
 * @param {string} provider - 'assemblyai' or 'deepgram'
 * @param {object} options - Provider-specific options
 * @returns {Promise<{providerJobID: string, estimatedDuration: number}>}
 */
async function submitToProvider(audioPath, provider, options = {}) {
  if (provider === 'assemblyai') {
    return await submitToAssemblyAI(audioPath, options);
  } else if (provider === 'deepgram') {
    return await submitToDeepGram(audioPath, options);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

async function submitToAssemblyAI(audioPath, options) {
  // 1. Upload audio file
  const uploadResponse = await axios.post(
    'https://api.assemblyai.com/v2/upload',
    fs.createReadStream(audioPath),
    {
      headers: {
        'authorization': config.assemblyai.apiKey,
        'content-type': 'application/octet-stream'
      }
    }
  );
  const uploadURL = uploadResponse.data.upload_url;
  
  // 2. Submit transcription job
  const transcriptResponse = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    {
      audio_url: uploadURL,
      speaker_labels: options.speakerLabels ?? true,
      language_code: options.languageCode ?? 'en_us'
    },
    {
      headers: { 'authorization': config.assemblyai.apiKey }
    }
  );
  
  return {
    providerJobID: transcriptResponse.data.id,
    estimatedDuration: transcriptResponse.data.audio_duration
  };
}
```

### CoreAPI Integration

After submitting to the transcription provider:

1. **Create Transcript Record** (status: "pending")
   ```javascript
   const transcript = await coreApiClient.createTranscript({
     customerID,
     mediaID,
     externalMediaID,
     providerName: provider,
     providerJobID,
     status: 'pending',
     fullText: ''  // Will be populated when job completes
   });
   ```

2. **Submit Polling Job to CoreAPI JobQueue**
   ```javascript
   const job = await coreApiClient.submitJob({
     scope: 'transcription-poll',
     payload: {
       transcriptID: transcript._id,
       providerJobID,
       providerJobIDs, // present when chunking submits multiple jobs
       chunkMap,       // present when chunking is enabled
       provider,
       customerID
     },
     timeoutSeconds: 7200,  // 2 hour max for long recordings
     fingerprint: `transcription-${providerJobID}`
   });
   ```

3. **Finalize Poll Completion Payload**
   - Poll-completion handler posts the completed provider payload to:
     - `POST /v1/ingest/transcription-complete?customerID=...`
   - Non-chunked completion body includes:
     - `transcriptID`, `provider`, `providerResponse`
   - Chunked completion body includes:
     - `transcriptID`, `provider`, `chunkResponses`, `chunkMap`
   - Service behavior:
     - Parses provider response(s)
     - Reassembles chunked responses into original timeline when chunking was used
     - Updates transcript with full text/provider metadata and `status: completed`
     - Creates utterances with remapped timestamps

### Transcript Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job submitted, waiting for provider |
| `processing` | Provider is actively transcribing |
| `completed` | Transcription complete, utterances stored |
| `failed` | Transcription failed |
| `cancelled` | Job was cancelled |

### POST /v1/ingest/caption-file

Import a transcript from an SRT or VTT caption file.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| customerID | string | Yes | Customer identifier |

**Request Body:**
```json
{
  "format": "srt",
  "mediaID": "media_01ABC123",
  "externalMediaID": "shtn_1137",
  "isAuthoritativeCaption": true,
  "captionContent": "1\n00:00:00,000 --> 00:00:05,000\nWelcome to the meeting.\n\n2\n..."
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "transcriptID": "01ABC123...",
  "summary": {
    "utteranceCount": 156,
    "speakerCount": 1,
    "durationMS": 3600000,
    "source": "srt"
  }
}
```

---

## Data Mapping

### AssemblyAI → Internal Format

| AssemblyAI Field | Internal Field | Notes |
|------------------|----------------|-------|
| `utterances[].speaker` | `speakerOriginal` | "A", "B", etc. |
| `utterances[].text` | `textOriginal` | Full utterance text |
| `utterances[].start` | `startMS` | Already in milliseconds |
| `utterances[].end` | `endMS` | Already in milliseconds |
| `utterances[].confidence` | `confidence` | 0-1 score |
| (calculated) | `segmentIndex` | 0-based index |
| `id` | `providerMeta.id` | Provider job ID |
| `status` | `providerMeta.status` | "completed", etc. |
| `confidence` | `providerMeta.confidence` | Overall confidence |
| `audio_duration` | `providerMeta.audio_duration` | Duration in seconds |

### DeepGram → Internal Format

| DeepGram Field | Internal Field | Notes |
|----------------|----------------|-------|
| `results.utterances[].speaker` | `speakerOriginal` | Numeric (0, 1, 2) |
| `results.utterances[].transcript` | `textOriginal` | Full utterance text |
| `results.utterances[].start` | `startMS` | Convert: × 1000 |
| `results.utterances[].end` | `endMS` | Convert: × 1000 |
| `results.utterances[].confidence` | `confidence` | 0-1 score |
| (calculated) | `segmentIndex` | 0-based index |
| `metadata.request_id` | `providerMeta.request_id` | Provider job ID |
| `metadata.created` | `providerMeta.created` | Timestamp |
| `metadata.duration` | `providerMeta.duration` | Duration in seconds |
| `metadata.channels` | `providerMeta.channels` | Audio channels |

### SRT → Internal Format

| SRT Field | Internal Field | Notes |
|-----------|----------------|-------|
| (none) | `speakerOriginal` | "CAPTION" (default) |
| Caption text | `textOriginal` | Cue content |
| Start timecode | `startMS` | Convert from HH:MM:SS,mmm |
| End timecode | `endMS` | Convert from HH:MM:SS,mmm |
| (none) | `confidence` | null (human-generated) |
| Cue number | `segmentIndex` | 0-based (cue# - 1) |

---

## Sample Test Data

The following sample files are available in `/docs/` for testing:

| File | Provider | Size | Notes |
|------|----------|------|-------|
| `shtn_1137_assemblyai.json` | AssemblyAI | Small | Trimmed for quick testing |
| `shtn_1137_assemblyai.json.full` | AssemblyAI | Large | Full response |
| `shtn_1137_deepgram.json` | DeepGram | Small | Trimmed for quick testing |
| `shtn_1137_deepgram.json.full` | DeepGram | Large | Full response |
| `shtn_1137_revai.json.full` | Rev.ai | Large | Full response |
| `sample-caption.srt` | SRT | Small | Example caption file |

---

## Dependencies

### Runtime Dependencies
- `fastify` - Web framework
- `@fastify/cors` - CORS support
- `ulid` - ID generation
- `axios` or `undici` - HTTP client for CoreAPI and providers

### System Dependencies (Path 2)
- `ffmpeg` - Audio extraction from video (must be installed on system)

### Development Dependencies
- `nodemon` - Hot reload for development
- `tap` or `mocha` - Testing framework

### External Dependencies
- CoreAPI running on port 7001
- AssemblyAI API key (for Path 2)
- DeepGram API key (for Path 2)
- DFW media server access (for Path 2 media fetch)
- ffmpeg installed on system (for Path 2 audio extraction)

---

## Configuration

### Environment Variables

```bash
# Server
SERVER_PORT=7002
SERVER_HOST=0.0.0.0
LOG_LEVEL=info

# CoreAPI
CORE_API_BASE_URL=http://localhost:7001/v1
CORE_API_KEY=your-api-key

# Transcription Providers
ASSEMBLYAI_API_KEY=your-assemblyai-key
ASSEMBLYAI_BASE_URL=https://api.assemblyai.com/v2         # Optional, uses default if not set

DEEPGRAM_API_KEY=your-deepgram-key
DEEPGRAM_BASE_URL=https://api.deepgram.com/v1             # Optional, uses default if not set

# Media Acquisition
LOCAL_MEDIA_BASE_PATH=/mnt/media                          # Local/mounted media storage
TEMP_MEDIA_PATH=/tmp/media-processing                     # Temp storage for downloads/extraction
LOCAL_AAC_CACHE_SECS=86400                                # Keep extracted AAC around for 24h

# DFW Authoritative HTTP Server
DFW_MEDIA_BASE_URL=https://media.dfw.example.com
DFW_TEST_FILE_PATH=test/health-check.mp4                  # Optional, for connection testing
```

### Connection Testing

Test connectivity to all external services:

```bash
# CLI method
npm run test:connections

# Or with options
node src/cli/test-connections.js --all           # Test all services (default)
node src/cli/test-connections.js --coreapi       # Test CoreAPI only
node src/cli/test-connections.js --dfw           # Test DFW HTTP only
node src/cli/test-connections.js --assemblyai    # Test AssemblyAI only
node src/cli/test-connections.js --deepgram      # Test DeepGram only
node src/cli/test-connections.js --json          # Output as JSON
node src/cli/test-connections.js --quiet         # Only show failures

# API method (when server is running)
curl http://localhost:7002/v1/health/connections
curl http://localhost:7002/v1/health/connections/dfw
curl http://localhost:7002/v1/health/connections/assemblyai
curl http://localhost:7002/v1/health/connections/deepgram
curl http://localhost:7002/v1/health/connections/coreapi
```

### Config File (appConfig.json)

```json
{
  "server": {
    "port": 7002,
    "host": "0.0.0.0"
  },
  "coreApi": {
    "baseUrl": "http://localhost:7001/v1",
    "apiKey": "your-api-key",
    "timeout": 30000
  },
  "providers": {
    "assemblyai": {
      "apiKey": "your-assemblyai-key",
      "baseUrl": "https://api.assemblyai.com/v2"
    },
    "deepgram": {
      "apiKey": "your-deepgram-key",
      "baseUrl": "https://api.deepgram.com/v1"
    }
  }
}
```

---

## Success Criteria

Phase 1 is complete when:

1. **Path 1 works end-to-end**: Submit AssemblyAI or DeepGram JSON → transcript and utterances stored in CoreAPI
2. **Path 2 is functional**: Submit media URL → job submitted to provider → webhook/poll receives result → stored in CoreAPI
3. **Path 3 works end-to-end**: Submit SRT content → transcript and utterances stored in CoreAPI
4. **All parsers handle edge cases**: Empty segments, missing speakers, malformed timestamps
5. **Editable-field baseline is correct**: `textOriginal/textModified` and `speakerOriginal/speakerModified` initialized consistently
6. **Silence preprocessing is enforced**: Every Path 2 file has persisted silence analysis metadata
7. **Re-timing is accurate**: Chunked provider output maps correctly back to original media timeline
8. **Tests pass**: Unit tests for parsers, silence/re-timing logic, integration tests for routes
9. **Documentation is complete**: All endpoints documented with examples

---

## Next Steps (After Phase 1)

1. Validate stored transcripts against sample agenda data (manual)
2. Begin Phase 2: AI Timeline Generation design
3. Evaluate AI provider options with real transcript data
4. Estimate token costs for typical meeting lengths
