import fs from 'node:fs';
import path from 'node:path';

/**
 * Get a unique file name by appending _1, _2, etc. if the file already exists.
 * @param dir Directory path
 * @param baseName Base file name without extension (e.g., 'HelloWorld')
 * @param ext File extension including dot (e.g., '.tsx')
 * @returns Unique base name (e.g., 'HelloWorld' or 'HelloWorld_1')
 */
export function getUniqueBaseName(
  dir: string,
  baseName: string,
  ext: string,
): string {
  const fullPath = path.join(dir, `${baseName}${ext}`);
  if (!fs.existsSync(fullPath)) {
    return baseName;
  }

  let suffix = 1;
  while (fs.existsSync(path.join(dir, `${baseName}_${suffix}${ext}`))) {
    suffix++;
  }
  return `${baseName}_${suffix}`;
}

/**
 * Ensure a directory exists, creating it if necessary.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write content to a file.
 */
export function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read package.json from a directory.
 */
export function readPackageJson(cwd: string): Record<string, unknown> | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update package.json scripts.
 */
export function updatePackageJsonScripts(
  cwd: string,
  scripts: Record<string, string>,
): void {
  const pkgPath = path.join(cwd, 'package.json');

  let pkg: Record<string, unknown>;
  if (fs.existsSync(pkgPath)) {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    pkg = JSON.parse(content);
  } else {
    pkg = {};
  }

  const existingScripts = (pkg.scripts ?? {}) as Record<string, string>;
  pkg.scripts = { ...existingScripts, ...scripts };

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

/**
 * Update package.json devDependencies.
 * Only adds dependencies that don't already exist.
 */
export function updatePackageJsonDevDeps(
  cwd: string,
  deps: Record<string, string>,
): void {
  const pkgPath = path.join(cwd, 'package.json');

  let pkg: Record<string, unknown>;
  if (fs.existsSync(pkgPath)) {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    pkg = JSON.parse(content);
  } else {
    pkg = {};
  }

  const existingDevDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

  // Only add deps that don't already exist
  for (const [name, version] of Object.entries(deps)) {
    if (!existingDevDeps[name]) {
      existingDevDeps[name] = version;
    }
  }

  pkg.devDependencies = existingDevDeps;

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}
