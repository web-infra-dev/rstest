import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from 'package-manager-detector';
import { detect as detectPM } from 'package-manager-detector/detect';
import { readPackageJson } from './utils';

export type { Agent };

export interface ProjectInfo {
  /** Detected framework, null if not detected */
  framework: 'react' | null;
  /** Detected language */
  language: 'ts' | 'js';
  /** Detected or default test directory (relative path) */
  testDir: string;
  /** Detected package manager agent */
  agent: Agent;
  /** React version if detected */
  reactVersion: string | null;
}

/**
 * Detect package manager using package-manager-detector.
 */
async function detectPackageManagerAgent(cwd: string): Promise<Agent> {
  const result = await detectPM({ cwd });
  return result?.agent ?? 'npm';
}

/**
 * Detect test directory.
 * Check in order: tests/ -> test/ -> __tests__/ -> src/__tests__/
 * Returns 'tests/' as default if none exists.
 */
function detectTestDir(cwd: string): string {
  const candidates = ['tests', 'test', '__tests__', 'src/__tests__'];

  for (const dir of candidates) {
    const fullPath = path.join(cwd, dir);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      return dir;
    }
  }

  return 'tests';
}

/**
 * Detect React and its version from package.json.
 */
function detectReact(pkg: Record<string, unknown>): {
  detected: boolean;
  version: string | null;
} {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

  const reactVersion = deps.react ?? devDeps.react ?? null;

  if (reactVersion) {
    // Clean up version string (remove ^, ~, etc.)
    const cleanVersion = reactVersion.replace(/^[\^~>=<]+/, '');
    return { detected: true, version: cleanVersion };
  }

  return { detected: false, version: null };
}

/**
 * Detect TypeScript by checking tsconfig.json existence.
 */
function detectTypeScript(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, 'tsconfig.json'));
}

/**
 * Detect project information.
 */
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const pkg = readPackageJson(cwd);
  const { detected: hasReact, version: reactVersion } = pkg
    ? detectReact(pkg)
    : { detected: false, version: null };
  const hasTypeScript = detectTypeScript(cwd);
  const testDir = detectTestDir(cwd);
  const agent = await detectPackageManagerAgent(cwd);

  return {
    framework: hasReact ? 'react' : null,
    language: hasTypeScript ? 'ts' : 'js',
    testDir,
    agent,
    reactVersion,
  };
}
