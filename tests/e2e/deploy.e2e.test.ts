import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
} from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const cli = resolve('dist/cli.js');
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function run(
  root: string,
  args: string[],
  input = '',
  env: NodeJS.ProcessEnv = {},
) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: 'pipe',
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
      child.stdin.end(input);
    },
  );
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatius-deploy-e2e-'));
  roots.push(root);
  await exec(
    process.execPath,
    [
      cli,
      'app',
      '--yes',
      '--no-install',
      '--no-setup',
      '--package-manager',
      'npm',
      '--python-package-manager',
      'pip',
    ],
    { cwd: root },
  );
  const app = join(root, 'app');
  const values = (await readFile(join(app, '.dev.vars.example'), 'utf8'))
    .replaceAll('your-project', 'demo')
    .replaceAll('your-livekit-api-key', 'fake-livekit-key')
    .replaceAll('your-livekit-api-secret', 'fake-livekit-secret')
    .replaceAll('your-spatius-app-id', 'fake-app-id')
    .replaceAll('your-spatius-avatar-id', 'fake-avatar');
  await writeFile(join(app, '.dev.vars'), values);
  await writeFile(
    join(app, 'agent/.env.local'),
    values + '\nSPATIUS_API_KEY=fake-spatius-secret\n',
  );
  const bin = join(root, 'bin');
  await mkdir(bin);
  const tool = join(root, 'provider.cjs');
  await writeFile(
    tool,
    `
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(3); const role = process.argv[2]; const root = ${JSON.stringify(app)};
const log = event => fs.appendFileSync(path.join(root, 'events.txt'), event+'\\n');
if (args.includes('--help')) { console.log('--json --secrets-file --yes'); process.exit(0); }
if (args.includes('--version')) { console.log('2.18.5'); process.exit(0); }
if (role === 'wrangler') {
  if (args.includes('whoami')) console.log(JSON.stringify({loggedIn:true,accounts:[{id:'a'.repeat(32),name:'Test Account'}]}));
  else if(args.includes('token')) console.log(JSON.stringify({type:'oauth',token:'fake-cloudflare-secret'}));
  else if(args.includes('deploy')) {log('worker'); if(process.env.SPATIUS_TEST_FAIL_WEB === '1') process.exit(1); console.log('Published');}
  else process.exit(2);
} else if(role === 'npm') {
  log('build'); fs.mkdirSync(path.join(root,'.wrangler/deploy'),{recursive:true}); fs.mkdirSync(path.join(root,'dist/worker'),{recursive:true});
  fs.writeFileSync(path.join(root,'.wrangler/deploy/config.json'), JSON.stringify({configPath:'../../dist/worker/wrangler.json'}));
  fs.writeFileSync(path.join(root,'dist/worker/wrangler.json'), JSON.stringify({name:'app',account_id:process.env.CLOUDFLARE_ACCOUNT_ID}));
} else if(role === 'lk') {
  if(args.includes('project') && args.includes('list')) console.log(JSON.stringify([{Name:'Demo',URL:'wss://demo.livekit.cloud',APIKey:'fake-livekit-key',APISecret:'fake-livekit-secret'}]));
  else if(args.includes('list')) {
    const exists = fs.existsSync(path.join(root,'agent/livekit.toml'));
    const name = fs.readFileSync(path.join(root,'agent/src/agent.py'),'utf8').match(/agent_name="([^"]+)"/)[1];
    console.log(JSON.stringify({agents:exists ? [{agent_id:'CA_fixture',version:'v1',agent_deployments:[{region:'us-east',agent_name:name,status:'Running',version:'v1'}]}] : []}));
  } else if(args.includes('create') || args.includes('deploy')) {
    log(args.includes('create')?'create':'update');
    const secrets = fs.readFileSync(args[args.indexOf('--secrets-file')+1],'utf8');
    if(secrets.includes('LIVEKIT_')) process.exit(3);
    fs.writeFileSync(path.join(root,'agent/livekit.toml'),'[project]\\nsubdomain="demo"\\n[agent]\\nid="CA_fixture"\\n');
  } else process.exit(4);
}
`,
  );
  for (const name of ['lk', 'npm']) {
    await writeFile(
      join(bin, name),
      `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${tool.replaceAll("'", "'\\''")}' ${name} "$@"\n`,
    );
    await chmod(join(bin, name), 0o755);
    await writeFile(
      join(bin, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "${tool}" ${name} %*\r\n`,
    );
  }
  await mkdir(join(app, 'node_modules/wrangler/bin'), { recursive: true });
  await writeFile(
    join(app, 'node_modules/wrangler/bin/wrangler.js'),
    `process.argv.splice(2,0,'wrangler'); require(${JSON.stringify(tool)});`,
  );
  // Fake only the HTTP boundary in this child. There is no production test API override.
  const preload = join(root, 'http.mjs');
  await writeFile(
    preload,
    `globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if(url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/settings')) return Response.json({success:false,errors:[{code:10007}]},{status:404});
    if(url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/subdomain')) return Response.json({success:true,result:{subdomain:'test-account'}});
    if(url.hostname === 'app.test-account.workers.dev') return url.pathname === '/api/health' ? Response.json({ok:true}) : new Response('<html>app</html>');
    throw new Error('Unexpected test request');
  };`,
  );
  const environment = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    NODE_ENV: 'test',
    CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
    CI: '',
    NO_COLOR: '1',
    LIVEKIT_URL: 'wss://wrong.livekit.cloud',
    CLOUDFLARE_ACCOUNT_ID: 'wrong',
  };
  const deploy = (input: string, extra: NodeJS.ProcessEnv = {}) =>
    run(
      app,
      ['--import', preload, cli, 'deploy', '.', '--interactive'],
      input,
      { ...environment, ...extra },
    );
  return { app, deploy };
}
describe('built guided deployment', () => {
  it('uses real child processes, resumes a web failure, and updates the same agent', async () => {
    const f = await fixture();
    const first = await f.deploy('\n\ny\n', { SPATIUS_TEST_FAIL_WEB: '1' });
    expect(first.code, first.output).toBe(1);
    const second = await f.deploy('y\n');
    expect(second.code, second.output).toBe(0);
    expect(second.output).toContain('https://app.test-account.workers.dev');
    expect(second.output).not.toMatch(
      /fake-(?:spatius|livekit|cloudflare)-secret/u,
    );
    expect(
      (await readFile(join(f.app, 'events.txt'), 'utf8')).trim().split('\n'),
    ).toEqual(['build', 'create', 'worker', 'build', 'worker']);
    await writeFile(join(f.app, 'agent/src/change.py'), 'changed = True');
    const third = await f.deploy('y\n');
    expect(third.code, third.output).toBe(0);
    expect(await readFile(join(f.app, 'events.txt'), 'utf8')).toContain(
      'update\n',
    );
    expect(await readFile(join(f.app, 'agent/livekit.toml'), 'utf8')).toContain(
      'CA_fixture',
    );
  });
  it('declines without creating cloud resources', async () => {
    const f = await fixture();
    const result = await f.deploy('\n\nn\n');
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('Deployment deferred');
    await expect(readFile(join(f.app, 'events.txt'))).rejects.toThrow();
  });
  it('rejects noninteractive deployment even when explicitly requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spatius-deploy-mode-'));
    roots.push(root);
    const result = await run(root, [cli, 'deploy', '--interactive'], '', {
      CREATE_SPATIUS_APP_TEST_INTERACTIVE: '',
      NODE_ENV: 'production',
    });
    expect(result.code).toBe(2);
    expect(result.output).toContain('requires an interactive terminal');
  });
});
