#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { argv, stderr, stdout } from 'node:process';

const TAG_PREFIX = 'v';
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseSemver(version) {
  const stripped = version.startsWith(TAG_PREFIX)
    ? version.slice(TAG_PREFIX.length)
    : version;
  const match = SEMVER_RE.exec(stripped);
  if (!match) {
    throw new Error(`Not a semver: ${version}`);
  }
  return {
    raw: stripped,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

function listTags() {
  return execSync('git tag --sort=-v:refname', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyBump(next) {
  if (next.patch > 0) {
    return 'patch';
  }
  if (next.minor > 0) {
    return 'minor';
  }
  return 'major';
}

function resolveSameTier(next, bump, tags) {
  if (bump === 'patch') {
    const tag = `${TAG_PREFIX}${next.major}.${next.minor}.${next.patch - 1}`;
    return tags.includes(tag) ? tag : null;
  }
  if (bump === 'minor') {
    const tag = `${TAG_PREFIX}${next.major}.${next.minor - 1}.0`;
    return tags.includes(tag) ? tag : null;
  }
  // major bump — pick the highest tag from the previous major series
  if (next.major > 0) {
    const candidates = tags
      .map((tag) => {
        try {
          return { tag, parsed: parseSemver(tag) };
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.parsed.major === next.major - 1);
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => compareSemver(b.parsed, a.parsed));
    return candidates[0].tag;
  }
  return null;
}

function resolveLatest(next, tags) {
  for (const tag of tags) {
    let parsed;
    try {
      parsed = parseSemver(tag);
    } catch {
      continue;
    }
    if (compareSemver(parsed, next) < 0) {
      return tag;
    }
  }
  return null;
}

try {
  if (argv.length !== 3) {
    throw new Error('Usage: resolve-range-start.mjs <next-version>');
  }
  const next = parseSemver(argv[2]);
  const tags = listTags();
  const bump = classifyBump(next);
  const sameTier = resolveSameTier(next, bump, tags);
  const latest = resolveLatest(next, tags);

  stdout.write(
    `${JSON.stringify(
      {
        nextVersion: next.raw,
        bump,
        sameTier,
        latest,
        sameTierEqualsLatest: sameTier !== null && sameTier === latest,
        tagPrefix: TAG_PREFIX,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
