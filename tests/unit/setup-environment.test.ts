import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type AtomicCredentialFileSystem,
  buildCredentialFileContents,
  inspectCredentialConfiguration,
  isPlaceholderValue,
  mergeDotenv,
  parseDotenv,
  readCredentialExamples,
  readCredentialFileState,
  validateCredentialBundle,
  validateLiveKitUrl,
  writeCredentialFilesAtomically,
} from '../../src/setup/environment.js';
import { assertSpatiusProject } from '../../src/setup/project.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spatius-env-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function atomicFileSystem(
  overrides: Partial<AtomicCredentialFileSystem> = {},
): AtomicCredentialFileSystem {
  return {
    chmod,
    lstat,
    readFile: (path) => readFile(path),
    rename,
    rm: (path) => rm(path, { force: true }),
    writeFile: (path, contents, options) => writeFile(path, contents, options),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

const credentials = {
  liveKit: {
    apiKey: 'livekit-key-value',
    apiSecret: 'livekit-secret-value',
    url: 'wss://demo.livekit.cloud',
  },
  spatius: {
    apiKey: 'spatius-key-value',
    appId: 'app-123',
    avatarId: 'avatar-123',
  },
};

function completeFiles() {
  return {
    agent:
      'LIVEKIT_URL=wss://demo.livekit.cloud\nLIVEKIT_API_KEY=livekit-key-value\nLIVEKIT_API_SECRET=livekit-secret-value\nSPATIUS_API_KEY=spatius-key-value\nSPATIUS_APP_ID=app-123\n',
    worker:
      'LIVEKIT_URL=wss://demo.livekit.cloud\nLIVEKIT_API_KEY=livekit-key-value\nLIVEKIT_API_SECRET=livekit-secret-value\nLIVEKIT_AGENT_NAME=spatius-agent\nSPATIUS_APP_ID=app-123\nSPATIUS_AVATAR_ID=avatar-123\n',
  };
}

describe('dotenv handling', () => {
  it('keeps optional voice configuration in the Worker and supports older files', () => {
    const examples = completeFiles();
    const state = {
      ...examples,
      hasManagedValues: true,
      status: 'complete' as const,
    };
    const voiceId = 'a167e0f3-df7e-4d52-a9c3-f949145efdab';
    const result = buildCredentialFileContents(state, examples, {
      ...credentials,
      voiceId,
    });
    expect(parseDotenv(result.worker).get('CARTESIA_VOICE_ID')).toBe(voiceId);
    expect(result.agent).not.toContain('CARTESIA_VOICE_ID');
    expect(inspectCredentialConfiguration(examples).status).toBe('complete');
    expect(
      inspectCredentialConfiguration({
        worker: `CARTESIA_VOICE_ID=${voiceId}\n`,
      }).hasManagedValues,
    ).toBe(true);
    expect(() =>
      validateCredentialBundle({ ...credentials, voiceId: 'bad\nvalue' }),
    ).toThrow();
  });

  it('stores optional backgrounds only in Worker configuration, and clears stale backgrounds', () => {
    const examples = completeFiles();
    const state = {
      ...examples,
      hasManagedValues: true,
      status: 'complete' as const,
    };
    const backgroundUrl = 'https://cdn.example.com/room.jpg?size=large';
    const result = buildCredentialFileContents(state, examples, {
      ...credentials,
      spatius: { ...credentials.spatius, backgroundUrl },
    });
    expect(
      parseDotenv(result.worker).get('SPATIUS_AVATAR_BACKGROUND_URL'),
    ).toBe(backgroundUrl);
    expect(result.agent).not.toContain(backgroundUrl);
    expect(inspectCredentialConfiguration(examples).status).toBe('complete');
    const cleared = buildCredentialFileContents(
      { ...state, worker: result.worker },
      examples,
      credentials,
    );
    expect(
      parseDotenv(cleared.worker).get('SPATIUS_AVATAR_BACKGROUND_URL'),
    ).toBe('');
  });

  it.each([
    'javascript:alert(1)',
    'https://user:password@example.com/image',
    'not a url',
  ])('ignores unsafe optional background %s', (backgroundUrl) => {
    const bundle = validateCredentialBundle({
      ...credentials,
      spatius: { ...credentials.spatius, backgroundUrl },
    });
    expect(bundle.spatius.backgroundUrl).toBeUndefined();
  });

  it('parses exports, comments, and quoted values without expanding them', () => {
    const values = parseDotenv(
      'export A="hello world" # comment\nB=plain # comment\nC=\'single value\'\nD="escaped\\nvalue"\n',
    );

    expect(Object.fromEntries(values)).toEqual({
      A: 'hello world',
      B: 'plain',
      C: 'single value',
      D: 'escaped\nvalue',
    });
  });

  it('detects empty and common placeholder values', () => {
    for (const value of [
      undefined,
      '',
      'your-api-key',
      'YOUR_API_KEY',
      'replace-me',
      'changeme',
      'placeholder',
      '<api-key>',
    ]) {
      expect(isPlaceholderValue(value)).toBe(true);
    }
    expect(isPlaceholderValue('real-value')).toBe(false);
  });

  it('validates URL protocols and all credential values', () => {
    expect(validateLiveKitUrl(' https://demo.livekit.cloud ')).toBe(
      'https://demo.livekit.cloud',
    );
    expect(validateLiveKitUrl('wss://demo.livekit.cloud')).toBe(
      'wss://demo.livekit.cloud',
    );
    expect(validateCredentialBundle(credentials)).toEqual(credentials);
    expect(() => validateLiveKitUrl('http://demo.livekit.cloud')).toThrow(
      /https:\/\/ or wss:\/\//u,
    );
    expect(() => validateLiveKitUrl('not a url')).toThrow(/valid/u);
    expect(() =>
      validateCredentialBundle({
        ...credentials,
        spatius: { ...credentials.spatius, apiKey: 'your-api-key' },
      }),
    ).toThrow(/non-placeholder/u);
    expect(() =>
      validateCredentialBundle({
        ...credentials,
        spatius: { ...credentials.spatius, avatarId: 'bad\u0000value' },
      }),
    ).toThrow(/control characters/u);
  });

  it('classifies missing, placeholder, complete, and inconsistent files', () => {
    expect(inspectCredentialConfiguration({})).toEqual({
      hasManagedValues: false,
      status: 'missing',
    });
    expect(
      inspectCredentialConfiguration({
        agent: 'LIVEKIT_URL=your-livekit-url\n',
        worker: 'LIVEKIT_URL=your-livekit-url\n',
      }),
    ).toEqual({ hasManagedValues: true, status: 'missing' });
    expect(inspectCredentialConfiguration(completeFiles())).toEqual({
      hasManagedValues: true,
      status: 'complete',
    });
    expect(
      inspectCredentialConfiguration({
        ...completeFiles(),
        agent: completeFiles().agent.replace(
          'wss://demo.livekit.cloud',
          'wss://other.livekit.cloud',
        ),
      }),
    ).toEqual({ hasManagedValues: true, status: 'inconsistent' });
    expect(
      inspectCredentialConfiguration({
        ...completeFiles(),
        worker: completeFiles().worker.replace(
          'LIVEKIT_AGENT_NAME=spatius-agent',
          'LIVEKIT_AGENT_NAME=another-agent',
        ),
      }),
    ).toEqual({ hasManagedValues: true, status: 'inconsistent' });
    expect(
      inspectCredentialConfiguration({
        agent: completeFiles().agent.replace(
          'spatius-key-value',
          'your-spatius-api-key',
        ),
        worker: completeFiles().worker,
      }),
    ).toEqual({ hasManagedValues: true, status: 'placeholder' });
  });

  it('preserves comments and unrelated values while safely quoting managed values', () => {
    const merged = mergeDotenv(
      '# heading\nUNRELATED=keep\nLIVEKIT_API_SECRET=old\n\n',
      {
        LIVEKIT_API_SECRET: 'new value # with comment syntax',
        SPATIUS_APP_ID: 'app-123',
      },
    );

    expect(merged).toContain('# heading\nUNRELATED=keep\n');
    expect(merged).toContain(
      'LIVEKIT_API_SECRET="new value # with comment syntax"',
    );
    expect(merged).toContain('SPATIUS_APP_ID="app-123"');
    expect(merged.endsWith('\n')).toBe(true);
  });

  it('builds the exact Worker and agent mappings without a region or agent avatar', () => {
    const rendered = buildCredentialFileContents(
      { ...completeFiles(), hasManagedValues: true, status: 'complete' },
      completeFiles(),
      credentials,
    );
    const worker = parseDotenv(rendered.worker);
    const agent = parseDotenv(rendered.agent);

    expect(Object.fromEntries(worker)).toMatchObject({
      LIVEKIT_AGENT_NAME: 'spatius-agent',
      SPATIUS_APP_ID: 'app-123',
      SPATIUS_AVATAR_ID: 'avatar-123',
    });
    expect(Object.fromEntries(agent)).toMatchObject({
      SPATIUS_API_KEY: 'spatius-key-value',
      SPATIUS_APP_ID: 'app-123',
    });
    expect(rendered.worker).not.toContain('SPATIUS_REGION');
    expect(rendered.agent).not.toContain('SPATIUS_AVATAR_ID');
  });
});

describe('credential files', () => {
  it('preserves the scaffold name across setup runs and detects mismatches', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    const name = 'spatius-agent-6d34b784-ccbe-4c7c-aadc-56953565074e';
    const examples = {
      ...completeFiles(),
      worker: completeFiles().worker.replace('spatius-agent', name),
    };
    await writeFile(join(root, '.dev.vars.example'), examples.worker);
    let state = await readCredentialFileState(root);
    for (let run = 0; run < 2; run++) {
      const rendered = buildCredentialFileContents(
        state,
        examples,
        credentials,
      );
      expect(parseDotenv(rendered.worker).get('LIVEKIT_AGENT_NAME')).toBe(name);
      await writeFile(join(root, '.dev.vars'), rendered.worker);
      await writeFile(join(root, 'agent/.env.local'), rendered.agent);
      state = await readCredentialFileState(root);
      expect(state.status).toBe('complete');
    }
    await writeFile(
      join(root, '.dev.vars'),
      examples.worker.replace(name, 'spatius-agent-other'),
    );
    expect((await readCredentialFileState(root)).status).toBe('inconsistent');
  });

  it('reads missing and complete local state without displaying values', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    await expect(readCredentialFileState(root)).resolves.toMatchObject({
      hasManagedValues: false,
      status: 'missing',
    });

    const files = completeFiles();
    await writeFile(join(root, '.dev.vars'), files.worker);
    await writeFile(join(root, 'agent/.env.local'), files.agent);
    await expect(readCredentialFileState(root)).resolves.toMatchObject({
      hasManagedValues: true,
      status: 'complete',
    });
  });

  it('rejects symlinked secret files', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    await writeFile(join(root, 'outside'), 'LIVEKIT_URL=wss://outside\n');
    await symlink(join(root, 'outside'), join(root, '.dev.vars'));

    await expect(readCredentialFileState(root)).rejects.toMatchObject({
      code: 'FILESYSTEM_ERROR',
    });
  });

  it('reads both generated example files', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    await writeFile(join(root, '.dev.vars.example'), 'WORKER=example\n');
    await writeFile(join(root, 'agent/.env.example'), 'AGENT=example\n');

    await expect(readCredentialExamples(root)).resolves.toEqual({
      agent: 'AGENT=example\n',
      worker: 'WORKER=example\n',
    });
  });

  it('writes both files with private modes and cleans staging files', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));

    await writeCredentialFilesAtomically(root, {
      agent: 'AGENT=new\n',
      worker: 'WORKER=new\n',
    });

    await expect(readFile(join(root, '.dev.vars'), 'utf8')).resolves.toBe(
      'WORKER=new\n',
    );
    await expect(
      readFile(join(root, 'agent/.env.local'), 'utf8'),
    ).resolves.toBe('AGENT=new\n');
    if (process.platform !== 'win32') {
      expect((await lstat(join(root, '.dev.vars'))).mode & 0o777).toBe(0o600);
      expect((await lstat(join(root, 'agent/.env.local'))).mode & 0o777).toBe(
        0o600,
      );
    }
    expect((await readdir(root)).sort()).toEqual(['.dev.vars', 'agent']);
    expect(await readdir(join(root, 'agent'))).toEqual(['.env.local']);
  });

  it.each(['staging', 'backup'] as const)(
    'does not rewrite untouched originals after a second-file %s failure',
    async (failure) => {
      const root = await temporaryDirectory();
      await mkdir(join(root, 'agent'));
      const workerPath = join(root, '.dev.vars');
      const agentPath = join(root, 'agent/.env.local');
      await writeFile(workerPath, 'WORKER=original\n');
      await writeFile(agentPath, 'AGENT=original\n');
      let diskFull = false;
      const writes: string[] = [];
      const fileSystem = atomicFileSystem({
        rename: async (source, destination) => {
          if (failure === 'backup' && source === agentPath) {
            throw new Error('simulated backup rename failure');
          }
          await rename(source, destination);
        },
        writeFile: async (path, contents, options) => {
          writes.push(path);
          if (
            failure === 'staging' &&
            path.startsWith(`${agentPath}.`) &&
            path.endsWith('.tmp')
          ) {
            diskFull = true;
          }
          if (diskFull) {
            // A default-mode write truncates its destination before ENOSPC.
            if (options.flag !== 'wx') await writeFile(path, '');
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          }
          await writeFile(path, contents, options);
        },
      });

      await expect(
        writeCredentialFilesAtomically(
          root,
          { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
          fileSystem,
        ),
      ).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });

      expect(writes).not.toContain(workerPath);
      expect(writes).not.toContain(agentPath);
      await expect(readFile(workerPath, 'utf8')).resolves.toBe(
        'WORKER=original\n',
      );
      await expect(readFile(agentPath, 'utf8')).resolves.toBe(
        'AGENT=original\n',
      );
      expect((await readdir(root)).sort()).toEqual(['.dev.vars', 'agent']);
      expect(await readdir(join(root, 'agent'))).toEqual(['.env.local']);
    },
  );

  it('keeps the original backup and reports a failed restoration accurately', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    const workerPath = join(root, '.dev.vars');
    const agentPath = join(root, 'agent/.env.local');
    await writeFile(workerPath, 'WORKER=original\n');
    await writeFile(agentPath, 'AGENT=original\n');
    const fileSystem = atomicFileSystem({
      rename: async (source, destination) => {
        if (
          (source.startsWith(`${agentPath}.`) && source.endsWith('.tmp')) ||
          (source.startsWith(`${workerPath}.`) && source.endsWith('.backup'))
        ) {
          throw new Error('simulated rename failure');
        }
        await rename(source, destination);
      },
      writeFile: async (path, contents, options) => {
        if (path === workerPath) {
          await writeFile(path, '');
          throw new Error('simulated recovery write failure');
        }
        await writeFile(path, contents, options);
      },
    });

    const result = writeCredentialFilesAtomically(
      root,
      { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
      fileSystem,
    );
    await expect(result).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });
    await expect(result).rejects.toThrow('could not be restored');
    await expect(result).rejects.toHaveProperty(
      'recovery',
      expect.stringContaining(workerPath),
    );

    const backups = (await readdir(root)).filter((path) =>
      path.endsWith('.backup'),
    );
    expect(backups).toHaveLength(1);
    await expect(readFile(join(root, backups[0]!), 'utf8')).resolves.toBe(
      'WORKER=original\n',
    );
    await expect(readFile(workerPath, 'utf8')).resolves.toBe('WORKER=new\n');
    await expect(readFile(agentPath, 'utf8')).resolves.toBe('AGENT=original\n');
    expect((await readdir(root)).some((path) => path.endsWith('.tmp'))).toBe(
      false,
    );
    expect(await readdir(join(root, 'agent'))).toEqual(['.env.local']);
  });

  it('preserves the installed file if recreating a removed backup fails', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    const workerPath = join(root, '.dev.vars');
    const agentPath = join(root, 'agent/.env.local');
    await writeFile(workerPath, 'WORKER=original\n');
    await writeFile(agentPath, 'AGENT=original\n');
    let cleanupFailed = false;
    const fileSystem = atomicFileSystem({
      rm: async (path) => {
        if (path.startsWith(`${agentPath}.`) && path.endsWith('.backup')) {
          cleanupFailed = true;
          throw new Error('simulated cleanup failure');
        }
        await rm(path, { force: true });
      },
      writeFile: async (path, contents, options) => {
        if (cleanupFailed) {
          await writeFile(path, '', options);
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        }
        await writeFile(path, contents, options);
      },
    });

    const result = writeCredentialFilesAtomically(
      root,
      { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
      fileSystem,
    );
    await expect(result).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });
    await expect(result).rejects.toThrow('could not be restored');
    await expect(result).rejects.toHaveProperty(
      'recovery',
      expect.stringContaining(workerPath),
    );
    await expect(readFile(workerPath, 'utf8')).resolves.toBe('WORKER=new\n');
    await expect(readFile(agentPath, 'utf8')).resolves.toBe('AGENT=original\n');
  });

  it('removes newly installed files when the second commit fails', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    const fileSystem = atomicFileSystem({
      rename: async (source, destination) => {
        if (destination === join(root, 'agent/.env.local')) {
          throw new Error('simulated commit failure');
        }
        await rename(source, destination);
      },
    });

    await expect(
      writeCredentialFilesAtomically(
        root,
        { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });
    expect(await readdir(root)).toEqual(['agent']);
    expect(await readdir(join(root, 'agent'))).toEqual([]);
  });

  it('restores both originals when the second commit fails', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    await writeFile(join(root, '.dev.vars'), 'WORKER=original\n');
    await writeFile(join(root, 'agent/.env.local'), 'AGENT=original\n');
    let stagedRenames = 0;
    const fileSystem: AtomicCredentialFileSystem = {
      chmod,
      lstat,
      readFile: (path) => readFile(path),
      rename: async (source, destination) => {
        if (source.endsWith('.tmp')) {
          stagedRenames += 1;
          if (stagedRenames === 2) throw new Error('simulated rename failure');
        }
        await rename(source, destination);
      },
      rm: (path) => rm(path, { force: true }),
      writeFile: (path, contents, options) =>
        writeFile(path, contents, options),
    };

    await expect(
      writeCredentialFilesAtomically(
        root,
        { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });
    await expect(readFile(join(root, '.dev.vars'), 'utf8')).resolves.toBe(
      'WORKER=original\n',
    );
    await expect(
      readFile(join(root, 'agent/.env.local'), 'utf8'),
    ).resolves.toBe('AGENT=original\n');
    expect((await readdir(root)).sort()).toEqual(['.dev.vars', 'agent']);
    expect(await readdir(join(root, 'agent'))).toEqual(['.env.local']);
  });

  it('rolls back both files when backup cleanup fails', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'agent'));
    await writeFile(join(root, '.dev.vars'), 'WORKER=original\n');
    await writeFile(join(root, 'agent/.env.local'), 'AGENT=original\n');
    let failedCleanup = false;
    const fileSystem: AtomicCredentialFileSystem = {
      chmod,
      lstat,
      readFile: (path) => readFile(path),
      rename,
      rm: async (path) => {
        if (
          !failedCleanup &&
          path.includes('agent') &&
          path.endsWith('.backup')
        ) {
          failedCleanup = true;
          throw new Error('simulated cleanup failure');
        }
        await rm(path, { force: true });
      },
      writeFile: (path, contents, options) =>
        writeFile(path, contents, options),
    };

    await expect(
      writeCredentialFilesAtomically(
        root,
        { agent: 'AGENT=new\n', worker: 'WORKER=new\n' },
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: 'FILESYSTEM_ERROR' });
    await expect(readFile(join(root, '.dev.vars'), 'utf8')).resolves.toBe(
      'WORKER=original\n',
    );
    await expect(
      readFile(join(root, 'agent/.env.local'), 'utf8'),
    ).resolves.toBe('AGENT=original\n');
    expect((await readdir(root)).sort()).toEqual(['.dev.vars', 'agent']);
    expect(await readdir(join(root, 'agent'))).toEqual(['.env.local']);
  });
});

