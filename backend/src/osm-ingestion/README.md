# SafeNight OSM Ingestion Service

Daily UK OSM download, filter to safety-relevant features, and serve via HTTP API.

## Quick Start

```bash
cd backend/src/osm-ingestion
npm install
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3006 | API port |
| `DATA_DIR` | `./data` | Working directory |
| `PBF_URL` | Geofabrik GB | OSM PBF download URL |
| `INGESTION_SCHEDULE` | `0 3 * * *` | Cron schedule |
| `ADMIN_API_KEY` | — | Admin API key |
| `MIN_FEATURE_COUNT` | 100000 | Minimum features for valid dataset |
| `MAX_AGE_HOURS` | 48 | Max dataset age before stale |
| `OSMIUM_PATH` | `osmium` | Path to osmium binary |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health + dataset freshness |
| `/data/bbox` | GET | Query by bbox (`south,west,north,east`) |
| `/data/stats` | GET | Dataset statistics |
| `/admin/trigger` | POST | Manual ingestion (requires `X-Admin-Key`) |

## Daily Pipeline

1. Download GB PBF from Geofabrik
2. Filter with `osmium tags-filter`
3. Normalize to compact JSONL
4. Build Flatbush R-tree spatial index
5. Atomically publish

## Tests

```bash
npm test
```

## Rollback

Set `OSM_INGESTION_URL=` empty in Safety Compute Service to fall back to live Overpass.
