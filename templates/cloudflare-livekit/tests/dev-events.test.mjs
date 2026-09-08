import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readEvents } from './dev-fixtures.mjs';

test('event polling waits for a complete trailing record', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spatius-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'events.jsonl');
  await writeFile(path, '{"type":"ready"}\n{"type":"reg');
  assert.deepEqual(await readEvents(path), [{ type: 'ready' }]);
  await appendFile(path, 'istered"}\n');
  assert.deepEqual(await readEvents(path), [
    { type: 'ready' },
    { type: 'registered' },
  ]);
  await writeFile(path, '{"type":');
  assert.deepEqual(await readEvents(path), []);
  await appendFile(path, 'broken}\n');
  await assert.rejects(readEvents(path), SyntaxError);
});
