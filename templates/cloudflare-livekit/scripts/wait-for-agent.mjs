import { access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForAgent(path, timeout = 60_000) {
  const deadline = performance.now() + timeout;
  while (true) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (performance.now() >= deadline)
      throw new Error(
        'LiveKit agent did not register within 60 seconds. Check the agent logs, credentials, and network connection, then run dev again.',
      );
    await delay(Math.min(100, Math.max(0, deadline - performance.now())));
  }
}
