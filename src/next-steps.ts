import { resolve } from 'node:path';

/** Human-readable commands only; the machine-readable nextSteps contract is unchanged. */
export function formatNextSteps(
  targetDirectory: string,
  commands: readonly string[],
  {
    cwd = process.cwd(),
    platform = process.platform,
  }: {
    cwd?: string;
    platform?: NodeJS.Platform;
  } = {},
): string {
  const directory = resolve(targetDirectory);
  const changeDirectory =
    platform === 'win32'
      ? // PowerShell's literal-path option also handles brackets in directory names.
        `cd -LiteralPath '${directory.replaceAll("'", "''")}'`
      : `cd '${directory.replaceAll("'", "'\\''")}'`;
  return [
    ...(directory === resolve(cwd) ? [] : [changeDirectory]),
    ...commands,
  ].join('\n');
}