describe('project validation', () => {
  async function createProject(root: string): Promise<void> {
    await mkdir(join(root, 'worker'), { recursive: true });
    await mkdir(join(root, 'agent/src'), { recursive: true });
    for (const path of [
      'package.json',
      'wrangler.jsonc',
      '.dev.vars.example',
      'worker/index.ts',
      'agent/src/agent.py',
      'agent/.env.example',
    ]) {
      await writeFile(join(root, path), '{}\n');
    }
  }

  it('accepts the expected template structure', async () => {
    const root = await temporaryDirectory();
    await createProject(root);
    await expect(assertSpatiusProject(root)).resolves.toBeUndefined();
  });

  it('rejects unrelated directories and non-regular markers', async () => {
    const root = await temporaryDirectory();
    await expect(assertSpatiusProject(root)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: root,
    });
    await createProject(root);
    await rm(join(root, 'worker/index.ts'));
    await mkdir(join(root, 'worker/index.ts'));
    await expect(assertSpatiusProject(root)).rejects.toThrow(
      /not a compatible/u,
    );
  });

  it('rejects a generated-project boundary with a symlinked agent directory', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await createProject(root);
    await mkdir(join(outside, 'src'));
    await writeFile(join(outside, 'src/agent.py'), '{}\n');
    await writeFile(join(outside, '.env.example'), '{}\n');
    await rm(join(root, 'agent'), { force: true, recursive: true });
    await symlink(
      outside,
      join(root, 'agent'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(assertSpatiusProject(root)).rejects.toThrow(
      /not a compatible/u,
    );
  });
});
