import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

import { createScaffoldPlan, scaffoldProject } from '../../src/scaffold.js';
import { templateRegistry } from '../../src/templates.js';
import { createPackageManagers } from '../package-manager-fixtures.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Dependencies = Record<string, string>;
type Manifest = {
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  optionalDependencies?: Dependencies;
};
type PnpmImporter = Record<string, Record<string, { specifier: string }>>;

describe.each(Object.values(templateRegistry))(
  '$id dependency artifacts',
  (template) => {
    it.each(['npm', 'pnpm'] as const)(
      'ships a consistent %s manifest, lockfile, and workspace',
      async (javascript) => {
        const directory = await mkdtemp(
          join(tmpdir(), 'spatius-dependencies-'),
        );
        directories.push(directory);
        const managers = createPackageManagers(javascript);
        const options = {
          targetDirectory: directory,
          template,
          configuration: {
            packageManagers: {
              javascript: managers.javascript,
              ...(template.requiresPython === false
                ? {}
                : { python: managers.python }),
            },
          },
        };
        const plan = await createScaffoldPlan(options);
        await scaffoldProject(options);
        const manifest = JSON.parse(
          await readFile(join(directory, 'package.json'), 'utf8'),
        ) as Manifest;
        let locked: Manifest;
        if (javascript === 'pnpm') {
          const lock = parseAllDocuments(
            await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'),
          )
            .at(-1)!
            .toJS() as { importers: Record<string, PnpmImporter> };
          locked = Object.fromEntries(
            Object.entries(lock.importers['.']!).map(([type, deps]) => [
              type,
              Object.fromEntries(
                Object.entries(deps).map(([name, dep]) => [
                  name,
                  dep.specifier,
                ]),
              ),
            ]),
          );
          // Renovate runs pnpm in the source lockfile's directory. That directory
          // must be a workspace root itself, even before layers are assembled.
          const sourceDirectory = (destination: string) => {
            const entry = plan.entries.find(
              (entry) => entry.destination === destination,
            )!;
            return dirname(
              join(entry.directory ?? plan.templateDirectory, entry.source),
            );
          };
          expect(sourceDirectory('pnpm-workspace.yaml')).toBe(
            sourceDirectory('pnpm-lock.yaml'),
          );
          expect(sourceDirectory('package.json')).toBe(
            sourceDirectory('pnpm-lock.yaml'),
          );
          await expect(
            readFile(join(directory, 'package-lock.json')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        } else {
          const lock = JSON.parse(
            await readFile(join(directory, 'package-lock.json'), 'utf8'),
          ) as { packages: Record<string, Manifest> };
          locked = lock.packages['']!;
          await expect(
            readFile(join(directory, 'pnpm-workspace.yaml')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(
            readFile(join(directory, 'pnpm-lock.yaml')),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        }
        for (const type of [
          'dependencies',
          'devDependencies',
          'optionalDependencies',
        ] as const) {
          expect(locked[type] ?? {}, type).toEqual(manifest[type] ?? {});
        }
      },
    );
  },
);
