#!/usr/bin/env node
/**
 * Static analysis script for the generating-tests skill.
 *
 * Extracts exports and throw/reject statements from a TypeScript source file
 * using the TypeScript compiler API (parse-only, no type-checking).
 *
 * Usage:
 *   node analyzeSource.cjs <file> [file2 ...]
 *
 * Supports .ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs files.
 * Requires `typescript` to be resolvable (installed in the project or globally).
 *
 * Output: JSON to stdout
 */
'use strict';

const fs = require('node:fs');

let ts;
try {
  ts = require('typescript');
} catch {
  console.error(
    'Error: typescript is not installed. Install it as a dev dependency or globally to use static analysis.',
  );
  console.error(
    'Falling back: the generating-tests skill will use manual source scanning instead.',
  );
  process.exit(1);
}

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.mts') || file.endsWith('.cts') || file.endsWith('.ts'))
    return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function analyze(file) {
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  const result = {
    file,
    exports: [],
    throws: [],
  };

  const line = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const text = (node) => (node ? node.getText(sf) : null);

  function hasModifier(node, kind) {
    return !!ts.getModifiers(node)?.some((m) => m.kind === kind);
  }
  function isExported(node) {
    return hasModifier(node, ts.SyntaxKind.ExportKeyword);
  }
  function isDefault(node) {
    return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  }

  function extractMessage(rawExpr) {
    let expr = rawExpr;
    if (!expr) return null;
    // unwrap parens
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;

    // throw "message" or throw `message`
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
    // throw new Error("message")
    if (ts.isNewExpression(expr) && expr.arguments?.length) {
      let first = expr.arguments[0];
      while (ts.isParenthesizedExpression(first)) first = first.expression;
      if (
        ts.isStringLiteral(first) ||
        ts.isNoSubstitutionTemplateLiteral(first)
      ) {
        return first.text;
      }
    }
    return null;
  }

  function visit(node) {
    // --- Exports ---
    if (isExported(node)) {
      const def = isDefault(node);
      if (ts.isFunctionDeclaration(node) && node.name) {
        result.exports.push({
          kind: 'function',
          name: node.name.text,
          line: line(node),
          default: def,
        });
      } else if (ts.isClassDeclaration(node) && node.name) {
        result.exports.push({
          kind: 'class',
          name: node.name.text,
          line: line(node),
          default: def,
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        result.exports.push({
          kind: 'interface',
          name: node.name.text,
          line: line(node),
          default: false,
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        result.exports.push({
          kind: 'type',
          name: node.name.text,
          line: line(node),
          default: false,
        });
      } else if (ts.isEnumDeclaration(node)) {
        result.exports.push({
          kind: 'enum',
          name: node.name.text,
          line: line(node),
          default: false,
        });
      } else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          result.exports.push({
            kind: 'variable',
            name: text(d.name),
            line: line(d),
            default: false,
          });
        }
      }
    }

    if (ts.isExportAssignment(node)) {
      result.exports.push({
        kind: 'default',
        name: text(node.expression),
        line: line(node),
        default: true,
      });
    }

    if (ts.isExportDeclaration(node)) {
      const from = node.moduleSpecifier
        ? text(node.moduleSpecifier).slice(1, -1)
        : null;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          result.exports.push({
            kind: el.isTypeOnly ? 'type' : 'named',
            name: el.propertyName ? el.propertyName.text : el.name.text,
            exportedAs: el.name.text,
            from,
            line: line(el),
            default: false,
          });
        }
      } else if (!node.exportClause) {
        result.exports.push({
          kind: 'star',
          name: '*',
          from,
          line: line(node),
          default: false,
        });
      }
    }

    // --- Throws / Rejects ---
    if (ts.isThrowStatement(node)) {
      result.throws.push({
        kind: 'throw',
        line: line(node),
        message: extractMessage(node.expression),
        expression: text(node.expression),
      });
    }

    if (ts.isCallExpression(node)) {
      const callee = text(node.expression);
      if (
        callee === 'Promise.reject' ||
        callee === 'reject' ||
        callee?.endsWith('.reject')
      ) {
        const arg0 = node.arguments?.[0];
        result.throws.push({
          kind: 'reject',
          line: line(node),
          message: arg0 ? extractMessage(arg0) : null,
          expression: arg0 ? text(arg0) : null,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return result;
}

// --- Main ---
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node analyzeSource.cjs <file> [file2 ...]');
  process.exit(1);
}

const results = files.map((f) => analyze(f));
console.log(
  JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
);
