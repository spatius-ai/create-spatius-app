import type {
  JavaScriptPackageManager,
  PythonPackageManager,
  SelectedPackageManagers,
} from '../src/package-managers.js';

export function createPackageManagers(
  javascript: JavaScriptPackageManager = 'pnpm',
  python: PythonPackageManager = 'uv',
): SelectedPackageManagers {
  const pythonRuntime = {
    argsPrefix: [],
    command: 'python3',
    displayName: 'python3',
  };

  return {
    javascript: {
      available: true,
      command: {
        argsPrefix: [],
        command: javascript,
        displayName: javascript,
      },
      name: javascript,
      version:
        javascript === 'pnpm'
          ? '11.1.2'
          : javascript === 'npm'
            ? '11.9.0'
            : '1.3.0',
    },
    python: {
      available: true,
      command:
        python === 'uv'
          ? { argsPrefix: [], command: 'uv', displayName: 'uv' }
          : {
              argsPrefix: ['-m', 'pip'],
              command: 'python3',
              displayName: 'python3 -m pip',
            },
      name: python,
      ...(python === 'pip' ? { pythonRuntime } : {}),
      version: python === 'uv' ? '0.12.9' : '26.2.1',
    },
  };
}
