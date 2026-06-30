/*
 * Portions of this file are derived from ast-v8-to-istanbul.
 *
 * MIT License
 *
 * Copyright (c) 2026 Ari Perkkio
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// cspell:ignore Perkkio

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allGeneratedPositionsFor,
  LEAST_UPPER_BOUND,
  originalPositionFor,
  sourceContentFor,
  TraceMap,
  type DecodedSourceMap,
  type EncodedSourceMap,
  type Needle,
  type SourceMapInput,
  type SourceMapSegment,
} from '@jridgewell/trace-mapping';
import type { Profiler } from 'node:inspector';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import jsTokens from 'js-tokens';
import { walk } from 'estree-walker';

type SourceMapLike = Omit<EncodedSourceMap, 'version'> & { version: number };
type AstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

type BranchType = 'if' | 'binary-expr' | 'cond-expr' | 'switch' | 'default-arg';
type Position = Needle & { filename: string | null };
type MappedLocation = { start: Position; end: Position };
type IstanbulLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};
type PartialLocation = {
  start: Partial<Needle>;
  end: Partial<Needle>;
};
type IgnoreHint = {
  type: 'if' | 'else' | 'next' | 'file';
  loc: { start: number; end: number };
};
type NormalizedRange = { start: number; end: number; count: number };
type RawCoverageRange = NormalizedRange & { area: number; order: number };
type FileTemplate = Omit<FileCoverageData, 's' | 'f' | 'b'> & {
  statementCount: number;
  functionCount: number;
  branchLengths: Record<string, number>;
  seen: Record<string, number>;
  fnNames: Map<string, number>;
};
type FunctionDescriptor = {
  filename: string;
  index: number;
  startOffset: number;
  endOffset: number;
};
type StatementDescriptor = FunctionDescriptor;
type BranchRangeDescriptor = {
  startOffset: number;
  endOffset: number;
  implicit?: boolean;
};
type BranchDescriptor = {
  filename: string;
  index: number;
  ranges: BranchRangeDescriptor[];
};
type PreparedCoverage = {
  files: Record<string, FileTemplate>;
  functions: FunctionDescriptor[];
  statements: StatementDescriptor[];
  branches: BranchDescriptor[];
};

type ConvertOptions = {
  ast: unknown;
  cacheKey: string;
  code: string;
  coverage: Pick<Profiler.ScriptCoverage, 'functions' | 'url'>;
  sourceMap?: SourceMapLike;
  sourceFilter?: (filePath: string) => boolean;
};

const WORD_PATTERN = /(\w+|\s|[^\w\s])/g;
const INLINE_MAP_PATTERN = /[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/m;
const BASE_64_SOURCE_MAP_PATTERN =
  /^data:application\/json(?:;[^,]*)?;base64,/i;
const IGNORE_PATTERN =
  /^\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(if|else|next|file)(?=\W|$)/;
const IGNORE_LINES_PATTERN =
  /\s*(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(start|stop)(?=\W|$)/;
const EOL_PATTERN = /\r?\n/g;
const MAX_PREPARED_CACHE_SIZE = 50;

const preparedCache = new Map<string, Promise<PreparedCoverage>>();

export async function convertV8CoverageWithAst(
  options: ConvertOptions,
): Promise<Record<string, FileCoverageData>> {
  const ignoreHints = getIgnoreHints(options.code);

  if (ignoreHints.length === 1 && ignoreHints[0]?.type === 'file') {
    return {};
  }

  let prepared = preparedCache.get(options.cacheKey);
  if (!prepared) {
    prepared = prepareCoverage(options, ignoreHints);
    preparedCache.set(options.cacheKey, prepared);

    if (preparedCache.size > MAX_PREPARED_CACHE_SIZE) {
      const firstKey = preparedCache.keys().next().value;
      if (firstKey) {
        preparedCache.delete(firstKey);
      }
    }
  }

  return applyCoverage(await prepared, normalize(options.coverage));
}

async function prepareCoverage(
  options: ConvertOptions,
  ignoreHints: IgnoreHint[],
): Promise<PreparedCoverage> {
  const filename = fileURLToPath(options.coverage.url);
  const directory = dirname(filename);
  const mapInput =
    options.sourceMap ||
    (await getInlineSourceMap(filename, options.code)) ||
    createEmptySourceMap(filename, options.code);
  const sourceMap = new TraceMap(mapInput as SourceMapInput);
  const locator = new Locator(sourceMap, options.code);
  const builder = new CoverageBuilder(
    filename,
    sourceMap,
    locator,
    directory,
    options.sourceFilter,
  );
  const skippedNodes = new WeakSet<AstNode>();
  const coveredNodes = new WeakSet<AstNode>();
  let nextIgnore: AstNode | false = false;

  const getIgnoreHint = (node: AstNode) => {
    for (const hint of ignoreHints) {
      if (hint.loc.end === node.start) {
        return hint.type;
      }
    }

    return null;
  };

  const setSkipped = (node: AstNode | null | undefined) => {
    if (node) {
      skippedNodes.add(node);
    }
  };

  const isSkipped = (node: AstNode | null | undefined) =>
    Boolean(node && skippedNodes.has(node));

  walk(options.ast as Parameters<typeof walk>[0], {
    enter(node) {
      const current = node as AstNode;
      if (nextIgnore !== false) {
        return;
      }

      const hint = getIgnoreHint(current);

      if (hint === 'next') {
        nextIgnore = current;
        return;
      }

      if (isSkipped(current)) {
        nextIgnore = current;
        return;
      }

      switch (current.type) {
        case 'FunctionDeclaration': {
          const body = current.body as AstNode;
          builder.addFunction(current, {
            loc: body,
            decl: (current.id as AstNode | null) || {
              ...current,
              end: current.start + 1,
            },
          });
          return;
        }
        case 'FunctionExpression': {
          if (coveredNodes.has(current)) {
            return;
          }

          const body = current.body as AstNode;
          builder.addFunction(current, {
            loc: body,
            decl: (current.id as AstNode | null) || {
              ...current,
              end: current.start + 1,
            },
          });
          return;
        }
        case 'MethodDefinition': {
          const value = current.value as AstNode;
          if (value.type === 'FunctionExpression') {
            coveredNodes.add(value);
          }

          builder.addFunction(current, {
            loc: value.body as AstNode,
            decl: current.key as AstNode,
          });
          return;
        }
        case 'Property': {
          const value = current.value as AstNode;
          if (value.type === 'FunctionExpression') {
            coveredNodes.add(value);
            builder.addFunction(current, {
              loc: value.body as AstNode,
              decl: current.key as AstNode,
            });
          }
          return;
        }
        case 'ArrowFunctionExpression': {
          let body = current.body as AstNode;
          if (body.type === 'ParenthesizedExpression') {
            body = body.expression as AstNode;
            current.body = body;
          }

          builder.addFunction(current, {
            loc: body,
            decl: { ...current, end: current.start + 1 },
          });

          if (body.type !== 'BlockStatement') {
            builder.addStatement(body, current);
          }
          return;
        }
        case 'ExpressionStatement': {
          const expression = current.expression as AstNode & {
            value?: unknown;
          };
          if (
            expression.type !== 'Literal' ||
            expression.value !== 'use strict'
          ) {
            builder.addStatement(current);
          }
          return;
        }
        case 'BreakStatement':
        case 'ContinueStatement':
        case 'DebuggerStatement':
        case 'ReturnStatement':
        case 'ThrowStatement':
        case 'TryStatement':
        case 'ForStatement':
        case 'ForInStatement':
        case 'ForOfStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'WithStatement':
        case 'LabeledStatement': {
          builder.addStatement(current);
          return;
        }
        case 'VariableDeclarator': {
          if (current.init) {
            builder.addStatement(current.init as AstNode, current);
          }
          return;
        }
        case 'ClassBody': {
          const children = current.body as AstNode[];
          for (const child of children) {
            if (
              (child.type === 'PropertyDefinition' ||
                child.type === 'ClassProperty' ||
                child.type === 'ClassPrivateProperty') &&
              child.value
            ) {
              builder.addStatement(child.value as AstNode);
            }
          }
          return;
        }
        case 'IfStatement': {
          const branches: (AstNode | null | undefined)[] = [];
          const consequent = toBlockStatement(current.consequent as AstNode);
          current.consequent = consequent;
          const alternate = current.alternate
            ? toBlockStatement(current.alternate as AstNode)
            : null;
          current.alternate = alternate;

          if (hint === 'if') {
            setSkipped(consequent);
          } else {
            branches.push(consequent);
          }

          if (hint === 'else' && alternate) {
            setSkipped(alternate);
          } else if (hint !== 'if' && hint !== 'else') {
            branches.push(alternate);
          }

          builder.addBranch('if', current, branches);
          builder.addStatement(current);
          return;
        }
        case 'SwitchStatement': {
          const cases = (current.cases as AstNode[]).filter(
            (switchCase) => getIgnoreHint(switchCase) !== 'next',
          );
          builder.addBranch('switch', current, cases);
          builder.addStatement(current);
          return;
        }
        case 'ConditionalExpression': {
          let consequent = current.consequent as AstNode;
          let alternate = current.alternate as AstNode;
          const branches: AstNode[] = [];

          if (consequent.type === 'ParenthesizedExpression') {
            consequent = consequent.expression as AstNode;
            current.consequent = consequent;
          }
          if (alternate.type === 'ParenthesizedExpression') {
            alternate = alternate.expression as AstNode;
            current.alternate = alternate;
          }

          if (getIgnoreHint(consequent) === 'next') {
            setSkipped(consequent);
          } else {
            branches.push(consequent);
          }

          if (getIgnoreHint(alternate) === 'next') {
            setSkipped(alternate);
          } else {
            branches.push(alternate);
          }

          builder.addBranch('cond-expr', current, branches);
          return;
        }
        case 'LogicalExpression': {
          if (isSkipped(current)) {
            return;
          }

          const branches: AstNode[] = [];
          const visit = (child: AstNode) => {
            if (child.type === 'LogicalExpression') {
              setSkipped(child);

              if (getIgnoreHint(child) !== 'next') {
                visit(child.left as AstNode);
                visit(child.right as AstNode);
                return;
              }
            }
            branches.push(child);
          };

          visit(current);
          builder.addBranch('binary-expr', current, branches);
          return;
        }
        case 'AssignmentPattern': {
          builder.addBranch('default-arg', current, [current.right as AstNode]);
          return;
        }
      }
    },
    leave(node) {
      if (node === nextIgnore) {
        nextIgnore = false;
      }
    },
  });

  return builder.toPreparedCoverage();
}

function toBlockStatement(node: AstNode): AstNode {
  if (node.type === 'BlockStatement') {
    return node;
  }

  return {
    type: 'BlockStatement',
    body: [node],
    start: node.start,
    end: node.end,
  };
}

class CoverageBuilder {
  private files: Record<string, FileTemplate> = {};
  private functions: FunctionDescriptor[] = [];
  private statements: StatementDescriptor[] = [];
  private branches: BranchDescriptor[] = [];

  constructor(
    filename: string,
    sourceMap: TraceMap,
    private locator: Locator,
    private directory: string,
    sourceFilter?: (filePath: string) => boolean,
  ) {
    const generatedDirectory = dirname(filename);

    for (const source of sourceMap.resolvedSources) {
      let filePath = filename;

      if (source) {
        filePath = source.startsWith('file://')
          ? fileURLToPath(source)
          : resolve(generatedDirectory, source);
      }

      if (sourceFilter && !sourceFilter(filePath)) {
        continue;
      }

      this.files[filePath] = {
        path: filePath,
        statementMap: {},
        fnMap: {},
        branchMap: {},
        statementCount: 0,
        functionCount: 0,
        branchLengths: {},
        seen: {},
        fnNames: new Map(),
      };
    }
  }

  addFunction(
    node: AstNode,
    positions: {
      loc: Pick<AstNode, 'start' | 'end'>;
      decl: Pick<AstNode, 'start' | 'end'>;
    },
  ) {
    const loc = this.locator.getLoc(positions.loc);
    if (loc === null) return;

    const decl = this.locator.getLoc(positions.decl);
    if (decl === null) return;

    const filename = this.getSourceFilename(loc);
    const fileCoverage = this.files[filename];
    if (!fileCoverage) return;

    const key = `f:${cacheKey(decl)}`;
    let index = fileCoverage.seen[key];

    if (index == null) {
      index = fileCoverage.functionCount++;
      fileCoverage.seen[key] = index;

      let name = getFunctionName(node);
      if (name) {
        const base = name;
        let count = (fileCoverage.fnNames.get(base) || 0) + 1;
        name = count > 1 ? `${base}_${count}` : base;

        while (fileCoverage.fnNames.has(name)) {
          count++;
          name = `${base}_${count}`;
        }

        fileCoverage.fnNames.set(base, count);

        if (name !== base) {
          fileCoverage.fnNames.set(name, 0);
        }
      }

      fileCoverage.fnMap[index] = {
        name: name || `(anonymous_${index})`,
        decl: pickLocation(decl),
        loc: pickLocation(loc),
        line: loc.start.line,
      };
    }

    this.functions.push({
      filename,
      index,
      startOffset: node.start,
      endOffset: node.end,
    });
  }

  addStatement(node: AstNode, parent?: AstNode) {
    const loc = this.locator.getLoc(node);
    if (loc === null) return;

    const filename = this.getSourceFilename(loc);
    const fileCoverage = this.files[filename];
    if (!fileCoverage) return;

    const key = `s:${cacheKey(loc)}`;
    let index = fileCoverage.seen[key];

    if (index == null) {
      index = fileCoverage.statementCount++;
      fileCoverage.seen[key] = index;
      fileCoverage.statementMap[index] = pickLocation(loc);
    }

    const coverageNode = parent || node;
    this.statements.push({
      filename,
      index,
      startOffset: coverageNode.start,
      endOffset: coverageNode.end,
    });
  }

  addBranch(
    type: BranchType,
    node: AstNode,
    branches: (AstNode | null | undefined)[],
  ) {
    const loc = this.locator.getLoc(node);
    if (loc === null) return;

    const filename = this.getSourceFilename(loc);
    const fileCoverage = this.files[filename];
    if (!fileCoverage) return;

    const locations: PartialLocation[] = [];
    const ranges: BranchRangeDescriptor[] = [];

    for (const branch of branches) {
      if (!branch) {
        locations.push({
          start: { line: undefined, column: undefined },
          end: { line: undefined, column: undefined },
        });
        ranges.push({
          startOffset: node.start,
          endOffset: node.end,
          implicit: true,
        });
        continue;
      }

      const location = this.locator.getLoc(branch);
      if (location !== null) {
        locations.push(location);
      }

      const bias = branch.type === 'BlockStatement' ? 1 : 0;
      ranges.push({
        startOffset: branch.start + bias,
        endOffset: branch.end - bias,
      });
    }

    if (type === 'if' && locations.length > 0) {
      locations[0] = loc;
    }

    if (locations.length === 0) {
      return;
    }

    const key = ['b', ...locations.map(cacheKey)].join(':');
    let index = fileCoverage.seen[key];

    if (index == null) {
      index = Object.keys(fileCoverage.branchMap).length;
      fileCoverage.seen[key] = index;
      fileCoverage.branchMap[index] = {
        loc: pickLocation(loc),
        type,
        locations: locations.map((location) => pickLocation(location)),
        line: loc.start.line,
      };
      fileCoverage.branchLengths[index] = locations.length;
    }

    this.branches.push({ filename, index, ranges });
  }

  toPreparedCoverage(): PreparedCoverage {
    return {
      files: this.files,
      functions: this.functions,
      statements: this.statements,
      branches: this.branches,
    };
  }

  private getSourceFilename(position: MappedLocation) {
    const sourceFilename = position.start.filename || position.end.filename;

    if (!sourceFilename) {
      throw new Error(
        `Missing original filename for ${JSON.stringify(position)}`,
      );
    }

    if (sourceFilename.startsWith('file://')) {
      return fileURLToPath(sourceFilename);
    }

    return resolve(this.directory, sourceFilename);
  }
}

class Locator {
  private cache = new Map<number, Needle>();
  private ignoredLines = new Map<string, Set<number>>();
  private lineStarts: number[] = [0];

  constructor(
    private sourceMap: TraceMap,
    code: string,
  ) {
    for (let index = 0; index < code.length; index++) {
      if (code.charCodeAt(index) === 10) {
        this.lineStarts.push(index + 1);
      }
    }
  }

  offsetToNeedle(offset: number): Needle {
    const cached = this.cache.get(offset);
    if (cached) {
      return { ...cached };
    }

    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const lineStart = this.lineStarts[mid]!;

      if (lineStart <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const lineIndex = Math.max(0, high);
    const needle = {
      line: lineIndex + 1,
      column: offset - this.lineStarts[lineIndex]!,
    };
    this.cache.set(offset, needle);
    return { ...needle };
  }

  getLoc(node: Pick<AstNode, 'start' | 'end'>): MappedLocation | null {
    const startNeedle = this.offsetToNeedle(node.start);
    const start = getPosition(startNeedle, this.sourceMap);

    if (start === null) {
      return null;
    }

    const endNeedle = this.offsetToNeedle(node.end);
    endNeedle.column -= 1;

    let end = getPosition(endNeedle, this.sourceMap);

    if (end === null) {
      for (
        let line = endNeedle.line;
        line >= startNeedle.line && end === null;
        line--
      ) {
        end = getPosition({ line, column: Infinity }, this.sourceMap);
      }

      if (end === null) return null;
    }

    const loc = { start, end };

    if (!loc.end.filename) {
      return null;
    }

    const afterEndMappings = allGeneratedPositionsFor(this.sourceMap, {
      source: loc.end.filename,
      line: loc.end.line,
      column: loc.end.column + 1,
      bias: LEAST_UPPER_BOUND,
    });

    if (afterEndMappings.length === 0) {
      loc.end.column = Infinity;
    } else {
      for (const mapping of afterEndMappings) {
        if (mapping.line === null) continue;

        const original = originalPositionFor(this.sourceMap, mapping);
        if (original.line === loc.end.line) {
          loc.end = { ...original, filename: original.source };
          break;
        }
      }
    }

    const filename = loc.start.filename;
    if (!filename) {
      return null;
    }

    let ignoredLines = this.ignoredLines.get(filename);

    if (!ignoredLines) {
      const sources = sourceContentFor(this.sourceMap, filename);
      ignoredLines = getIgnoredLines(sources ?? tryReadFileSync(filename));
      this.ignoredLines.set(filename, ignoredLines);
    }

    if (ignoredLines.has(loc.start.line)) {
      return null;
    }

    return loc;
  }
}

function applyCoverage(
  prepared: PreparedCoverage,
  ranges: NormalizedRange[],
): Record<string, FileCoverageData> {
  const data: Record<string, FileCoverageData> = {};

  for (const [filename, template] of Object.entries(prepared.files)) {
    const fileCoverage: FileCoverageData = {
      path: template.path,
      statementMap: template.statementMap,
      fnMap: template.fnMap,
      branchMap: template.branchMap,
      s: {},
      f: {},
      b: {},
    };

    for (let index = 0; index < template.statementCount; index++) {
      fileCoverage.s[index] = 0;
    }
    for (let index = 0; index < template.functionCount; index++) {
      fileCoverage.f[index] = 0;
    }
    for (const [index, length] of Object.entries(template.branchLengths)) {
      fileCoverage.b[index] = Array(length).fill(0);
    }

    data[filename] = fileCoverage;
  }

  for (const descriptor of prepared.functions) {
    data[descriptor.filename]!.f[descriptor.index]! += getCount(
      descriptor,
      ranges,
    );
  }

  for (const descriptor of prepared.statements) {
    data[descriptor.filename]!.s[descriptor.index] = getCount(
      descriptor,
      ranges,
    );
  }

  for (const descriptor of prepared.branches) {
    const hits = data[descriptor.filename]!.b[descriptor.index]!;
    const covered: number[] = [];

    for (const range of descriptor.ranges) {
      const count = getCount(range, ranges);
      const hit = range.implicit ? count - (covered.at(-1) || 0) : count;
      covered.push(hit);
    }

    for (let index = 0; index < hits.length; index++) {
      hits[index] = hits[index]! + (covered[index] || 0);
    }
  }

  return data;
}

function normalize(scriptCoverage: Pick<Profiler.ScriptCoverage, 'functions'>) {
  const rawRanges = getSortedRawCoverageRanges(scriptCoverage);

  if (rawRanges.length === 0) {
    return [];
  }

  let maxEnd = 0;
  for (const range of rawRanges) {
    if (range.end > maxEnd) {
      maxEnd = range.end;
    }
  }

  if (maxEnd <= 2_000_000) {
    return normalizeWithCoverageArray(rawRanges, maxEnd);
  }

  return normalizeWithCoverageEvents(rawRanges);
}

function getSortedRawCoverageRanges(
  scriptCoverage: Pick<Profiler.ScriptCoverage, 'functions'>,
) {
  const ranges: RawCoverageRange[] = [];
  let order = 0;

  for (const fn of scriptCoverage.functions) {
    for (const range of fn.ranges) {
      ranges.push({
        start: range.startOffset,
        end: range.endOffset,
        count: range.count,
        area: range.endOffset - range.startOffset,
        order: order++,
      });
    }
  }

  return ranges.sort((a, b) => {
    const diff = b.area - a.area;
    if (diff !== 0) return diff;
    return a.end - b.end;
  });
}

function normalizeWithCoverageArray(
  ranges: RawCoverageRange[],
  maxEnd: number,
) {
  const hits = new Uint32Array(maxEnd + 1);

  for (const range of ranges) {
    hits.fill(range.count, range.start, range.end + 1);
  }

  const normalized: NormalizedRange[] = [];
  let start = 0;

  for (let end = 1; end <= hits.length; end++) {
    const isLast = end === hits.length;
    const current = isLast ? null : hits[end];
    const previous = hits[start];

    if (current !== previous || isLast) {
      normalized.push({
        start,
        end: end - 1,
        count: previous ?? 0,
      });
      start = end;
    }
  }

  return normalized;
}

function normalizeWithCoverageEvents(ranges: RawCoverageRange[]) {
  const events: {
    offset: number;
    range: RawCoverageRange;
    type: 'add' | 'remove';
  }[] = [];

  for (const range of ranges) {
    events.push({ offset: range.start, range, type: 'add' });
    events.push({ offset: range.end + 1, range, type: 'remove' });
  }

  events.sort((a, b) => a.offset - b.offset);

  const active: RawCoverageRange[] = [];
  const normalized: NormalizedRange[] = [];
  let cursor = events[0]!.offset;
  let index = 0;

  while (index < events.length) {
    const offset = events[index]!.offset;

    if (active.length > 0 && cursor < offset) {
      const winner = getMostSpecificRange(active);
      const previous = normalized.at(-1);

      if (
        previous &&
        previous.end + 1 === cursor &&
        previous.count === winner.count
      ) {
        previous.end = offset - 1;
      } else {
        normalized.push({
          start: cursor,
          end: offset - 1,
          count: winner.count,
        });
      }
    }

    while (index < events.length && events[index]!.offset === offset) {
      const event = events[index]!;
      if (event.type === 'add') {
        active.push(event.range);
      } else {
        const activeIndex = active.indexOf(event.range);
        if (activeIndex !== -1) {
          active.splice(activeIndex, 1);
        }
      }
      index++;
    }

    cursor = offset;
  }

  return normalized;
}

function getMostSpecificRange(ranges: RawCoverageRange[]) {
  let winner = ranges[0]!;

  for (let index = 1; index < ranges.length; index++) {
    const range = ranges[index]!;
    if (
      range.area < winner.area ||
      (range.area === winner.area && range.end > winner.end) ||
      (range.area === winner.area &&
        range.end === winner.end &&
        range.order > winner.order)
    ) {
      winner = range;
    }
  }

  return winner;
}

function getCount(
  offset: { startOffset: number; endOffset: number },
  coverages: NormalizedRange[],
) {
  let count = 0;
  let low = 0;
  let high = coverages.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const coverage = coverages[mid]!;

    if (
      coverage.start <= offset.startOffset &&
      offset.startOffset <= coverage.end
    ) {
      count = coverage.count;
      low = mid + 1;
      continue;
    }

    if (offset.startOffset < coverage.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return count;
}

function getPosition(needle: Needle, sourceMap: TraceMap): Position | null {
  let position = originalPositionFor(sourceMap, needle);

  if (position.source == null) {
    position = originalPositionFor(sourceMap, {
      column: needle.column,
      line: needle.line,
      bias: LEAST_UPPER_BOUND,
    });
  }

  if (position.source == null) {
    return null;
  }

  return {
    line: position.line,
    column: position.column,
    filename: position.source,
  };
}

function createEmptySourceMap(
  filename: string,
  code: string,
): DecodedSourceMap {
  const mappings: SourceMapSegment[][] = [];

  for (const [line, content] of code.split('\n').entries()) {
    const parts = content.match(WORD_PATTERN) || [];
    const segments: SourceMapSegment[] = [];
    let column = 0;

    for (const part of parts) {
      segments.push([column, 0, line, column]);
      column += part.length;
    }

    mappings.push(segments);
  }

  return {
    version: 3,
    mappings,
    file: filename,
    sources: [filename],
    sourcesContent: [code],
    names: [],
  };
}

async function getInlineSourceMap(filename: string, code: string) {
  const matches = code.match(INLINE_MAP_PATTERN);
  const match = matches?.[1];

  if (!match) return null;

  try {
    if (BASE_64_SOURCE_MAP_PATTERN.test(match)) {
      const encoded = match.replace(BASE_64_SOURCE_MAP_PATTERN, '');
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      return JSON.parse(decoded) as SourceMapLike;
    }

    const directory = dirname(filename);
    const content = await fs.readFile(resolve(directory, match), 'utf-8');
    return JSON.parse(content) as SourceMapLike;
  } catch {
    return null;
  }
}

function getIgnoreHints(code: string): IgnoreHint[] {
  const ignoreHints: IgnoreHint[] = [];
  const tokens = jsTokens(code);
  let current = 0;
  let previousTokenWasIgnoreHint = false;

  for (const token of tokens) {
    if (
      previousTokenWasIgnoreHint &&
      token.type !== 'WhiteSpace' &&
      token.type !== 'LineTerminatorSequence'
    ) {
      const previous = ignoreHints.at(-1);
      if (previous) {
        previous.loc.end = current;
      }
      previousTokenWasIgnoreHint = false;
    }

    if (
      token.type === 'SingleLineComment' ||
      token.type === 'MultiLineComment'
    ) {
      const loc = { start: current, end: current + token.value.length };
      const comment = token.value
        .replace(/^\/\*\*/, '')
        .replace(/^\/\*/, '')
        .replace(/\*\*\/$/, '')
        .replace(/\*\/$/, '')
        .replace(/^\/\//, '');
      const groups = comment.match(IGNORE_PATTERN);
      const type = groups?.[1];

      if (type === 'file') {
        return [{ type, loc: { start: 0, end: 0 } }];
      }

      if (type === 'if' || type === 'else' || type === 'next') {
        ignoreHints.push({ type, loc });
        previousTokenWasIgnoreHint = true;
      }
    }

    current += token.value.length;
  }

  return ignoreHints;
}

