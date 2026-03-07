#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.STRESS_BASE_URL || 'http://localhost:3002',
    mode: process.env.STRESS_MODE || 'stream', // stream | json
    concurrency: Number(process.env.STRESS_CONCURRENCY || 12),
    requests: Number(process.env.STRESS_REQUESTS || 120),
    timeoutMs: Number(process.env.STRESS_TIMEOUT_MS || 120000),
    maxDistanceKm: Number(process.env.STRESS_MAX_DISTANCE_KM || 4),
    centerLat: Number(process.env.STRESS_CENTER_LAT || 51.5074),
    centerLng: Number(process.env.STRESS_CENTER_LNG || -0.1278),
    spreadDeg: Number(process.env.STRESS_SPREAD_DEG || 0.01),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, value] = token.slice(2).split('=');
    if (value == null) continue;

    switch (key) {
      case 'baseUrl':
      case 'mode':
        args[key] = value;
        break;
      case 'concurrency':
      case 'requests':
      case 'timeoutMs':
      case 'maxDistanceKm':
      case 'centerLat':
      case 'centerLng':
      case 'spreadDeg':
        args[key] = Number(value);
        break;
      default:
        break;
    }
  }

  if (!['stream', 'json'].includes(args.mode)) {
    throw new Error(`Invalid --mode=${args.mode}. Use stream or json.`);
  }

  return args;
}

function base64UrlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function buildFakeJwt(userId) {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlEncode({ sub: userId, iat: Math.floor(Date.now() / 1000) });
  return `${header}.${payload}.x`;
}

function randomOffset(spreadDeg) {
  return (Math.random() * 2 - 1) * spreadDeg;
}

function buildRequestUrl(args, requestId) {
  const originLat = args.centerLat + randomOffset(args.spreadDeg);
  const originLng = args.centerLng + randomOffset(args.spreadDeg);
  const destLat = args.centerLat + randomOffset(args.spreadDeg);
  const destLng = args.centerLng + randomOffset(args.spreadDeg);
  const useWaypoint = Math.random() < 0.35;

  const path = args.mode === 'stream' ? '/api/safe-routes/stream' : '/api/safe-routes';
  const url = new URL(path, args.baseUrl);
  url.searchParams.set('origin_lat', originLat.toFixed(6));
  url.searchParams.set('origin_lng', originLng.toFixed(6));
  url.searchParams.set('dest_lat', destLat.toFixed(6));
  url.searchParams.set('dest_lng', destLng.toFixed(6));
  url.searchParams.set('max_distance', String(args.maxDistanceKm));

  if (useWaypoint) {
    const wpLat = args.centerLat + randomOffset(args.spreadDeg * 0.7);
    const wpLng = args.centerLng + randomOffset(args.spreadDeg * 0.7);
    url.searchParams.set('waypoint_lat', wpLat.toFixed(6));
    url.searchParams.set('waypoint_lng', wpLng.toFixed(6));
  }

  url.searchParams.set('stress_req_id', String(requestId));
  return url;
}

