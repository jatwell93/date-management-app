#!/usr/bin/env node
/**
 * Print the Worker's API route map: one line per MINIMAL_API_ROUTES entry,
 *   METHOD<TAB>path-or-pattern<TAB>handler<TAB>file:line
 * where file:line is the handler's definition under workers/src/.
 *
 * Usage: node scripts/route-map.js [--root <repo root>]
 *
 * Read-only. It parses the source with the TypeScript compiler API (a root
 * devDependency), so strings, regex literals, comments and entries split over
 * several lines need no hand-written tokenizer. An entry it cannot read or a
 * handler it cannot locate makes it exit 1 and name the entry; it never skips
 * one. Handlers are resolved through index-minimal.ts's own imports, and a
 * test file is never reported.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROUTES_FILE = 'workers/src/index-minimal.ts';
const TABLE = 'MINIMAL_API_ROUTES';
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(__tests__|test)\//;
const EXTENSIONS = ['.ts', '.tsx', '.js', '/index.ts'];
const USAGE = 'usage: node scripts/route-map.js [--root <repo root>]';

class RouteMapError extends Error {}

function parse(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Top-level `const NAME = <init>` declarations, by name. */
function topLevelConsts(sf) {
  const out = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) out.set(d.name.text, d);
    }
  }
  return out;
}

/** Line of the function or const that declares `name` in `sf`, or 0. */
function declarationLine(sf, name) {
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (fn) return lineOf(sf, fn);
  const d = topLevelConsts(sf).get(name);
  return d ? lineOf(sf, d) : 0;
}

/** Named imports: local name to { module, imported }. */
function namedImports(sf) {
  const out = new Map();
  for (const stmt of sf.statements) {
    const bindings = ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      out.set(el.name.text, {
        module: stmt.moduleSpecifier.text,
        imported: (el.propertyName || el.name).text,
      });
    }
  }
  return out;
}

function resolveModule(root, fromFile, spec) {
  const base = path.posix.join(path.posix.dirname(fromFile), spec);
  const file = EXTENSIONS.map((ext) => base + ext).find((f) => fs.existsSync(path.join(root, f)));
  if (!file) throw new RouteMapError(`cannot resolve import ${spec}`);
  return file;
}

/** file:line of the handler, through the routes file's own imports. */
function locateHandler(ctx, name) {
  const imp = ctx.imports.get(name);
  if (!imp) {
    const line = declarationLine(ctx.sf, name);
    if (!line) throw new RouteMapError(`cannot locate ${name} in ${ROUTES_FILE}`);
    return `${ROUTES_FILE}:${line}`;
  }
  const file = resolveModule(ctx.root, ROUTES_FILE, imp.module);
  if (TEST_FILE.test(file)) throw new RouteMapError(`${name} resolves to a test file`);
  const line = declarationLine(parse(ctx.root, file), imp.imported);
  if (!line) throw new RouteMapError(`cannot locate ${name} in ${file}`);
  return `${file}:${line}`;
}

/** A regex literal's source, without its slashes and flags. */
const regexSource = (node) => node.text.slice(1, node.text.lastIndexOf('/'));

function routeOf(ctx, node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return regexSource(node);
  const init = ts.isIdentifier(node) && ctx.consts.get(node.text)?.initializer;
  if (init && ts.isRegularExpressionLiteral(init)) return regexSource(init);
  throw new RouteMapError(`unrecognised path ${node.getText(ctx.sf)}`);
}

function entryLine(ctx, entry) {
  if (!ts.isArrayLiteralExpression(entry) || ![3, 4].includes(entry.elements.length)) {
    throw new RouteMapError('expected an array of 3 or 4 fields');
  }
  const [method, route, handler] = entry.elements;
  if (!ts.isStringLiteral(method) || !/^[A-Z]+$/.test(method.text)) {
    throw new RouteMapError(`unrecognised method ${method.getText(ctx.sf)}`);
  }
  if (!ts.isIdentifier(handler)) {
    throw new RouteMapError(`unrecognised handler ${handler.getText(ctx.sf)}`);
  }
  const at = locateHandler(ctx, handler.text);
  return [method.text, routeOf(ctx, route), handler.text, at].join('\t');
}

function routeTable(ctx) {
  const init = ctx.consts.get(TABLE)?.initializer;
  if (!init || !ts.isArrayLiteralExpression(init)) {
    throw new RouteMapError(`${TABLE} not found in ${ROUTES_FILE}`);
  }
  return init.elements;
}

function buildRouteMap(root) {
  const sf = parse(root, ROUTES_FILE);
  const ctx = { root, sf, consts: topLevelConsts(sf), imports: namedImports(sf) };
  const lines = [];
  const problems = [];
  for (const entry of routeTable(ctx)) {
    try {
      lines.push(entryLine(ctx, entry));
    } catch (err) {
      if (!(err instanceof RouteMapError)) throw err;
      const text = entry.getText(sf).replace(/\s+/g, ' ');
      problems.push(`${ROUTES_FILE}:${lineOf(sf, entry)}: ${err.message}: ${text}`);
    }
  }
  return { lines, problems };
}

function rootFrom(argv, cwd) {
  const i = argv.indexOf('--root');
  if (i === -1) return cwd;
  return argv[i + 1] ? path.resolve(argv[i + 1]) : null;
}

function main(argv, io = { log: console.log, error: console.error }, cwd = process.cwd()) {
  const root = rootFrom(argv, cwd);
  if (!root) {
    io.error(USAGE);
    return 2;
  }
  let result;
  try {
    result = buildRouteMap(root);
  } catch (err) {
    if (!(err instanceof RouteMapError) && err.code !== 'ENOENT') throw err;
    io.error(`route-map: ${err.message}`);
    return 1;
  }
  for (const p of result.problems) io.error(`route-map: ${p}`);
  if (result.problems.length) return 1;
  for (const l of result.lines) io.log(l);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildRouteMap, main };