function getIgnoredLines(text?: string): Set<number> {
  if (!text) {
    return new Set();
  }

  const ranges: { start: number; stop: number }[] = [];
  let lineNumber = 0;

  for (const line of text.split(EOL_PATTERN)) {
    lineNumber++;
    const match = line.match(IGNORE_LINES_PATTERN);

    if (!match) {
      continue;
    }

    const type = match[1];

    if (type === 'stop') {
      const previous = ranges.at(-1);

      if (previous && previous.stop === Infinity) {
        previous.stop = lineNumber;
      }

      continue;
    }

    ranges.push({ start: lineNumber, stop: Infinity });
  }

  const ignoredLines = new Set<number>();

  for (const range of ranges) {
    const stop = Math.min(range.stop, lineNumber);
    for (let line = range.start; line <= stop; line++) {
      ignoredLines.add(line);
    }
  }

  return ignoredLines;
}

function tryReadFileSync(filename: string) {
  try {
    return readFileSync(filename, 'utf8');
  } catch {
    return undefined;
  }
}

function getFunctionName(node: AstNode): string | undefined {
  if (node.type === 'Identifier') {
    return node.name as string;
  }

  if (node.id) {
    return getFunctionName(node.id as AstNode);
  }

  if (node.key) {
    return getFunctionName(node.key as AstNode);
  }

  return undefined;
}

function pickLocation(loc: PartialLocation): IstanbulLocation {
  return {
    start: { line: loc.start.line!, column: loc.start.column! },
    end: { line: loc.end.line!, column: loc.end.column! },
  };
}

function cacheKey(loc: PartialLocation) {
  return `${loc.start.line}:${loc.start.column}:${loc.end.line}:${loc.end.column}`;
}
