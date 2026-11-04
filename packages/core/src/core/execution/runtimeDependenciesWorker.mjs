import { spawnSync } from 'node:child_process';
import { readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const statistics = {
  candidates: 0,
  reads: 0,
  parses: 0,
  resolutions: 0,
  syntaxChecks: 0,
};
const parsedFiles = new Map();
const resolvedRequests = new Map();
const directoryEntries = new Map();
const realPaths = new Map();
const packageTypes = new Map();

function normalizePath(value) {
  const path = normalize(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? path.toLocaleLowerCase() : path;
}

async function canonicalPath(file) {
  if (!realPaths.has(file)) {
    realPaths.set(
      file,
      (async () => {
        let ancestor = file;
        const missingSegments = [];
        const visitedLinks = new Set();
        while (true) {
          try {
            return normalizePath(
              join(await realpath(ancestor), ...missingSegments),
            );
          } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
              throw error;
            let linkTarget;
            try {
              linkTarget = await readlink(ancestor);
            } catch (linkError) {
              if (!['EINVAL', 'ENOENT', 'ENOTDIR'].includes(linkError.code))
                throw linkError;
            }
            if (linkTarget !== undefined) {
              const identity = normalizePath(ancestor);
              if (visitedLinks.has(identity)) {
                throw new Error(`Cyclic missing-file symlink at ${ancestor}`, {
                  cause: error,
                });
              }
              visitedLinks.add(identity);
              ancestor = resolve(dirname(ancestor), linkTarget);
              continue;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) return normalizePath(file);
            // A deleted target can still have an existing symlinked directory.
            // Canonicalize that ancestor without changing the resolution origin.
            missingSegments.unshift(basename(ancestor));
            ancestor = parent;
          }
        }
      })(),
    );
  }
  return realPaths.get(file);
}

function expressionParts(node) {
  if (node.type === 'Literal' && typeof node.value === 'string')
    return [node.value];
  if (node.type === 'TemplateLiteral') {
    return node.quasis.flatMap((quasi, index) =>
      index < node.expressions.length
        ? [
            quasi.value.cooked ?? quasi.value.raw,
            ...expressionParts(node.expressions[index]),
          ]
        : [quasi.value.cooked ?? quasi.value.raw],
    );
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...expressionParts(node.left), ...expressionParts(node.right)];
  }
  return [null];
}

function joinParts(parts) {
  const joined = [];
  for (const part of parts) {
    if (typeof part === 'string' && typeof joined.at(-1) === 'string') {
      joined[joined.length - 1] += part;
    } else if (part !== null || joined.at(-1) !== null) {
      joined.push(part);
    }
  }
  return joined;
}

function children(node) {
  return Object.values(node).flatMap((value) => {
    if (Array.isArray(value)) return value.filter((item) => item?.type);
    return value?.type ? [value] : [];
  });
}

function bindsRequire(pattern) {
  if (!pattern) return false;
  if (pattern.type === 'Identifier') return pattern.name === 'require';
  if (pattern.type === 'RestElement') return bindsRequire(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindsRequire(pattern.left);
  if (pattern.type === 'ArrayPattern')
    return pattern.elements.some(bindsRequire);
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.some((property) =>
      bindsRequire(
        property.type === 'RestElement' ? property.argument : property.value,
      ),
    );
  }
  return false;
}

function functionShadowsRequire(node) {
  const visit = (child) => {
    if (
      child !== node &&
      (/Function/.test(child.type) ||
        child.type === 'ClassDeclaration' ||
        child.type === 'ClassExpression')
    )
      return false;
    if (child.type === 'VariableDeclaration' && child.kind === 'var') {
      return child.declarations.some((declaration) =>
        bindsRequire(declaration.id),
      );
    }
    return children(child).some(visit);
  };
  return visit(node);
}

function blockShadowsRequire(node) {
  return (node.body ?? []).some((statement) => {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      return statement.declarations.some((declaration) =>
        bindsRequire(declaration.id),
      );
    }
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type))
      return bindsRequire(statement.id);
    if (statement.type === 'ImportDeclaration')
      return statement.specifiers.some((specifier) =>
        bindsRequire(specifier.local),
      );
    return false;
  });
}

