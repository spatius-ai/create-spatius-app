import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = resolve('scripts/prepare-release.mjs');

function prepare(
  tag: string,
  prerelease: boolean,
  {
    version = '0.0.0',
    action = 'published',
    draft = false,
    status = 404,
    networkError = false,
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'spatius-release-'));
  const output = join(directory, 'output');
  const event = join(directory, 'event.json');
  const manifest = join(directory, 'package.json');
  const template = join(directory, 'templates/package.json');
  const hook = join(directory, 'fetch.mjs');
  const metadata = {
    name: 'create-spatius-app',
    version,
    scripts: { build: 'tsup' },
    publishConfig: { provenance: true },
  };
  const original = `${JSON.stringify(metadata, null, 2)}\n`;
  try {
    writeFileSync(manifest, original);
    mkdirSync(join(directory, 'templates'));
    writeFileSync(template, '{"version":"0.1.0"}');
    writeFileSync(
      event,
      JSON.stringify({ action, release: { tag_name: tag, prerelease, draft } }),
    );
    // Stub transport in the child process without adding a production registry override.
    writeFileSync(
      hook,
      `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (url, options) => {
        assert.equal(url, ${JSON.stringify(`https://registry.npmjs.org/create-spatius-app/${encodeURIComponent(tag.slice(1))}`)});
        assert.equal(options.cache, 'no-store');
        assert.ok(options.signal instanceof AbortSignal);
        if (${networkError}) throw new Error('Registry connection failed');
        return new Response(null, {status: ${status}});
      };
    `,
    );
    try {
      execFileSync(
        process.execPath,
        ['--import', pathToFileURL(hook).href, script],
        {
          cwd: directory,
          env: {
            ...process.env,
            GITHUB_EVENT_PATH: event,
            GITHUB_OUTPUT: output,
          },
          stdio: 'pipe',
        },
      );
    } catch (error) {
      expect(readFileSync(manifest, 'utf8')).toBe(original);
      throw error;
    }
    expect(readFileSync(template, 'utf8')).toBe('{"version":"0.1.0"}');
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({
      ...metadata,
      version: tag.slice(1),
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('npm release policy', () => {
  it('sets a stable version from the tag and selects latest', () => {
    expect(prepare('v1.2.3', false)).toBe('dist_tag=latest\n');
  });

  it.each(['v1.2.3-beta.1', 'v1.2.3-rc.2'])(
    'sets prerelease %s from the tag and selects beta',
    (tag) => {
      expect(prepare(tag, true)).toBe('dist_tag=beta\n');
    },
  );

  it('accepts a manifest that already has the release version', () => {
    expect(prepare('v1.2.3', false, { version: '1.2.3' })).toBe(
      'dist_tag=latest\n',
    );
  });

  it('rejects a prerelease tag without the GitHub checkbox', () => {
    expect(() => prepare('v1.2.3-beta.1', false)).toThrow(/checkbox/);
  });

  it('rejects a stable tag marked as a GitHub prerelease', () => {
    expect(() => prepare('v1.2.3', true)).toThrow(/checkbox/);
  });

  it.each([
    '1.2.3',
    'v01.2.3',
    'v1.2',
    'v1.2.3-beta.01',
    'v1.2.3+build',
    'v1.2.3\n',
    'v1.2.3-',
  ])('rejects invalid tag %s', (tag) => {
    expect(() => prepare(tag, false)).toThrow();
  });

  it('rejects an already published npm version before changing the manifest', () => {
    expect(() => prepare('v1.2.3', false, { status: 200 })).toThrow(
      /already published/,
    );
  });

  it.each([401, 403, 429, 500])(
    'fails closed on registry HTTP %s',
    (status) => {
      expect(() => prepare('v1.2.3', false, { status })).toThrow(
        /Cannot verify/,
      );
    },
  );

  it('fails closed on registry connection errors', () => {
    expect(() => prepare('v1.2.3', false, { networkError: true })).toThrow(
      /Registry connection failed/,
    );
  });

  it('rejects release edits instead of republishing', () => {
    expect(() => prepare('v1.2.3', false, { action: 'edited' })).toThrow();
  });

  it('rejects draft releases', () => {
    expect(() => prepare('v1.2.3', false, { draft: true })).toThrow();
  });
});
