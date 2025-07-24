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

    // Transform imports in reverse order to maintain correct string positions
    for (let i = imports.length - 1; i >= 0; i--) {
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
          // .filter((v) => {
          //   return !(v === 'rs' && moduleName === '@rstest/core');
          // })
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
        transformedImport = `const _importResult = await import('${moduleName}');\nconst ${defaultName} = _importResult.default;\nconst { ${imports} } = _importResult`;
      }

      // Match: import defaultImport, * as namespace from 'module'
      const mixedNamespaceImportMatch = importStatement.match(
        /import\s+(\w+)\s*,\s*\*\s+as\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/,
      );
      if (mixedNamespaceImportMatch) {
        const [, defaultName, namespaceName, moduleName] =
          mixedNamespaceImportMatch;
        transformedImport = `const ${namespaceName} = await import('${moduleName}');\nconst ${defaultName} = ${namespaceName}.default`;
      }

      const isPureCjs = source.includes('module.exports = ');
      const flag = isPureCjs ? '' : ';export {}';

      // Apply the transformation
      if (transformedImport) {
        magicString.overwrite(start, end, transformedImport + flag);
      }
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
