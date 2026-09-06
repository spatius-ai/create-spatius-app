import { describe, expect, it } from 'vitest';
import {
  createDeploymentRunner,
  DeploymentCommandError,
} from '../../src/deploy/command.js';
import { SecretRedactor } from '../../src/setup/redaction.js';
import { PromptCancelledError } from '../../src/errors.js';
import { tmpdir } from 'node:os';
function fixture() {
  const redactor = new SecretRedactor();
  redactor.add('split-secret');
  const lines: string[] = [];
  const controller = new AbortController();
  const run = createDeploymentRunner(
    redactor,
    (line) => lines.push(line),
    controller.signal,
  );
  const spec = (code: string) => ({
    command: process.execPath,
    args: ['-e', code],
    cwd: tmpdir(),
  });
  return { run, lines, controller, spec };
}
describe('deployment process runner', () => {
  it('redacts secrets across chunks and flushes unterminated output', async () => {
    const f = fixture();
    await f.run(
      f.spec(
        'process.stdout.write("split-"); setTimeout(() => {process.stdout.write("secret\\n"); process.stderr.write("done")}, 20)',
      ),
    );
    expect(f.lines).toEqual(['[REDACTED]', 'done']);
  });
  it('keeps captured credential output private and separates stderr from JSON', async () => {
    const f = fixture();
    expect(
      await f.run({
        ...f.spec(
          'console.error("notice"); console.log(JSON.stringify({secret:"split-secret"}))',
        ),
        capture: true,
      }),
    ).toBe('{"secret":"split-secret"}');
    expect(f.lines).toEqual([]);
  });
  it('reports failed commands without exposing captured output in their message', async () => {
    const f = fixture();
    await expect(
      f.run({
        ...f.spec('console.log("split-secret"); process.exit(1)'),
        capture: true,
      }),
    ).rejects.toBeInstanceOf(DeploymentCommandError);
    expect(f.lines).toEqual([]);
    await expect(
      f.run({ command: 'nonexistent-spatius-tool', args: [], cwd: tmpdir() }),
    ).rejects.toThrow('could not be started');
  });
  it('terminates timed out processes and cancelled processes', async () => {
    const f = fixture();
    await expect(
      f.run({ ...f.spec('setInterval(() => {}, 1000)'), timeoutMs: 50 }),
    ).rejects.toThrow('timed out');
    const pending = f.run(f.spec('setInterval(() => {}, 1000)'));
    f.controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(f.run(f.spec(''))).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
  });
  it('preserves exit-code cancellation and omits oversized lines', async () => {
    const f = fixture();
    await expect(f.run(f.spec('process.exit(130)'))).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
    await f.run(f.spec('process.stdout.write("x".repeat(200000))'));
    expect(f.lines.join('').length).toBeLessThan(128000);
  });
});