function collectCalls(tree) {
  const calls = [];
  const unsupported = [];
  const commonjs = tree.sourceType === 'script';
  const visit = (node, shadowed = false, parent) => {
    if (/Function/.test(node.type)) {
      if (
        node.type === 'FunctionDeclaration' &&
        bindsRequire(node.id) &&
        parent?.type === 'BlockStatement'
      ) {
        unsupported.push(
          'block function declarations named require are not supported',
        );
      }
      const parameterShadow =
        shadowed || bindsRequire(node.id) || node.params.some(bindsRequire);
      for (const parameter of node.params)
        visit(parameter, parameterShadow, node);
      visit(node.body, parameterShadow || functionShadowsRequire(node), node);
      return;
    }
    // CommonJS wraps the program in a function whose require parameter already
    // exists. A bare var declaration redeclares that parameter, not a new binding.
    if ((node.type === 'Program' && !commonjs) || node.type === 'StaticBlock')
      shadowed ||= functionShadowsRequire(node);
    if (['Program', 'BlockStatement', 'StaticBlock'].includes(node.type))
      shadowed ||= blockShadowsRequire(node);
    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration')
      shadowed ||= bindsRequire(node.id);
    if (node.type === 'CatchClause') shadowed ||= bindsRequire(node.param);
    if (
      ['ForStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)
    ) {
      const declaration = node.init ?? node.left;
      if (
        declaration?.type === 'VariableDeclaration' &&
        declaration.kind !== 'var'
      ) {
        shadowed ||= declaration.declarations.some((item) =>
          bindsRequire(item.id),
        );
      }
    }
    if (
      !shadowed &&
      ((node.type === 'VariableDeclarator' &&
        node.init &&
        bindsRequire(node.id)) ||
        (['ForInStatement', 'ForOfStatement'].includes(node.type) &&
          node.left.type === 'VariableDeclaration' &&
          node.left.declarations.some((item) => bindsRequire(item.id))))
    ) {
      unsupported.push('reassigned native require is not supported');
    }
    if (
      [
        'ImportDeclaration',
        'ExportAllDeclaration',
        'ExportNamedDeclaration',
      ].includes(node.type) &&
      node.source
    ) {
      calls.push({ kind: 'import', parts: [node.source.value] });
    } else if (node.type === 'ImportExpression') {
      calls.push({
        kind: 'import',
        parts: joinParts(expressionParts(node.source)),
      });
    } else if (node.type === 'CallExpression') {
      const callee = node.callee;
      const directRequire =
        callee.type === 'Identifier' && callee.name === 'require';
      const requireResolve =
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'require' &&
        callee.property.name === 'resolve';
      if (!shadowed && (directRequire || requireResolve)) {
        if (
          node.arguments.length !== 1 ||
          node.arguments[0].type === 'SpreadElement'
        ) {
          unsupported.push('require call arguments are not supported');
        } else {
          calls.push({
            kind: requireResolve ? 'resolve' : 'require',
            parts: joinParts(expressionParts(node.arguments[0])),
          });
        }
      }
      const member =
        callee.type === 'MemberExpression'
          ? callee.computed
            ? callee.property.value
            : callee.property.name
          : undefined;
      if (
        (callee.type === 'Identifier' &&
          ['eval', 'createRequire', 'Function'].includes(callee.name)) ||
        ['createRequire', 'require', 'registerHooks', 'register'].includes(
          member,
        )
      ) {
        unsupported.push('indirect native loading is not supported');
      }
    }
    // A native require may only be called directly or through direct .resolve().
    // Extracting members can alias resolution; extensions/cache/main expose
    // mutable loader state that this source-only analysis cannot follow.
    if (
      !shadowed &&
      node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      node.object.name === 'require' &&
      !(
        !node.computed &&
        node.property.name === 'resolve' &&
        parent?.type === 'CallExpression' &&
        parent.callee === node
      )
    ) {
      unsupported.push(
        'indirect native require capabilities are not supported',
      );
    }
    if (
      node.type === 'Identifier' &&
      node.name === 'require' &&
      !shadowed &&
      parent &&
      !(parent.type === 'CallExpression' && parent.callee === node) &&
      !(parent.type === 'MemberExpression' && parent.object === node) &&
      !(
        parent.type === 'VariableDeclarator' &&
        parent.id === node &&
        !parent.init
      ) &&
      !(parent.type === 'UnaryExpression' && parent.operator === 'typeof') &&
      !(
        parent.type === 'Property' &&
        parent.key === node &&
        !parent.computed &&
        !parent.shorthand
      )
    ) {
      unsupported.push('aliased or reassigned require is not supported');
    }
    if (
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Function'
    ) {
      unsupported.push('generated JavaScript is not supported');
    }
    for (const child of children(node)) visit(child, shadowed, node);
  };
  visit(tree);
  return { calls, unsupported };
}

async function moduleType(file) {
  if (extname(file) === '.mjs') return { type: 'module', manifests: [] };
  if (extname(file) === '.cjs') return { type: 'script', manifests: [] };
  const manifests = [];
  let directory = dirname(file);
  while (true) {
    const manifest = join(directory, 'package.json');
    manifests.push(manifest);
    if (!packageTypes.has(manifest)) {
      packageTypes.set(
        manifest,
        readFile(manifest, 'utf8')
          .then((source) => {
            statistics.reads++;
            return JSON.parse(source).type ?? 'detect';
          })
          .catch((error) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          }),
      );
    }
    const type = await packageTypes.get(manifest);
    if (type !== undefined) {
      return {
        type:
          type === 'module'
            ? 'module'
            : type === 'commonjs'
              ? 'script'
              : 'detect',
        manifests,
      };
    }
    const parent = dirname(directory);
    if (parent === directory) return { type: 'detect', manifests };
    directory = parent;
  }
}

