// Independent review, round 3 (launched by Claude): five reproductions kept verbatim. Test 5 ("old save that erases…") is skipped in `pnpm test`: it requires shutdown() to return while its own save is still blocked, which contradicts test 3 (shutdown must wait for that save). Its intent is covered by the adapted test in src/delivery.test.ts; see docs/hardening/05-sdk-delivery.md §9.2.
// Independent review: synthetic fixtures, controlled barriers, no real HTTP requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentEvidenceRecorder } from '../dist/index.js';
import { fileQueueStore } from '../dist/file-store.js';

const barrier = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function recorder(store, reject = false) {
  const requests = [];
  const r = new AgentEvidenceRecorder({
    baseUrl: 'http://localhost', apiKey: 'synthetic', maxRetries: 0,
    delivery: { store },
    fetchImpl: async url => {
      requests.push(url);
      if (url.endsWith('/runs')) return Response.json({ run: { id: 'review_run' } });
      if (reject && url.endsWith('/events')) return Response.json({ error: { code: 'conflict' } }, { status: 409 });
      return Response.json({ event: { id: 'review_event' }, redaction: { findingsCount: 0 }, receipt: null });
    },
  });
  return { r, requests };
}

test('a malformed item must not permit overwriting a rejected file', async () => {
  const dir = await mkdtemp(join(process.cwd(), 'test/.review-r3-'));
  const file = join(dir, 'queue.json');
  const original = JSON.stringify({ version: 1, items: [null], failedRuns: [] });
  try {
    await writeFile(file, original);
    const { r } = recorder(fileQueueStore(file));
    await assert.rejects(r.resume());
    const run = await r.startRun({ agentName: 'review' });
    let refused = false;
    try { await run.enqueue({ type: 'tool_call', title: 'review' }); }
    catch (e) { refused = e.code === 'store_not_loaded'; }
    await r.flush(500);
    await r.shutdown(0);
    assert.equal((await readFile(file, 'utf8')) === original, true, 'rejected file was overwritten');
    assert.equal(refused, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('startRun must reject after shutdown without creating a run', async () => {
  const { r, requests } = recorder();
  await r.shutdown(0);
  let refused = false;
  try { await r.startRun({ agentName: 'review' }); }
  catch (e) { refused = e.code === 'recorder_closed'; }
  assert.equal(requests.length, 0, 'closed recorder sent a new write');
  assert.equal(refused, true);
});

test('shutdown must wait for the failed-run checkpoint before reporting a drained store', async () => {
  const entered = barrier(), release = barrier();
  let state = null;
  let saves = 0;
  const { r } = recorder({
    load: async () => state,
    save: async value => {
      if (++saves === 2) { entered.resolve(); await release.promise; }
      state = structuredClone(value);
    },
  }, true);
  const run = await r.startRun({ agentName: 'review' });
  await run.enqueue({ type: 'tool_call', title: 'review' });
  await entered.promise;
  const done = barrier();
  const closing = r.shutdown().then(value => { done.resolve('closed'); return value; });
  const premature = await Promise.race([done.promise, new Promise(resolve => setImmediate(() => resolve('waiting')))]);
  const durableFailure = state.failedRuns.includes(run.id);
  release.resolve();
  await closing;
  assert.equal(premature, 'waiting', 'shutdown returned while the failed-run checkpoint was pending');
  assert.equal(durableFailure, false, 'barrier must precede durable failure checkpoint');
});

test('shutdown must account for an explicit resume load in progress', async () => {
  const entered = barrier(), release = barrier();
  const { r } = recorder({
    load: async () => {
      entered.resolve(); await release.promise;
      return { version: 1, failedRuns: [], items: [{
        id: 'persisted', kind: 'event', runId: 'review_run',
        path: '/api/v1/runs/review_run/events', body: { type: 'tool_call', title: 'review' },
        idempotencyKey: 'persisted-key', enqueuedAt: Date.now(), background: true,
      }] };
    },
    save: async () => {},
  });
  const loading = r.resume();
  await entered.promise;
  const result = await r.shutdown(0);
  release.resolve();
  await loading;
  assert.ok(result.pending > 0, 'shutdown reported no pending work during explicit resume');
});

test('a completed shutdown must not leave an old save that erases the next recorder checkpoint', async () => {
  const entered = barrier(), release = barrier(), oldSaved = barrier();
  let state = null;
  let saves = 0;
  const store = {
    load: async () => structuredClone(state),
    save: async value => {
      const snapshot = structuredClone(value);
      const old = ++saves === 2;
      if (old) { entered.resolve(); await release.promise; }
      state = snapshot;
      if (old) oldSaved.resolve();
    },
  };
  const { r: first } = recorder(store);
  const run = await first.startRun({ agentName: 'review' });
  await run.enqueue({ type: 'tool_call', title: 'review' });
  await entered.promise;
  await first.shutdown();
  const next = new AgentEvidenceRecorder({
    baseUrl: 'http://localhost', apiKey: 'synthetic', maxRetries: 0,
    delivery: { store },
    fetchImpl: async url => {
      if (url.endsWith('/runs')) return Response.json({ run: { id: 'review_run' } });
      throw new Error('synthetic outage');
    },
  });
  await next.resume();
  const again = await next.startRun({ agentName: 'review' });
  await again.enqueue({ type: 'tool_call', title: 'review', idempotencyKey: 'next-item' });
  await next.shutdown(0);
  assert.ok(state.items.some(item => item.idempotencyKey === 'next-item'));
  release.resolve();
  await oldSaved.promise;
  assert.ok(state.items.some(item => item.idempotencyKey === 'next-item'), 'old recorder erased a durable accepted item after shutdown');
});
