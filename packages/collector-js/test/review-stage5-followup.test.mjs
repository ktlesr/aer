// Independent Stage 5 follow-up: synthetic stores, controlled barriers, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentEvidenceRecorder } from '../dist/index.js';
import { fileQueueStore } from '../dist/file-store.js';
const barrier = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const recorder = store => new AgentEvidenceRecorder({
  baseUrl: 'http://localhost', apiKey: 'synthetic', maxRetries: 0,
  delivery: { store },
  fetchImpl: async url => Response.json(url.endsWith('/runs')
    ? { run: { id: 'review_run' } }
    : { event: { id: 'review_event' }, redaction: { findingsCount: 0 } }),
});
test('shutdown must count an enqueue whose durable save is in progress', async () => {
  const entered = barrier(), release = barrier();
  const r = recorder({ load: async () => null, save: async () => { entered.resolve(); await release.promise; } });
  const run = await r.startRun({ agentName: 'review' });
  const adding = run.enqueue({ type: 'tool_call', title: 'review' });
  await entered.promise;
  const flushed = await r.flush(0);
  const stopped = await r.shutdown(0);
  release.resolve();
  await adding;
  assert.equal(flushed.pending, 1);
  assert.equal(stopped.pending, 1);
});
test('an implicit load finishing after shutdown must not admit a new write', async () => {
  const entered = barrier(), release = barrier();
  const r = recorder({ load: async () => { entered.resolve(); await release.promise; return null; }, save: async () => {} });
  const run = await r.startRun({ agentName: 'review' });
  const adding = run.enqueue({ type: 'tool_call', title: 'review' });
  await entered.promise;
  await r.shutdown(0);
  release.resolve();
  await assert.rejects(adding, e => e.code === 'recorder_closed');
});
test('file store must attempt a fresh save after a recoverable filesystem failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aer-review-followup-'));
  const parent = join(dir, 'parent');
  try {
    await writeFile(parent, 'synthetic');
    const store = fileQueueStore(join(parent, 'queue.json'));
    const state = { version: 1, items: [], failedRuns: [] };
    await assert.rejects(store.save(state));
    await unlink(parent);
    await mkdir(parent);
    await store.save(state);
    assert.equal((await stat(join(parent, 'queue.json'))).isFile(), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
