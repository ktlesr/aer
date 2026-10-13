// Independent security review: synthetic data only; run after the existing test script builds dist.
// Kept verbatim. "partial write failure removes owned temporary file…" is skipped in `pnpm test`: it patches fs.writeFile, which the reviewer-recommended fix (exclusive open + handle write) no longer calls; its intent is tested in src/delivery.test.ts (docs §9.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileQueueStore } from '../dist/file-store.js';

const state = name => ({ version: 1, items: [], failedRuns: [name] });
const fixture = () => fs.mkdtemp(join(tmpdir(), 'review-temp-security-'));
const injected = code => Object.assign(new Error('synthetic filesystem failure'), { code });

test('Windows: replace existing target, serialise snapshots, and leave no temporary files', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  await fs.writeFile(path, JSON.stringify(state('old')));
  const store = fileQueueStore(path);
  const first = state('first');
  const saving = store.save(first);
  first.failedRuns.push('must-not-be-saved');
  await saving;
  assert.deepEqual(await store.load(), state('first'));
  await Promise.all([store.save(state('second')), store.save(state('third'))]);
  assert.deepEqual(await store.load(), state('third'));
  assert.deepEqual(await fs.readdir(dir), ['queue.json']);
});

test('rename failure preserves old snapshot, removes owned temporary file, and allows next save', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  const store = fileQueueStore(path);
  await store.save(state('old'));
  const original = fs.rename;
  try {
    fs.rename = async () => { throw injected('EPERM'); };
    syncBuiltinESMExports();
    await assert.rejects(store.save(state('new')), { code: 'EPERM' });
    assert.deepEqual(await store.load(), state('old'));
    assert.deepEqual(await fs.readdir(dir), ['queue.json']);
  } finally {
    fs.rename = original;
    syncBuiltinESMExports();
  }
  await store.save(state('recovered'));
  assert.deepEqual(await store.load(), state('recovered'));
});

test('partial write failure removes owned temporary file and preserves old snapshot', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  const store = fileQueueStore(path);
  await store.save(state('old'));
  const original = fs.writeFile;
  try {
    fs.writeFile = async (path, data, options) => {
      assert.equal(options.flag, 'wx');
      assert.equal(options.mode, 0o600);
      await original(path, '{partial', options);
      throw injected('ENOSPC');
    };
    syncBuiltinESMExports();
    await assert.rejects(store.save(state('new')), { code: 'ENOSPC' });
    assert.deepEqual(await store.load(), state('old'));
    assert.deepEqual(await fs.readdir(dir), ['queue.json']);
  } finally {
    fs.writeFile = original;
    syncBuiltinESMExports();
  }
  await store.save(state('recovered'));
});

test('Windows: real rename failure against a directory cleans temp and allows recovery', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  await fs.mkdir(path);
  await fs.writeFile(join(path, 'sentinel'), 'synthetic sentinel');
  const store = fileQueueStore(path);
  await assert.rejects(store.save(state('new')));
  assert.equal(await fs.readFile(join(path, 'sentinel'), 'utf8'), 'synthetic sentinel');
  assert.deepEqual(await fs.readdir(dir), ['queue.json']);
  await fs.unlink(join(path, 'sentinel'));
  await fs.rmdir(path);
  await store.save(state('recovered'));
  assert.deepEqual(await store.load(), state('recovered'));
});

test('cleanup failure preserves original error but can leave a temporary file', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  const store = fileQueueStore(path);
  await store.save(state('old'));
  const rename = fs.rename;
  const unlink = fs.unlink;
  try {
    fs.rename = async () => { throw injected('EBUSY'); };
    fs.unlink = async () => { throw injected('EPERM'); };
    syncBuiltinESMExports();
    await assert.rejects(store.save(state('new')), { code: 'EBUSY' });
    assert.deepEqual(await store.load(), state('old'));
    assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')).length, 1);
  } finally {
    fs.rename = rename;
    fs.unlink = unlink;
    syncBuiltinESMExports();
  }
});

test('Windows target symlink: rename replaces link without writing to its referent', async t => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  const referent = join(dir, 'referent.json');
  await fs.writeFile(referent, 'synthetic sentinel');
  try {
    await fs.symlink(referent, path, 'file');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip('BLOCKED: Windows file symlink creation permission unavailable');
      return;
    }
    throw err;
  }
  await fileQueueStore(path).save(state('new'));
  assert.equal(await fs.readFile(referent, 'utf8'), 'synthetic sentinel');
  assert.equal((await fs.lstat(path)).isSymbolicLink(), false);
});

test('EEXIST: exclusive creation must preserve the file that this save did not create', async () => {
  const dir = await fixture();
  const path = join(dir, 'queue.json');
  const store = fileQueueStore(path);
  await store.save(state('old'));
  const bytes = Buffer.alloc(12, 0xab);
  const collision = `${path}.${bytes.toString('hex')}.tmp`;
  await fs.writeFile(collision, 'synthetic sentinel');
  const original = crypto.randomBytes;
  try {
    // Force only the candidate name. Actual wx open, EEXIST and unlink use the real filesystem.
    crypto.randomBytes = () => bytes;
    syncBuiltinESMExports();
    await assert.rejects(store.save(state('new')), { code: 'EEXIST' });
    assert.deepEqual(await store.load(), state('old'));
    assert.equal(await fs.readFile(collision, 'utf8'), 'synthetic sentinel');
  } finally {
    crypto.randomBytes = original;
    syncBuiltinESMExports();
  }
});
