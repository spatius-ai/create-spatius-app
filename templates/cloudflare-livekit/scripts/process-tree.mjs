import { execFile } from 'node:child_process';
import { join } from 'node:path';

// lk puts its Python subprocess in a separate process group. Remember the
// descendant identities while lk is alive so an unexpected leader exit cannot
// leave that group behind. ps reads only process IDs and start times, not argv.
export function trackProcessTree(rootPid) {
  const known = new Map();
  let pending;
  let stopped = false;
  const windows = process.platform === 'win32';

  const snapshot = () => {
    pending ??= new Promise((resolve) => {
      execFile(
        windows
          ? join(
              process.env.SystemRoot ?? 'C:\\Windows',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe',
            )
          : '/bin/ps',
        windows
          ? [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Where-Object { $_.CreationDate } | ForEach-Object { "{0} {1} {2}" -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToFileTimeUtc() }',
            ]
          : ['-A', '-o', 'pid=,ppid=,lstart='],
        {
          timeout: windows ? 3000 : 1000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout) => {
          const rows = error
            ? []
            : stdout
                .trim()
                .split('\n')
                .map((line) => {
                  const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
                  return match
                    ? {
                        pid: Number(match[1]),
                        parent: Number(match[2]),
                        identity: match[3],
                      }
                    : null;
                })
                .filter(Boolean);
          const descendants = new Set([rootPid]);
          for (const row of rows) {
            if (known.get(row.pid) === row.identity) descendants.add(row.pid);
          }
          let changed = true;
          while (changed) {
            changed = false;
            for (const row of rows) {
              if (descendants.has(row.parent) && !descendants.has(row.pid)) {
                descendants.add(row.pid);
                changed = true;
              }
            }
          }
          known.clear();
          for (const row of rows) {
            if (row.pid !== rootPid && descendants.has(row.pid))
              known.set(row.pid, row.identity);
          }
          resolve([...known.keys()].reverse());
        },
      );
    })
      .catch(() => [])
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  // Windows retains the creation-time ParentProcessId even after parent exit;
  // one shutdown snapshot suffices. POSIX reparents orphans, requiring tracking.
  const timer = windows
    ? undefined
    : setInterval(() => {
        if (!stopped) void snapshot();
      }, 100);
  timer?.unref();
  return {
    async kill(signal) {
      // A polling snapshot may predate a just-spawned grandchild. Refresh it
      // before signalling its parent, while that ancestry is still observable.
      if (pending) await pending;
      for (const pid of await snapshot()) {
        try {
          process.kill(pid, signal);
        } catch {
          /* Already exited. */
        }
      }
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