async function readCalls(file) {
  if (parsedFiles.has(file)) return parsedFiles.get(file);
  const pending = (async () => {
    const extension = extname(file);
    if (extension === '.json') return { calls: [], unsupported: [] };
    if (!['.mjs', '.cjs', '.js'].includes(extension)) {
      return {
        calls: [],
        unsupported: [
          `unsupported native source format ${extension || '(none)'}`,
        ],
      };
    }
    let source;
    try {
      source = await readFile(file, 'utf8');
      statistics.reads++;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        return { calls: [], unsupported: [] };
      throw error;
    }
    const { type, manifests } = await moduleType(file);
    let tree;
    try {
      statistics.parses++;
      try {
        tree = parse(source, {
          ecmaVersion: 'latest',
          sourceType: type === 'detect' ? 'script' : type,
          allowHashBang: true,
          allowReturnOutsideFunction: type !== 'module',
        });
      } catch (error) {
        if (type !== 'detect') throw error;
        tree = parse(source, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          allowHashBang: true,
        });
      }
    } catch {
      // Only Node-confirmed invalid plain JavaScript is terminal. A parser
      // feature gap must remain incomplete instead of losing native imports.
      statistics.syntaxChecks++;
      const checked = spawnSync(
        process.execPath,
        [...process.execArgv, '--check', file],
        { encoding: 'utf8' },
      );
      if (checked.status !== 0 && /SyntaxError:/.test(checked.stderr ?? '')) {
        return { calls: [], unsupported: [], manifests };
      }
      return {
        calls: [],
        unsupported: [
          'source cannot be analyzed with the supported JavaScript grammar',
        ],
      };
    }
    return { ...collectCalls(tree), manifests };
  })();
  parsedFiles.set(file, pending);
  return pending;
}

async function resolveRequest(specifier, origin, kind) {
  const key = JSON.stringify([specifier, origin, kind]);
  if (resolvedRequests.has(key)) return resolvedRequests.get(key);
  const pending = (async () => {
    // The module API can create or replace native loaders under arbitrary local
    // aliases. Requiring declarations here also rejects benign uses of this API.
    if (
      kind !== 'resolve' &&
      (specifier === 'node:module' || specifier === 'module')
    ) {
      throw new Error(
        'native module-loading APIs require an explicit complete dependency declaration',
      );
    }
    if (isBuiltin(specifier)) return null;
    if (
      !/^\.\.?\//.test(specifier) ||
      !/\.(?:mjs|cjs|js|json)$/.test(specifier)
    ) {
      throw new Error(
        'automatic native analysis supports relative requests with an explicit JavaScript or JSON extension; declare other dependency closures explicitly',
      );
    }
    statistics.resolutions++;
    try {
      const resolved =
        kind === 'import'
          ? import.meta.resolve(specifier, pathToFileURL(origin).href)
          : createRequire(origin).resolve(specifier);
      if (resolved.startsWith('node:')) return null;
      const file = resolved.startsWith('file:')
        ? fileURLToPath(resolved)
        : resolved;
      if (!isAbsolute(file))
        throw new Error(`unsupported native URL ${resolved}`);
      return { file, canonical: await canonicalPath(file) };
    } catch (error) {
      if (
        (error.code === 'MODULE_NOT_FOUND' ||
          error.code === 'ERR_MODULE_NOT_FOUND') &&
        /^\.\.?\//.test(specifier) &&
        /\.(?:mjs|cjs|js|json)$/.test(specifier)
      ) {
        const file = resolve(dirname(origin), specifier);
        return { file, canonical: await canonicalPath(file) };
      }
      throw error;
    }
  })();
  resolvedRequests.set(key, pending);
  return pending;
}

