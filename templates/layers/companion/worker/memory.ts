import { signCapability, verifyCapability } from './capability.js';
import data from '../agent/src/scenario.json';
type Turn = { id: string; role: 'user' | 'assistant'; text: string };
type Memory = { generation: number; turns: Turn[]; seen: string[] };
export interface MemoryDatabase {
  prepare(sql: string): {
    bind(...values: (string | number)[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}
type Environment = CloudflareBindings & { DB?: MemoryDatabase };
const empty = (): Memory => ({ generation: 0, turns: [], seen: [] });
function database(env: Environment): MemoryDatabase {
  if (!env.DB) throw new Error('Memory database unavailable');
  return env.DB;
}
async function read(
  env: Environment,
  key: string,
): Promise<{ revision: number; memory: Memory }> {
  const record = await database(env)
    .prepare(
      'SELECT revision, payload FROM companion_memory WHERE memory_key = ?',
    )
    .bind(key)
    .first<{ revision: number; payload: string }>();
  return record
    ? {
        revision: record.revision,
        memory: JSON.parse(record.payload) as Memory,
      }
    : { revision: -1, memory: empty() };
}
async function update(
  env: Environment,
  key: string,
  change: (memory: Memory) => Memory,
): Promise<Memory> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { revision, memory } = await read(env, key);
    const next = change(memory);
    // RETURNING distinguishes a successful compare-and-swap from a concurrent write.
    const changed =
      revision < 0
        ? await database(env)
            .prepare(
              'INSERT INTO companion_memory (memory_key, revision, payload) VALUES (?, 0, ?) ON CONFLICT (memory_key) DO NOTHING RETURNING revision',
            )
            .bind(key, JSON.stringify(next))
            .first()
        : await database(env)
            .prepare(
              'UPDATE companion_memory SET revision = revision + 1, payload = ? WHERE memory_key = ? AND revision = ? RETURNING revision',
            )
            .bind(JSON.stringify(next), key, revision)
            .first();
    if (changed) return next;
  }
  throw new Error('Memory is busy; try again');
}
async function visitor(
  request: Request,
  env: Environment,
): Promise<{ id: string; cookie?: string }> {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('spatius_visitor='))
    ?.slice('spatius_visitor='.length);
  if (token) {
    try {
      const claims = await verifyCapability(
        env.LIVEKIT_API_SECRET,
        token,
        'visitor',
      );
      if (typeof claims.id === 'string') return { id: claims.id };
    } catch {
      /* Issue a new anonymous identity. */
    }
  }
  const id = crypto.randomUUID();
  const signed = await signCapability(
    env.LIVEKIT_API_SECRET,
    { purpose: 'visitor', id },
    365 * 86400,
  );
  return {
    id,
    cookie: `spatius_visitor=${signed}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  };
}
function character(request: Request): string {
  const id = new URL(request.url).searchParams.get('character') ?? 'friend';
  if (!data.characters.some((item) => item.id === id))
    throw new Error('Unknown character');
  return id;
}
export async function memoryContext(
  request: Request,
  env: Environment,
): Promise<{ metadata?: Record<string, unknown>; cookie?: string }> {
  const user = await visitor(request, env);
  const selected = character(request);
  const key = `${user.id}:${selected}:en`;
  let memory: Memory;
  try {
    ({ memory } = await read(env, key));
  } catch {
    return {
      metadata: { character: selected, memoryUnavailable: true },
      cookie: user.cookie,
    };
  }
  const token = await signCapability(env.LIVEKIT_API_SECRET, {
    purpose: 'memory',
    key,
    generation: memory.generation,
  });
  return {
    metadata: { character: selected, memory: { token } },
    cookie: user.cookie,
  };
}
export async function memoryRoute(
  request: Request,
  env: Environment,
): Promise<Response | undefined> {
  if (new URL(request.url).pathname !== '/api/memory') return undefined;
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  try {
    const authorization = request.headers.get('authorization');
    if (authorization) {
      const claims = await verifyCapability(
        env.LIVEKIT_API_SECRET,
        authorization.replace(/^Bearer /, ''),
        'memory',
      );
      if (
        typeof claims.key !== 'string' ||
        typeof claims.generation !== 'number'
      )
        return json({ error: 'Invalid memory authorization' }, 403);
      if (request.method === 'GET') {
        const { memory } = await read(env, claims.key);
        if (memory.generation !== claims.generation)
          return json({ error: 'Memory was cleared' }, 409);
        return json({ turns: memory.turns });
      }
      if (request.method !== 'POST')
        return json({ error: 'Method not allowed' }, 405);
      const body: Turn = await request.json();
      if (
        typeof body.id !== 'string' ||
        body.id.length > 128 ||
        !body.id ||
        !['user', 'assistant'].includes(body.role) ||
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        body.text.length > 6000
      )
        return json({ error: 'Invalid turn' }, 400);
      await update(env, claims.key, (memory) => {
        if (memory.generation !== claims.generation)
          throw new Error('Memory was cleared');
        if (memory.seen.includes(body.id)) return memory;
        const turns = [
          ...memory.turns,
          { id: body.id, role: body.role, text: body.text },
        ];
        while (turns.reduce((sum, turn) => sum + turn.text.length, 0) > 6000)
          turns.shift();
        return {
          ...memory,
          turns,
          seen: [...memory.seen.slice(-127), body.id],
        };
      });
      return json({ ok: true });
    }
    if (!['GET', 'DELETE'].includes(request.method))
      return json({ error: 'Method not allowed' }, 405);
    const origin = request.headers.get('origin');
    if (
      request.method === 'DELETE' &&
      origin &&
      origin !== new URL(request.url).origin
    )
      return json({ error: 'Invalid origin' }, 403);
    const user = await visitor(request, env);
    if (user.cookie) headers.set('set-cookie', user.cookie);
    const key = `${user.id}:${character(request)}:en`;
    if (request.method === 'DELETE') {
      await update(env, key, (memory) => ({
        generation: memory.generation + 1,
        turns: [],
        seen: [],
      }));
      return json({ ok: true });
    }
    const { memory } = await read(env, key);
    return json({
      size: memory.turns.reduce((sum, turn) => sum + turn.text.length, 0),
    });
  } catch {
    return json({ error: 'Memory unavailable or authorization expired.' }, 503);
  }
}
