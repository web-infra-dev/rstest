#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { argv, stderr, stdout } from 'node:process';

const TYPE_MAP = {
  feat: 'feat',
  feature: 'feat',
  perf: 'perf',
  fix: 'fix',
  refactor: 'refactor',
  docs: 'docs',
  doc: 'docs',
};

// type(scope)?!?: subject (#PR)?
const COMMIT_RE =
  /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<subject>.+?)(?:\s+\(#(?<prNumber>\d+)\))?$/;

function classify(type, breaking) {
  if (breaking) {
    return 'breaking';
  }
  return TYPE_MAP[type.toLowerCase()] ?? 'other';
}

function collect(range) {
  const log = execSync(`git log ${range} --pretty=format:%H%x09%s`, {
    encoding: 'utf8',
  });

  const buckets = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    other: [],
  };

  for (const line of log.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const tabIndex = line.indexOf('\t');
    const sha = line.slice(0, tabIndex);
    const raw = line.slice(tabIndex + 1);
    const match = COMMIT_RE.exec(raw);

    if (!match?.groups) {
      buckets.other.push({
        sha,
        type: null,
        scope: null,
        subject: raw,
        prNumber: null,
        raw,
      });
      continue;
    }

    const { type, scope, breaking, subject, prNumber } = match.groups;
    const bucket = classify(type, breaking);

    buckets[bucket].push({
      sha,
      type,
      scope: scope ?? null,
      subject,
      prNumber: prNumber ?? null,
      raw,
    });
  }

  return buckets;
}

try {
  if (argv.length !== 3) {
    throw new Error('Usage: collect-commits.mjs <git-range>');
  }
  stdout.write(`${JSON.stringify(collect(argv[2]), null, 2)}\n`);
} catch (error) {
  stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
