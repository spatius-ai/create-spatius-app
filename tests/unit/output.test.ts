import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';

import resultSchema from '../../schemas/result-v3.schema.json' with { type: 'json' };
import { CliError, EXIT_CODES } from '../../src/errors.js';
import {
  createFailureResult,
  createSuccessResult,
  writeJsonResult,
} from '../../src/output.js';
import { createPackageManagers } from '../package-manager-fixtures.js';
import { createFixtureTemplate } from '../template-fixtures.js';

const validateResult = new Ajv2020({ strict: true }).compile(resultSchema);
const packageManagers = createPackageManagers();

function successOptions(dryRun: boolean, files: string[]) {
  return {
    dependenciesInstalled: false,
    dryRun,
    files,
    generatorVersion: '1.2.3',
    javascriptPackageManager: packageManagers.javascript.name,
    projectDirectory: '/project',
    pythonPackageManager: packageManagers.python,
  } as const;
}

describe('structured output', () => {
  it('takes next steps from the selected adapter while preserving the public template value', () => {
    const result = createSuccessResult({
      ...successOptions(false, ['file']),
      template: createFixtureTemplate(),
    });
    expect(result.nextSteps).toEqual(['fixture run']);
    expect(result.humanSteps).toEqual([]);
    expect(result.template).toBe('minimal');
    expect(validateResult(result)).toBe(true);
  });

  it.each(['pnpm', 'bun', 'npm'] as const)(
    'uses %s to start the generated app',
    (javascriptPackageManager) => {
      const result = createSuccessResult({
        ...successOptions(false, ['file']),
        javascriptPackageManager,
      });
      expect(result.nextSteps.at(-1)).toBe(
        `${javascriptPackageManager} run dev`,
      );
    },
  );

  it('reports files created by a real run', () => {
    expect(
      createSuccessResult(successOptions(false, ['AGENTS.md', 'README.md'])),
    ).toMatchObject({
      created: ['AGENTS.md', 'README.md'],
      dryRun: false,
      ok: true,
      packageManagers: { javascript: 'pnpm', python: 'uv' },
      schemaVersion: 3,
      wouldCreate: [],
    });
  });

  it('reports planned files without claiming they were created', () => {
    expect(
      createSuccessResult(successOptions(true, ['AGENTS.md'])),
    ).toMatchObject({
      created: [],
      dryRun: true,
      wouldCreate: ['AGENTS.md'],
    });
  });

  it('omits install commands after dependencies were installed', () => {
    const result = createSuccessResult({
      ...successOptions(false, ['README.md']),
      dependenciesInstalled: true,
    });

    expect(result.actions.dependenciesInstalled).toBe(true);
    expect(result.nextSteps).toEqual([
      'npx create-spatius-app setup . --interactive',
      'pnpm run dev',
    ]);
  });

  it.each([
    { dryRun: true, dependenciesInstalled: false },
    { dryRun: false, dependenciesInstalled: false },
    { dryRun: false, dependenciesInstalled: true },
  ])(
    'reports human prerequisites for $dryRun/$dependenciesInstalled',
    (state) => {
      const result = createSuccessResult({
        ...successOptions(state.dryRun, ['README.md']),
        ...state,
      });
      expect(result.humanSteps).toEqual([
        {
          command: 'npx create-spatius-app setup . --interactive',
          requiresHuman: true,
          requiresTty: true,
          reason: expect.stringContaining(
            'Never paste secrets into chat.',
          ) as unknown,
        },
      ]);
      expect(result.nextSteps).toContain(result.humanSteps[0]!.command);
      expect(validateResult(result)).toBe(true);
      expect(
        validateResult({
          ...result,
          humanSteps: [{ ...result.humanSteps[0], requiresHuman: false }],
        }),
      ).toBe(false);
      expect(validateResult({ ...result, humanSteps: undefined })).toBe(false);
    },
  );

  it('serializes stable error details', () => {
    const result = createFailureResult(
      new CliError('TARGET_NOT_EMPTY', 'Not empty.', {
        exitCode: EXIT_CODES.targetConflict,
        path: '/project',
        recovery: 'Choose an empty directory.',
      }),
    );

    expect(result).toEqual({
      error: {
        code: 'TARGET_NOT_EMPTY',
        message: 'Not empty.',
        path: '/project',
        recovery: 'Choose an empty directory.',
      },
      ok: false,
      schemaVersion: 3,
    });
  });

  it('keeps success and failure results compatible with the published schema', () => {
    const success = createSuccessResult(successOptions(false, ['AGENTS.md']));
    const failure = createFailureResult(
      new CliError('INVALID_ARGUMENT', 'Invalid input.', {
        exitCode: EXIT_CODES.invalidArgument,
      }),
    );

    expect(validateResult(success), JSON.stringify(validateResult.errors)).toBe(
      true,
    );
    expect(validateResult(failure), JSON.stringify(validateResult.errors)).toBe(
      true,
    );
  });

  it('writes exactly one compact JSON document', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = createSuccessResult(successOptions(true, ['AGENTS.md']));

    writeJsonResult(result);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(`${JSON.stringify(result)}\n`);
    write.mockRestore();
  });
});
