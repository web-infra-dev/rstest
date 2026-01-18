import { dirname, normalize, relative } from 'pathe';
import {
  excludePatternsToRegExp,
  globPatternsToRegExp,
} from '../manifest/globs';
import type { BrowserProjectEntries } from '../runtime/types';

/**
 * Format environment name to a valid JavaScript identifier.
 * Replaces non-alphanumeric characters with underscores.
 */
const toSafeVarName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
};

export const generateManifestModule = ({
  manifestPath,
  entries,
}: {
  manifestPath: string;
  entries: BrowserProjectEntries[];
}): string => {
  const manifestDirPosix = normalize(dirname(manifestPath));

  const toRelativeImport = (filePath: string): string => {
    const posixPath = normalize(filePath);
    let relativePath = relative(manifestDirPosix, posixPath);
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return relativePath;
  };

  const lines: string[] = [];

  // 1. Export all projects configuration
  lines.push('// All projects configuration');
  lines.push('export const projects = [');
  for (const { project } of entries) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(project.name)},`);
    lines.push(
      `    environmentName: ${JSON.stringify(project.environmentName)},`,
    );
    lines.push(
      `    projectRoot: ${JSON.stringify(normalize(project.rootPath))},`,
    );
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  // 2. Setup loaders for each project
  lines.push('// Setup loaders for each project');
  lines.push('export const projectSetupLoaders = {');
  for (const { project, setupFiles } of entries) {
    lines.push(`  ${JSON.stringify(project.name)}: [`);
    for (const filePath of setupFiles) {
      const relativePath = toRelativeImport(filePath);
      lines.push(`    () => import(${JSON.stringify(relativePath)}),`);
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');

  // 3. Test context for each project
  lines.push('// Test context for each project');
  for (const { project } of entries) {
    const varName = `context_${toSafeVarName(project.environmentName)}`;
    const projectRootPosix = normalize(project.rootPath);
    const includeRegExp = globPatternsToRegExp(
      project.normalizedConfig.include,
    );
    const excludePatterns = project.normalizedConfig.exclude.patterns;
    const excludeRegExp = excludePatternsToRegExp(excludePatterns);

    lines.push(
      `const ${varName} = import.meta.webpackContext(${JSON.stringify(projectRootPosix)}, {`,
    );
    lines.push('  recursive: true,');
    lines.push(`  regExp: ${includeRegExp.toString()},`);
    if (excludeRegExp) {
      lines.push(`  exclude: ${excludeRegExp.toString()},`);
    }
    lines.push("  mode: 'lazy',");
    lines.push('});');
    lines.push('');
  }

  // 4. Export test contexts object
  lines.push('export const projectTestContexts = {');
  for (const { project } of entries) {
    const varName = `context_${toSafeVarName(project.environmentName)}`;
    lines.push(`  ${JSON.stringify(project.name)}: {`);
    lines.push(`    getTestKeys: () => ${varName}.keys(),`);
    lines.push(`    loadTest: (key) => ${varName}(key),`);
    lines.push(
      `    projectRoot: ${JSON.stringify(normalize(project.rootPath))},`,
    );
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  // 5. Backward compatibility exports (use first project as default)
  lines.push('// Backward compatibility: export first project as default');
  lines.push('export const projectConfig = projects[0];');
  lines.push(
    'export const setupLoaders = projectSetupLoaders[projects[0].name] || [];',
  );
  lines.push('const _defaultCtx = projectTestContexts[projects[0].name];');
  lines.push(
    'export const getTestKeys = () => _defaultCtx ? _defaultCtx.getTestKeys() : [];',
  );
  lines.push(
    'export const loadTest = (key) => _defaultCtx ? _defaultCtx.loadTest(key) : Promise.reject(new Error("No project found"));',
  );

  return `${lines.join('\n')}\n`;
};
