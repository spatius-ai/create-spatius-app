import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';

import resultSchema from '../../schemas/result-v1.schema.json' with { type: 'json' };
import { CliError, EXIT_CODES } from '../../src/errors.js';
import {
  createFailureResult,
  createSuccessResult,
  writeJsonResult,
} from '../../src/output.js';

const validateResult = new Ajv2020({ strict: true }).compile(resultSchema);

describe('structured output', () => {
  it('reports files created by a real run', () => {
    expect(
      createSuccessResult({
        dryRun: false,
        files: ['AGENTS.md', 'README.md'],
        generatorVersion: '1.2.3',
        projectDirectory: '/project',
      }),
    ).toMatchObject({
      created: ['AGENTS.md', 'README.md'],
      dryRun: false,
      ok: true,
      schemaVersion: 1,
      wouldCreate: [],
    });
  });

  it('reports planned files without claiming they were created', () => {
    expect(
      createSuccessResult({
        dryRun: true,
        files: ['AGENTS.md'],
        generatorVersion: '1.2.3',
        projectDirectory: '/project',
      }),
    ).toMatchObject({
      created: [],
      dryRun: true,
      wouldCreate: ['AGENTS.md'],
    });
  });

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
      schemaVersion: 1,
    });
  });

  it('keeps success and failure results compatible with the published schema', () => {
    const success = createSuccessResult({
      dryRun: false,
      files: ['AGENTS.md'],
      generatorVersion: '1.2.3',
      projectDirectory: '/project',
    });
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
    const result = createSuccessResult({
      dryRun: true,
      files: ['AGENTS.md'],
      generatorVersion: '1.2.3',
      projectDirectory: '/project',
    });

    writeJsonResult(result);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(`${JSON.stringify(result)}\n`);
    write.mockRestore();
  });
});
