# Automated Minutes Worker Monitoring Endpoints

Base URL: `http://localhost:7002`

This service no longer exposes ingestion Fastify endpoints. It now runs as a `@champds/cds-job-queue` worker and only exposes monitoring APIs.

## GET /health

Basic liveness/readiness check for monitoring systems.

- `200` when worker runtime is ready
- `503` when worker runtime is not ready

Example response:

```json
{
  "status": "ok",
  "timestamp": "2026-02-11T00:00:00.000Z",
  "service": "cds-automated-minutes",
  "queue": {
    "isReady": true,
    "workerID": "automated-minutes-worker-host-12345"
  }
}
```

## GET /status

Detailed runtime status for diagnostics and operational dashboards.

Example response:

```json
{
  "status": "running",
  "timestamp": "2026-02-11T00:00:00.000Z",
  "uptimeSecs": 1234,
  "queue": {
    "isReady": true,
    "startedAt": "2026-02-11T00:00:00.000Z",
    "workerID": "automated-minutes-worker-host-12345",
    "supportedScopes": [
      "transcript:ingest:provider-json",
      "transcript:ingest:caption-file",
      "transcript:transcribe:media",
      "transcription-poll",
      "transcript:enhance:captions"
    ],
    "processedJobCount": 42,
    "completedJobCount": 39,
    "failedJobCount": 2,
    "cancelledJobCount": 1,
    "activeJobCount": 0,
    "activeJobIDs": []
  }
}
```
