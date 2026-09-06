import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
const release = event.release;

// Require canonical SemVer without build metadata (npm versions must be unique).
const numeric = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const tagPattern = new RegExp(
  `^v(${numeric}\\.${numeric}\\.${numeric})(?:-(${identifier}(?:\\.${identifier})*))?$`,
  'u',
);
const match =
  typeof release?.tag_name === 'string'
    ? tagPattern.exec(release.tag_name)
    : null;

if (
  event.action !== 'published' ||
  release?.draft !== false ||
  typeof release?.prerelease !== 'boolean' ||
  !match
) {
  throw new Error(
    'Expected a published release with a vX.Y.Z[-prerelease] tag.',
  );
}

const version = release.tag_name.slice(1);
const isPrerelease = Boolean(match[2]);
if (release.prerelease !== isPrerelease) {
  throw new Error(
    'Prerelease version tags require the GitHub pre-release checkbox; stable version tags require it unchecked.',
  );
}

// Fail closed on registry errors. Only a missing version permits publication.
const response = await fetch(
  `https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/${encodeURIComponent(version)}`,
  { signal: AbortSignal.timeout(15_000), cache: 'no-store' },
);
if (response.ok) {
  throw new Error(
    `${metadata.name}@${version} is already published. Choose a new release tag.`,
  );
}
if (response.status !== 404) {
  throw new Error(
    `Cannot verify npm version availability: HTTP ${response.status}.`,
  );
}

// Only the runner's root manifest changes; no version commit or Git tag is made.
metadata.version = version;
writeFileSync('package.json', `${JSON.stringify(metadata, null, 2)}\n`);
const distTag = isPrerelease ? 'beta' : 'latest';
appendFileSync(process.env.GITHUB_OUTPUT, `dist_tag=${distTag}\n`);
console.log(`Prepared ${metadata.name}@${version} for ${distTag}.`);
