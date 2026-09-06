import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { join } from 'node:path';
import { commandSpec } from './command.mjs';
import { trackProcessTree } from './process-tree.mjs';

export function exitCode(code, signal) {
  return code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1);
}

// Runtime processes inherit output. Probes capture bounded output privately;
// never print spawn errors or captured probe data, which can contain secrets.
export function runProcess(
  command,
  arguments_,
  { cwd, env, probe = false, timeout = 2000 } = {},
) {
  return new Promise((resolve) => {
    let child;
    try {
      const spec = commandSpec(command, arguments_, env);
      child = spawn(spec.command, spec.arguments_, {
        cwd,
        env,
        stdio: probe ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        windowsHide: true,
        detached: process.platform !== 'win32',
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
      });
    } catch {
      resolve({ code: 1, output: '', failed: true, interrupted: false });
      return;
    }
    let output = '';
    let interrupted;
    let failed = false;
    let forceTimer;
    let timeoutTimer;
    let stopRequest;
    const treeKills = [];
    const tree = child.pid ? trackProcessTree(child.pid) : undefined;

    const kill = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          const killer = spawn(
            join(
              process.env.SystemRoot ?? 'C:\\Windows',
              'System32',
              'taskkill.exe',
            ),
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
          treeKills.push(
            new Promise((done) => {
              killer.on('error', () => {
                child.kill();
              });
              killer.once('close', done);
            }),
          );
        } else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill(signal);
      }
    };
    const stop = (signal) => {
      if (stopRequest) return;
      stopRequest = (async () => {
        // Capture and signal descendants before their parent can exit and
        // reparent them. Repeated signals from npm/concurrently share teardown.
        if (tree) await tree.kill(signal);
        kill(signal);
        if (child.exitCode === null && child.signalCode === null) {
          forceTimer = setTimeout(() => {
            if (tree) treeKills.push(tree.kill('SIGKILL'));
            kill('SIGKILL');
          }, 1500);
        }
      })();
      treeKills.push(stopRequest);
    };
    const onInterrupt = () => {
      interrupted ??= 'SIGINT';
      stop('SIGINT');
    };
    const onTerminate = () => {
      interrupted ??= 'SIGTERM';
      stop('SIGTERM');
    };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);

    if (probe) {
      const capture = (chunk) => {
        if (failed) return;
        if (Buffer.byteLength(output) + chunk.length > 64 * 1024) {
          failed = true;
          stop('SIGKILL');
          return;
        }
        output += chunk.toString();
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      timeoutTimer = setTimeout(() => {
        failed = true;
        stop('SIGKILL');
      }, timeout);
    }
    child.on('error', () => {
      failed = true;
    });
    // 'exit' occurs before 'close': an orphan can keep inherited output pipes
    // open, so waiting for 'close' to clean up would hang indefinitely.
    child.once('exit', () => {
      tree?.stop();
      if (tree) treeKills.push(tree.kill('SIGKILL'));
      if (process.platform !== 'win32') kill('SIGKILL');
    });
    child.once('close', async (code, signal) => {
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      tree?.stop();
      // Reap remaining members of our process group when its leader exits.
      if (process.platform !== 'win32') kill('SIGKILL');
      await Promise.all(treeKills);
      resolve({
        code: interrupted
          ? exitCode(null, interrupted)
          : failed
            ? 1
            : exitCode(code, signal),
        output,
        failed,
        interrupted: Boolean(interrupted),
      });
    });
  });
}
