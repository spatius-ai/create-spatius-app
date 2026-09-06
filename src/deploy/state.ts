import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

export interface DeploymentState {
  version: 1;
  accountId: string;
  workerName: string;
  projectName: string;
  subdomain: string;
  region: string;
  agentId?: string;
  agentFingerprint?: string;
  agentVersion?: string;
  phase:
    | 'prepared'
    | 'creating'
    | 'deploying-agent'
    | 'agent-ready'
    | 'deploying-web'
    | 'complete';
  url?: string;
}

export async function readRegular(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error(`Expected a regular file: ${path}`);
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function atomicWrite(
  path: string,
  contents: string,
): Promise<void> {
  await readRegular(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
async function stateDirectory(root: string): Promise<string> {
  const directory = join(root, '.spatius');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Refusing a symlinked .spatius directory.');
  return directory;
}
export async function loadState(
  root: string,
): Promise<DeploymentState | undefined> {
  const dir = await stateDirectory(root);
  const contents = await readRegular(join(dir, 'deploy.json'));
  if (!contents) return undefined;
  const state = JSON.parse(contents) as DeploymentState;
  if (
    state.version !== 1 ||
    !/^[a-f\d]{32}$/u.test(state.accountId) ||
    !/^[a-z\d][a-z\d-]{0,62}$/u.test(state.workerName) ||
    !state.projectName ||
    !/^[a-z\d-]+$/u.test(state.subdomain) ||
    !/^[a-z\d-]+$/u.test(state.region) ||
    ![
      'prepared',
      'creating',
      'deploying-agent',
      'agent-ready',
      'deploying-web',
      'complete',
    ].includes(state.phase) ||
    (state.agentId !== undefined && !/^CA_[\w-]+$/u.test(state.agentId))
  ) {
    throw new Error(
      'Invalid .spatius/deploy.json. Restore the saved deployment target before retrying.',
    );
  }
  return state;
}
export async function saveState(
  root: string,
  state: DeploymentState,
): Promise<void> {
  const dir = await stateDirectory(root);
  const ignorePath = join(root, '.gitignore');
  const ignore = (await readRegular(ignorePath)) ?? '';
  if (!ignore.split('\n').includes('/.spatius/'))
    await atomicWrite(ignorePath, `${ignore.trimEnd()}\n/.spatius/\n`);
  await atomicWrite(
    join(dir, 'deploy.json'),
    JSON.stringify(state, null, 2) + '\n',
  );
}
export async function readAgentConfig(
  root: string,
): Promise<{ id: string; subdomain: string } | undefined> {
  const contents = await readRegular(join(root, 'agent/livekit.toml'));
  if (contents === undefined) return undefined;
  const config = parseToml(contents) as {
    project?: { subdomain?: string };
    agent?: { id?: string };
  };
  const id = config.agent?.id;
  const subdomain = config.project?.subdomain;
  if (!id || !/^CA_[\w-]+$/u.test(id) || !subdomain)
    throw new Error(
      'agent/livekit.toml must identify a LiveKit project and agent.',
    );
  return { id, subdomain };
}
export function workerConfiguration(
  contents: string,
  state: DeploymentState,
  values: Map<string, string>,
): string {
  const errors: ParseError[] = [];
  const config: unknown = parse(contents, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== 'object')
    throw new Error('Invalid wrangler.jsonc.');
  const updates: [string[], unknown][] = [
    [['name'], state.workerName],
    [['account_id'], state.accountId],
    [['workers_dev'], true],
  ];
  for (const key of [
    'LIVEKIT_URL',
    'LIVEKIT_AGENT_NAME',
    'SPATIUS_APP_ID',
    'SPATIUS_AVATAR_ID',
    'CARTESIA_VOICE_ID',
    'SPATIUS_AVATAR_BACKGROUND_URL',
  ]) {
    if (values.has(key)) updates.push([['vars', key], values.get(key)]);
  }
  for (const [path, value] of updates)
    contents = applyEdits(
      contents,
      modify(contents, path, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
  return contents;
}
export async function agentFingerprint(
  root: string,
  secrets: Record<string, string>,
): Promise<string> {
  const hash = createHash('sha256').update(JSON.stringify(secrets));
  const excluded = new Set([
    '.git',
    '.venv',
    'node_modules',
    '__pycache__',
    '.pytest_cache',
    '.ruff_cache',
    'livekit.toml',
  ]);
  const walk = async (directory: string): Promise<void> => {
    const entries = (
      await readdir(join(root, 'agent', directory), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (excluded.has(entry.name) || entry.name.startsWith('.env')) continue;
      const relative = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Agent build context contains a symlink: ${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile())
        hash
          .update(relative)
          .update(await readFile(join(root, 'agent', relative)));
    }
  };
  await walk('');
  return hash.digest('hex');
}
export const deploymentFiles = {
  loadState,
  saveState,
  readAgentConfig,
  readRegular,
  atomicWrite,
  agentFingerprint,
};
export type DeploymentFiles = typeof deploymentFiles;
