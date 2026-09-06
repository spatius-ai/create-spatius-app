import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolve('scripts/prepare-release.mjs');

function prepare(
  tag: string,
  prerelease: boolean,
  version = tag.slice(1),
  action = 'published',
) {
  const directory = mkdtempSync(join(tmpdir(), 'spatius-release-'));
  const output = join(directory, 'output');
  const event = join(directory, 'event.json');
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }));
    writeFileSync(
      event,
      JSON.stringify({
        action,
        release: { tag_name: tag, prerelease, draft: false },
      }),
    );
    execFileSync(process.execPath, [script], {
      cwd: directory,
      env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output },
      stdio: 'pipe',
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('npm release policy', () => {
  it('publishes a normal stable version to latest', () => {
    expect(prepare('v1.2.3', false)).toBe('dist_tag=latest\n');
  });

  it.each([true, false])(
    'keeps prerelease versions on beta with checkbox %s',
    (prerelease) => {
      expect(prepare('v1.2.3-beta.1', prerelease)).toBe('dist_tag=beta\n');
      expect(prepare('v1.2.3-rc.2', prerelease)).toBe('dist_tag=beta\n');
    },
  );

  it('lets the GitHub prerelease checkbox select beta for a plain version', () => {
    expect(prepare('v1.2.3', true)).toBe('dist_tag=beta\n');
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

  it('rejects a tag/package version mismatch', () => {
    expect(() => prepare('v1.2.3', false, '0.0.0')).toThrow(/does not match/);
  });

  it('rejects release edits instead of republishing an existing version', () => {
    expect(() => prepare('v1.2.3', false, '1.2.3', 'edited')).toThrow();
  });
});
