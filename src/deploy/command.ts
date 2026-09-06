import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createProcessInvocation } from '../package-managers.js';
import { PromptCancelledError } from '../errors.js';
import { SecretRedactor } from '../setup/redaction.js';

export interface DeploymentCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  /** Machine-readable and credential output must never be streamed. */
  capture?: boolean;
  timeoutMs?: number;
}
export type DeploymentRunner = (command: DeploymentCommand) => Promise<string>;

export class DeploymentCommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
  ) {
    super(message);
  }
}

export function createDeploymentRunner(
  redactor: SecretRedactor,
  onOutput: (line: string) => void,
  signal: AbortSignal,
): DeploymentRunner {
  return (spec) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new PromptCancelledError('Deployment cancelled.'));
        return;
      }
      const invocation = createProcessInvocation(spec.command, spec.args);
      const child = spawn(invocation.command, invocation.args, {
        cwd: spec.cwd,
        env: spec.env ?? process.env,
        detached: !spec.interactive && process.platform !== 'win32',
        stdio: spec.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let timedOut = false;
      let overflow = false;
      const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
      const pending = ['', ''];
      const emit = (index: number, text: string, flush = false) => {
        if (spec.capture) return;
        pending[index] += text;
        const lines = (pending[index] ?? '').split(/[\r\n]/u);
        pending[index] = lines.pop()!;
        for (const line of lines) if (line) onOutput(redactor.redact(line));
        // Never split an arbitrarily long line through a secret.
        if (pending[index].length > 128_000)
          pending[index] = '[Long provider output omitted]';
        if (flush && pending[index]) onOutput(redactor.redact(pending[index]));
      };
      const kill = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          }).on('error', () => child.kill());
        } else {
          try {
            process.kill(spec.interactive ? child.pid : -child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      };
      child.stdout?.on('data', (data: Buffer) => {
        const text = decoders[0]!.write(data);
        stdout += text;
        if (stdout.length > 8_000_000) {
          overflow = true;
          kill();
        }
        emit(0, text);
      });
      child.stderr?.on('data', (data: Buffer) =>
        emit(1, decoders[1]!.write(data)),
      );
      signal.addEventListener('abort', kill, { once: true });
      const timer = setTimeout(
        () => {
          timedOut = true;
          kill();
        },
        spec.timeoutMs ?? 30 * 60_000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', kill);
      };
      child.once('error', () => {
        cleanup();
        reject(new Error(`${spec.command} could not be started.`));
      });
      child.once('close', (code, exitSignal) => {
        cleanup();
        emit(0, decoders[0]!.end(), true);
        emit(1, decoders[1]!.end(), true);
        if (signal.aborted || code === 130 || exitSignal === 'SIGINT')
          reject(
            new PromptCancelledError(
              'Deployment cancelled. Remote work already accepted may continue.',
            ),
          );
        else if (timedOut)
          reject(
            new Error(
              `${spec.command} timed out. Check provider state before retrying.`,
            ),
          );
        else if (overflow)
          reject(new Error(`${spec.command} exceeded the output limit.`));
        else if (code !== 0)
          reject(
            new DeploymentCommandError(
              `${spec.command} exited unsuccessfully (${code ?? exitSignal}).`,
              stdout,
            ),
          );
        else resolve(stdout.trim());
      });
    });
}
