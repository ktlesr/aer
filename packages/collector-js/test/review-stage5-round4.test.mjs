// Independent review, round 4 (launched by Claude): three reproductions kept verbatim. Test 2 deliberately demonstrates the documented hazard (it expects the loss when checkpointsPending is ignored).
// Independent round-4 review: synthetic stores, fake fetch, controlled barriers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentEvidenceRecorder } from '../dist/index.js';

const barrier = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function recorder(store, outage = false) {
  return new AgentEvidenceRecorder({
    baseUrl: 'http://localhost', apiKey: 'synthetic', maxRetries: 0,
    delivery: { store, maxRetryDelayMs: 1000 },
    fetchImpl: async url => {
      if (url.endsWith('/runs')) return Response.json({ run: { id: 'review_run' } });
      if (outage) throw new Error('synthetic outage');
      return Response.json({ event: { id: 'review_event' }, redaction: { findingsCount: 0 } });
    },
  });
}

test('untimed shutdown waits for checkpoint and permits safe sequential takeover', async () => {
  const entered = barrier(), release = barrier();
  let state = null, saves = 0;
  const store = {
    load: async () => structuredClone(state),
    save: async value => {
      const snapshot = structuredClone(value);
      if (++saves === 2) { entered.resolve(); await release.promise; }
      state = snapshot;
    },
  };
  const first = recorder(store);
  const run = await first.startRun({ agentName: 'review' });
  await run.enqueue({ type: 'tool_call', title: 'one' });
  await entered.promise;
  let returned = false;
  const closing = first.shutdown().then(result => { returned = true; return result; });
  await tick();
  assert.equal(returned, false);
  release.resolve();
  assert.equal((await closing).checkpointsPending, 0);
  const next = recorder(store, true);
  const again = await next.startRun({ agentName: 'review' });
  await again.enqueue({ type: 'tool_call', title: 'two', idempotencyKey: 'next-item' });
  await next.shutdown(0);
  await tick();
  assert.ok(state.items.some(item => item.idempotencyKey === 'next-item'));
});

test('timed shutdown exposes unsafe takeover with a blocked old checkpoint', async () => {
  const entered = barrier(), release = barrier();
  let state = null, saves = 0;
  const store = {
    load: async () => structuredClone(state),
    save: async value => {
      const snapshot = structuredClone(value);
      if (++saves === 2) { entered.resolve(); await release.promise; }
      state = snapshot;
    },
  };
  const first = recorder(store);
  const run = await first.startRun({ agentName: 'review' });
  await run.enqueue({ type: 'tool_call', title: 'one' });
  await entered.promise;
  assert.equal((await first.shutdown(0)).checkpointsPending, 1);
  // Deliberately violate the documented restriction to establish the boundary.
  const next = recorder(store, true);
  const again = await next.startRun({ agentName: 'review' });
  await again.enqueue({ type: 'tool_call', title: 'two', idempotencyKey: 'next-item' });
  await next.shutdown(0);
  assert.ok(state.items.some(item => item.idempotencyKey === 'next-item'));
  release.resolve();
  await first.flush(0);
  await tick();
  assert.equal(state.items.some(item => item.idempotencyKey === 'next-item'), false);
});

test('a second untimed shutdown must settle once active work is finished', async () => {
  let state = null;
  const store = {
    load: async () => structuredClone(state),
    save: async value => { state = structuredClone(value); },
  };
  const r = recorder(store, true);
  const run = await r.startRun({ agentName: 'review' });
  await run.enqueue({ type: 'tool_call', title: 'one' });
  const timed = await r.shutdown(0);
  assert.equal(timed.pending, 1);
  await tick(); // transport and worker have stopped; no save is still running
  let returned = false;
  r.shutdown().then(() => { returned = true; });
  await tick();
  const observed = await r.flush(0);
  assert.equal(observed.checkpointsPending, 0);
  assert.equal(r.stats().queued, 1);
  assert.equal(state.items.length, 1);
  assert.equal(returned, true, 'second shutdown waits forever for a persisted item in the stopped queue');
});