async function targets(call, origin, sources, patternSemantics) {
  if (call.unsupported) throw new Error(call.unsupported);
  if (!call.parts) throw new Error('opaque request expression');
  const parts = joinParts(call.parts);
  if (!parts.includes(null)) {
    const target = await resolveRequest(parts.join(''), origin, call.kind);
    return target ? [target] : [];
  }
  if (patternSemantics !== 'single-segment-potential-targets') {
    throw new Error(
      'a computed request has an unproven runtime path domain; literal segments do not exclude separators or parent traversal. Declare the complete runtime dependency closure',
    );
  }
  const prefix = parts[0];
  const suffix = parts.at(-1);
  if (
    typeof prefix !== 'string' ||
    !/^\.\.?\//.test(prefix) ||
    typeof suffix !== 'string' ||
    !/\.(?:mjs|cjs|js|json)$/.test(suffix)
  ) {
    throw new Error(
      'computed requests need a fixed relative directory and explicit JavaScript or JSON extension',
    );
  }
  const slash = prefix.lastIndexOf('/');
  const directory = resolve(dirname(origin), prefix.slice(0, slash + 1));
  const filenameParts = [prefix.slice(slash + 1), ...parts.slice(1)];
  if (
    filenameParts.some((part) => typeof part === 'string' && /[/\\]/.test(part))
  ) {
    throw new Error('computed directory segments are not supported');
  }
  const pattern = new RegExp(
    `^${filenameParts.map((part) => (part === null ? '[^/\\\\]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`,
  );
  if (!directoryEntries.has(directory)) {
    directoryEntries.set(
      directory,
      readdir(directory, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
        throw error;
      }),
    );
  }
  const names = new Set(
    (await directoryEntries.get(directory))
      .filter(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) &&
          pattern.test(entry.name),
      )
      .map((entry) => entry.name),
  );
  for (const source of sources) {
    const name = relative(directory, source);
    if (pattern.test(name)) names.add(name);
  }
  const result = [];
  for (const name of [...names].sort()) {
    const specifier = prefix.slice(0, slash + 1) + name;
    const target = await resolveRequest(specifier, origin, call.kind);
    if (target) {
      statistics.candidates++;
      result.push(target);
    }
  }
  return result;
}

async function analyze({
  requests,
  sources,
  patternSemantics = 'complete-declarations-or-literals',
}) {
  const requestedPaths = new Set(sources.map(normalizePath));
  for (const source of sources) requestedPaths.add(await canonicalPath(source));
  const grouped = new Map();
  for (const request of requests) {
    const group = grouped.get(request.consumer) ?? [];
    group.push(request);
    grouped.set(request.consumer, group);
  }
  const consumers = [];
  const unresolved = [];
  for (const [consumer, group] of grouped) {
    const queue = group.map(({ source, call }) => ({ origin: source, call }));
    const seen = new Set();
    const errors = [];
    let matched = false;
    for (let index = 0; index < queue.length; index++) {
      const { origin, call } = queue[index];
      try {
        const dependencies = await targets(
          call,
          origin,
          sources,
          patternSemantics,
        );
        for (const { file, canonical } of dependencies) {
          if (
            requestedPaths.has(normalizePath(file)) ||
            requestedPaths.has(canonical)
          ) {
            matched = true;
          }
        }
        if (call.kind === 'resolve') continue;
        for (const { file } of dependencies) {
          // With --preserve-symlinks, two names for one file have different
          // relative import origins even though their real paths are equal.
          const identity = normalizePath(file);
          if (seen.has(identity)) continue;
          seen.add(identity);
          const parsed = await readCalls(file);
          if (
            parsed.manifests?.some((file) =>
              requestedPaths.has(normalizePath(file)),
            )
          ) {
            matched = true;
          }
          errors.push(
            ...parsed.unsupported.map((reason) => `${file}: ${reason}`),
          );
          queue.push(
            ...parsed.calls.map((dependency) => ({
              origin: file,
              call: dependency,
            })),
          );
        }
      } catch (error) {
        errors.push(`${origin}: ${error.message}`);
      }
    }
    // An unsupported loader capability can invalidate an apparent literal edge.
    // A match is only complete after every reachable native input is analyzed.
    if (errors.length > 0) unresolved.push(...errors);
    else if (matched) consumers.push(consumer);
  }
  return {
    consumers,
    unresolved: [...new Set(unresolved)],
    contract: { patternSemantics },
    statistics,
  };
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  process.stdout.write(JSON.stringify(await analyze(JSON.parse(input))));
} catch (error) {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
}
