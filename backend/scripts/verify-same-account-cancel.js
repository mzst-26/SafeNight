#!/usr/bin/env node

const http = require('http');

function buildToken(sub) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub, iat: Math.floor(Date.now() / 1000) });
  return `${header}.${payload}.x`;
}

function requestStream({ seq, token }) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: '/api/safe-routes/stream?origin_lat=51.5074&origin_lng=-0.1278&dest_lat=51.5150&dest_lng=-0.1200&max_distance=20',
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        'x-search-client': 'same-account-check',
        'x-search-seq': String(seq),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        const cancelled = body.includes('SEARCH_CANCELLED');
        const done = body.includes('event: done');
        const queued = body.includes('queued');
        resolve({ seq, status: res.statusCode || 0, cancelled, done, queued, sample: body.slice(0, 350) });
      });
    });

    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      resolve({ seq, status: 0, cancelled: false, done: false, queued: false, error: err.message });
    });
    req.end();
  });
}

async function main() {
  const token = buildToken('same-account-check-user');
  const jobs = [];

  jobs.push(requestStream({ seq: 1, token }));
  await new Promise((r) => setTimeout(r, 250));
  jobs.push(requestStream({ seq: 2, token }));
  await new Promise((r) => setTimeout(r, 250));
  jobs.push(requestStream({ seq: 3, token }));

  const results = await Promise.all(jobs);
  console.log(JSON.stringify(results, null, 2));

  const latest = results.find((r) => r.seq === 3);
  const old = results.filter((r) => r.seq !== 3);
  const oldCancelled = old.every((r) => r.cancelled);
  const latestNotCancelled = latest && !latest.cancelled;

  if (oldCancelled && latestNotCancelled) {
    console.log('PASS: Older same-account searches were cancelled; latest continued.');
    process.exit(0);
  }

  console.log('FAIL: Same-account cancellation behavior not as expected.');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