function makeRequest(args, requestId) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const url = buildRequestUrl(args, requestId);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const userId = `stress-user-${requestId}-${Math.floor(Math.random() * 1e9)}`;
    const searchId = `stress-search-${requestId}-${Date.now()}`;

    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: args.mode === 'stream' ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${buildFakeJwt(userId)}`,
        'x-search-id': searchId,
      },
    };

    const req = transport.request(options, (res) => {
      const statusCode = res.statusCode || 0;
      let bytes = 0;
      let body = '';
      let doneEventSeen = false;
      let errorEventSeen = false;
      let cancelledSeen = false;

      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (args.mode === 'stream') {
          const text = chunk.toString('utf8');
          body += text;
          if (body.includes('event: done')) doneEventSeen = true;
          if (body.includes('event: error')) errorEventSeen = true;
          if (body.includes('SEARCH_CANCELLED')) cancelledSeen = true;
          if (body.length > 20000) body = body.slice(-10000);
        }
      });

      res.on('end', () => {
        const elapsedMs = Date.now() - startedAt;
        const okByStatus = statusCode >= 200 && statusCode < 300;
        const streamOk = args.mode !== 'stream' || (doneEventSeen && !errorEventSeen);
        const streamErrMatch = body.match(/"message"\s*:\s*"([^"]+)"/);
        const streamErr = errorEventSeen
          ? (streamErrMatch ? streamErrMatch[1] : 'stream_error_event')
          : null;

        resolve({
          ok: okByStatus && streamOk,
          statusCode,
          elapsedMs,
          bytes,
          timeout: false,
          cancelled: cancelledSeen,
          error: streamErr,
        });
      });
    });

    req.setTimeout(args.timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      const elapsedMs = Date.now() - startedAt;
      resolve({
        ok: false,
        statusCode: 0,
        elapsedMs,
        bytes: 0,
        timeout: err && err.message === 'timeout',
        cancelled: false,
        error: err ? err.message : 'request_error',
      });
    });

    req.end();
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function runStressTest(args) {
  const summary = {
    total: args.requests,
    completed: 0,
    ok: 0,
    failed: 0,
    timeout: 0,
    cancelled: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    statusOther: 0,
    latencies: [],
    firstErrors: [],
  };

  let launched = 0;
  let inFlight = 0;

  return new Promise((resolve) => {
    const launchNext = () => {
      while (inFlight < args.concurrency && launched < args.requests) {
        launched += 1;
        inFlight += 1;

        makeRequest(args, launched)
          .then((result) => {
            summary.completed += 1;
            summary.latencies.push(result.elapsedMs);

            if (result.ok) summary.ok += 1;
            else summary.failed += 1;

            if (result.timeout) summary.timeout += 1;
            if (result.cancelled) summary.cancelled += 1;

            if (result.statusCode >= 200 && result.statusCode < 300) summary.status2xx += 1;
            else if (result.statusCode >= 400 && result.statusCode < 500) summary.status4xx += 1;
            else if (result.statusCode >= 500) summary.status5xx += 1;
            else summary.statusOther += 1;

            if (!result.ok && summary.firstErrors.length < 8) {
              summary.firstErrors.push({
                statusCode: result.statusCode,
                error: result.error,
                elapsedMs: result.elapsedMs,
              });
            }
          })
          .finally(() => {
            inFlight -= 1;
            if (summary.completed >= args.requests) {
              resolve(summary);
              return;
            }
            launchNext();
          });
      }
    };

    launchNext();
  });
}

function printSummary(args, summary, elapsedMs) {
  const sortedLatencies = [...summary.latencies].sort((a, b) => a - b);
  const rps = summary.completed > 0 ? (summary.completed / (elapsedMs / 1000)).toFixed(2) : '0.00';

  console.log('\n=== Safe Routes Stress Test Summary ===');
  console.log(`Target: ${args.baseUrl} (${args.mode})`);
  console.log(`Requests: ${summary.completed}/${summary.total} | Concurrency: ${args.concurrency}`);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(2)}s | Throughput: ${rps} req/s`);
  console.log(`OK: ${summary.ok} | Failed: ${summary.failed} | Timeouts: ${summary.timeout} | Cancelled: ${summary.cancelled}`);
  console.log(`Status: 2xx=${summary.status2xx}, 4xx=${summary.status4xx}, 5xx=${summary.status5xx}, other=${summary.statusOther}`);
  console.log(`Latency ms: p50=${percentile(sortedLatencies, 50)}, p95=${percentile(sortedLatencies, 95)}, p99=${percentile(sortedLatencies, 99)}, max=${sortedLatencies[sortedLatencies.length - 1] || 0}`);

  if (summary.firstErrors.length > 0) {
    console.log('\nFirst failures:');
    for (const failure of summary.firstErrors) {
      console.log(`- status=${failure.statusCode} elapsed=${failure.elapsedMs}ms error=${failure.error || 'none'}`);
    }
  }

  const unstable = summary.status5xx > 0 || summary.timeout > 0;
  console.log(`\nResult: ${unstable ? 'UNSTABLE under this load' : 'STABLE under this load'}`);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    console.log('Starting stress test with args:', args);
    const startedAt = Date.now();
    const summary = await runStressTest(args);
    const elapsedMs = Date.now() - startedAt;
    printSummary(args, summary, elapsedMs);

    if (summary.status5xx > 0 || summary.timeout > 0) {
      process.exitCode = 2;
    }
  } catch (err) {
    console.error('Failed to run stress test:', err.message || err);
    process.exitCode = 1;
  }
}

main();
