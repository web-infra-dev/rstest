import { init, parse } from 'es-module-lexer';
import MagicString from 'magic-string';

/**
 * A webpack/rspack loader that transforms static imports to top-level await dynamic imports
 * Example: import x from 'b' -> const x = await import('b')
 */
export default async function mockLoader(source, map) {
  const callback = this.async();

  try {
    // Initialize es-module-lexer
    await init;

    // Parse the source to find static imports
    const [imports] = parse(source);

    const magicString = new MagicString(source);

    const transformations = [];
    const isPureCjs = source.includes('module.exports = ');
    const flag = isPureCjs ? '; export {};' : '; export {};';

    // Collect transformations so we can hoist them later while keeping order
    for (let i = 0; i < imports.length; i++) {
      const importInfo = imports[i];
      const { ss: start, se: end, d: dynamicStart } = importInfo;

      // Skip dynamic imports (they already have d >= 0)
      if (dynamicStart >= 0) continue;

      // Extract the import statement
      const importStatement = source.slice(start, end);

      // Parse different import patterns
      let transformedImport = '';

      // Match: import defaultImport from 'module'
      const defaultImportMatch = importStatement.match(
        /import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (defaultImportMatch) {
        const [, defaultName, moduleName] = defaultImportMatch;
        transformedImport = `const ${defaultName} = (await import('${moduleName}')).default`;
      }

      // Match: import * as namespace from 'module'
      const namespaceImportMatch = importStatement.match(
        /import\s+\*\s+as\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (namespaceImportMatch) {
        const [, namespaceName, moduleName] = namespaceImportMatch;
        transformedImport = `const ${namespaceName} = await import('${moduleName}')`;
      }

      // Match: import { named1, named2 } from 'module'
      const namedImportMatch = importStatement.match(
        /import\s+\{([^}]+)\}\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (namedImportMatch) {
        const [, namedImports, moduleName] = namedImportMatch;
        const imports = namedImports
          .split(',')
          .map((imp) => {
            const trimmed = imp.trim();
            // Handle 'as' aliases: import { foo as bar } from 'module'
            const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
            if (aliasMatch) {
              return `${aliasMatch[1]}: ${aliasMatch[2]}`;
            }
            return trimmed;
          })
          .join(', ');

        transformedImport = `const { ${imports} } = await import('${moduleName}')`;
      }

      // Match: import 'module' (side-effect import)
      const sideEffectImportMatch = importStatement.match(
        /import\s+['"`]([^'"`]+)['"`]/,
      );
      if (
        sideEffectImportMatch &&
        !defaultImportMatch &&
        !namespaceImportMatch &&
        !namedImportMatch
      ) {
        const [, moduleName] = sideEffectImportMatch;
        transformedImport = `await import('${moduleName}')`;
      }

      // Match: import defaultImport, { named1, named2 } from 'module'
      const mixedImportMatch = importStatement.match(
        /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (mixedImportMatch) {
        const [, defaultName, namedImports, moduleName] = mixedImportMatch;
        const imports = namedImports
          .split(',')
          .map((imp) => {
            const trimmed = imp.trim();
            const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
            if (aliasMatch) {
              return `${aliasMatch[2]}: ${aliasMatch[1]}`;
            }
            return trimmed;
          })
          .join(', ');
        const safeModuleName = moduleName.replace(/[^a-zA-Z0-9_]/g, '_');
        transformedImport = `const __rstest_import_${safeModuleName} = await import('${moduleName}');
const ${defaultName} = __rstest_import_${safeModuleName}.default;
const { ${imports} } = __rstest_import_${safeModuleName}`;
      }

      // Match: import defaultImport, * as namespace from 'module'
      const mixedNamespaceImportMatch = importStatement.match(
        /import\s+(\w+)\s*,\s*\*\s+as\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (mixedNamespaceImportMatch) {
        const [, defaultName, namespaceName, moduleName] =
          mixedNamespaceImportMatch;
        const safeModuleName = moduleName.replace(/[^a-zA-Z0-9_]/g, '_');
        transformedImport = `const __rstest_import_${safeModuleName} = await import('${moduleName}');\nconst ${defaultName} = __rstest_import_${safeModuleName}.default;\nconst ${namespaceName} = __rstest_import_${safeModuleName}`;
      }

      // Apply the transformation
      if (transformedImport) {
        transformations.push({
          start,
          end,
          code: transformedImport + flag,
        });
      }
    }

    // Remove the original import statements from bottom to top
    for (let i = transformations.length - 1; i >= 0; i--) {
      const { start, end } = transformations[i];
      let removalEnd = end;

      while (
        removalEnd < source.length &&
        source[removalEnd] !== '\n' &&
        source.slice(removalEnd, removalEnd + 2) !== '\r\n'
      ) {
        removalEnd += 1;
      }

      if (source.slice(removalEnd, removalEnd + 2) === '\r\n') {
        removalEnd += 2;
      } else if (source[removalEnd] === '\n') {
        removalEnd += 1;
      }

      magicString.remove(start, removalEnd);
    }

    if (transformations.length > 0) {
      const hoistedCode = transformations.map(({ code }) => code).join('\n');

      const shebangEnd = source.startsWith('#!')
        ? source.indexOf('\n') + 1 || source.length
        : 0;

      let insertion = `${hoistedCode}\n`;
      if (shebangEnd > 0 && source[shebangEnd - 1] !== '\n') {
        insertion = `\n${insertion}`;
      }

      magicString.prependLeft(shebangEnd, insertion);
    }

    const result = magicString.toString();
    const newMap = magicString.generateMap({
      source: this.resourcePath,
      includeContent: true,
      hires: true,
    });
    newMap.names = map?.names ?? newMap.names;

    callback(null, result, map ?? newMap);
  } catch (error) {
    callback(error);
  }
}
