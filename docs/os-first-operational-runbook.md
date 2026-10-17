# SafeNight OS-First Routing — Operational Runbook

## Overview

This runbook covers the operation of the OS-first safety routing system in production. It includes cap monitoring, incident response, monthly reset procedures, and troubleshooting.

## Monthly Cap Reset

### Automatic Reset
- `osSpendGuard` detects month change on the first OS API call of the new month
- Old ledger is archived (`.jsonl.archived-<timestamp>`)
- In-memory cap state resets to `OS_MONTHLY_CAP_GBP`
- No action required

### Manual Reset (Emergency)
1. SSH into the safety service instance
2. Delete the current month ledger file:
   ```bash
   rm $SAFE_ROUTES_CACHE_DIR/os-ledger/$(date +%Y-%m).jsonl
   ```
3. Restart the safety service to clear in-memory state
4. Verify in logs: `[os-spend-guard] CAP state reset for new month YYYY-MM`

## Incident Handling: Cap Breach

### Symptoms
- Users see: `Service is currently under maintanace and unavailable`
- HTTP 503 with `error: "SERVICE_UNAVAILABLE"`
- Logs show: `[os-spend-guard] CAP BREACHED: projected=...`

### Response Playbook
1. **Confirm** it's a cap breach, not a different 503:
   ```bash
   grep "CAP BREACHED" /var/log/safety-service.log
   ```

2. **Check** current spend:
   ```bash
   grep "os_spend_confirmed_gbp" /var/log/safety-service.log | tail -5
   ```

3. **Decision tree:**
   - If legitimate traffic spike → wait for month reset or request OS plan upgrade
   - If bug (e.g., runaway loop) → rollback to previous release, investigate ledger
   - If miscalculation → manual ledger adjustment (see below)

4. **Temporary override** (emergency only):
   - Set `OS_MONTHLY_CAP_GBP` higher and restart
   - This is logged as a config change

### Ledger Adjustment
```bash
# Append a correction entry
cat >> $SAFE_ROUTES_CACHE_DIR/os-ledger/2026-04.jsonl << 'EOF'
{"recordType":"confirmed","api":"os-ngd-features","transactionType":"feature_request","projectedTransactions":0,"confirmedTransactions":0,"estimatedSpendGbp":0,"confirmedSpendGbp":-50.00,"idempotencyKey":"manual-correction-$(date +%s)","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","requestContext":{"reason":"incident-response"}}
EOF
```

## Incident Handling: OS API Degradation

### Symptoms
- `osm_fallback_ratio` metric spikes
- Logs show: `[source-fusion] ... source: 'osm_fallback'`
- Routes still work but use more Overpass

### Response Playbook
1. Check OS API status page: https://status.osdatahub.co.uk
2. Verify throttle limits:
   ```bash
   grep "OS API throttled" /var/log/safety-service.log
   ```
3. If OS is down → system automatically falls back to Overpass; no action needed
4. If throttle hit → reduce request rate or upgrade plan
5. Monitor `overpass_calls_avoided` metric for recovery

## Monitoring & Alerting

### Key Metrics
| Metric | Warning Threshold | Critical Threshold |
|--------|------------------|-------------------|
| `os_cap_remaining_gbp` | < £100 | < £0 (breached) |
| `osm_fallback_ratio` | > 0.3 | > 0.8 |
| `route_latency_p95` | > 5000ms | > 10000ms |
| `os_cap_block_count` | > 0 (alert) | > 10/hour |

### Log Queries
```bash
# Cap status
grep "event.*cap_check" /var/log/safety-service.log | jq .

# Source decisions
grep "event.*source_decision" /var/log/safety-service.log | jq .

# Metrics snapshot
grep "event.*os_metrics_snapshot" /var/log/safety-service.log | jq .
```

## Deployment Checklist

- [ ] `OS_API_KEY` set and valid
- [ ] `OS_PLAN_MODE` is `premium` or `development`
- [ ] `OS_MONTHLY_CAP_GBP` is positive number
- [ ] `SAFE_ROUTES_CACHE_DIR` is writable
- [ ] Safety service starts without env validation errors
- [ ] First route request succeeds (check logs for `[os-ngd] ✅`)

## Rollback Procedure

1. Set `OS_API_KEY=` (empty) in environment
2. Restart safety service
3. System falls back to full Overpass mode
4. No user-facing impact except slightly slower routes
