import { appendFileSync, readFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
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

if (release.tag_name.slice(1) !== version) {
  throw new Error(
    `Release tag ${release.tag_name} does not match package.json version ${version}. Update the version on main before tagging.`,
  );
}

const distTag = release.prerelease || match[2] ? 'beta' : 'latest';
appendFileSync(process.env.GITHUB_OUTPUT, `dist_tag=${distTag}\n`);
console.log(`Publishing create-spatius-app@${version} to ${distTag}.`);
