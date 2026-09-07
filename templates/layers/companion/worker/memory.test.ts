/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { memoryContext, memoryRoute, type MemoryDatabase } from './memory.js';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL('../migrations/0001_memory.sql', import.meta.url),
      'utf8',
    ),
  );
  const DB: MemoryDatabase = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first<T>() {
              return Promise.resolve(
                (sqlite.prepare(sql).get(...values) ?? null) as T | null,
              );
            },
            run() {
              return Promise.resolve(sqlite.prepare(sql).run(...values));
            },
          };
        },
      };
    },
  };
  return {
    env: {
      LIVEKIT_API_SECRET: 'test-only-memory-signing-key',
      DB,
    } as CloudflareBindings & { DB: MemoryDatabase },
    close: () => sqlite.close(),
  };
}
const request = (
  method: string,
  cookie?: string,
  token?: string,
  body?: object,
  character = 'friend',
) =>
  new Request(`https://app.test/api/memory?character=${character}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
describe('anonymous companion memory', () => {
  it('isolates visitors and characters and rejects writes from a cleared session', async () => {
    const { env, close } = setup();
    try {
      const context = await memoryContext(request('GET'), env);
      const cookie = context.cookie!.split(';')[0];
      const token = (context.metadata!.memory as { token: string }).token;
      const append = () =>
        memoryRoute(
          request('POST', undefined, token, {
            id: 'turn-1',
            role: 'user',
            text: 'My name is River.',
          }),
          env,
        );
      expect((await append())?.status).toBe(200);
      expect((await append())?.status).toBe(200);
      const own: { size: number } = await (await memoryRoute(
        request('GET', cookie),
        env,
      ))!.json();
      expect(own.size).toBe('My name is River.'.length);
      expect(await (await memoryRoute(request('GET'), env))!.json()).toEqual({
        size: 0,
      });
      expect(
        await (await memoryRoute(
          request('GET', cookie, undefined, undefined, 'explorer'),
          env,
        ))!.json(),
      ).toEqual({ size: 0 });
      expect((await memoryRoute(request('DELETE', cookie), env))!.status).toBe(
        200,
      );
      expect((await append())!.ok).toBe(false);
      expect(
        await (await memoryRoute(request('GET', cookie), env))!.json(),
      ).toEqual({ size: 0 });
      expect(
        (await memoryRoute(request('GET', undefined, token + 'tampered'), env))!
          .ok,
      ).toBe(false);
    } finally {
      close();
    }
  });
  it('bounds history and keeps concurrent writes', async () => {
    const { env, close } = setup();
    try {
      const context = await memoryContext(request('GET'), env);
      const token = (context.metadata!.memory as { token: string }).token;
      await Promise.all(
        [0, 1, 2].map((index) =>
          memoryRoute(
            request('POST', undefined, token, {
              id: String(index),
              role: 'user',
              text: 'x'.repeat(2500),
            }),
            env,
          ),
        ),
      );
      const value: { turns: { text: string }[] } = await (await memoryRoute(
        request('GET', undefined, token),
        env,
      ))!.json();
      expect(value.turns).toHaveLength(2);
      expect(
        value.turns.reduce((n, turn) => n + turn.text.length, 0),
      ).toBeLessThanOrEqual(6000);
    } finally {
      close();
    }
  });
});
