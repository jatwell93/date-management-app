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

function fail(message) {
  throw new RouteMapError(message);
}

function parse(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Top-level `const NAME = <init>` declarations, by name. */
function topLevelConsts(sf) {
  const decls = sf.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => s.declarationList.declarations)
    .filter((d) => ts.isIdentifier(d.name));
  return new Map(decls.map((d) => [d.name.text, d]));
}

const declaresFunction = (name) => (s) => ts.isFunctionDeclaration(s) && s.name?.text === name;

/** Line of the function or const that declares `name` in `sf`, or 0. */
function declarationLine(sf, name) {
  const node = sf.statements.find(declaresFunction(name)) || topLevelConsts(sf).get(name);
  return node ? lineOf(sf, node) : 0;
}

/** [localName, { module, imported }] for each named import of one statement. */
function importEntries(stmt) {
  const bindings = stmt.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  const module = stmt.moduleSpecifier.text;
  return bindings.elements.map((el) => [
    el.name.text,
    { module, imported: (el.propertyName || el.name).text },
  ]);
}

function namedImports(sf) {
  return new Map(sf.statements.filter(ts.isImportDeclaration).flatMap(importEntries));
}

function resolveModule(root, fromFile, spec) {
  const base = path.posix.join(path.posix.dirname(fromFile), spec);
  const file = EXTENSIONS.map((ext) => base + ext).find((f) => fs.existsSync(path.join(root, f)));
  return file || fail(`cannot resolve import ${spec}`);
}

function lineIn(sf, file, name, label) {
  const line = declarationLine(sf, name);
  return line ? `${file}:${line}` : fail(`cannot locate ${label} in ${file}`);
}

function importedHandler(ctx, name, imp) {
  const file = resolveModule(ctx.root, ROUTES_FILE, imp.module);
  if (TEST_FILE.test(file)) fail(`${name} resolves to a test file`);
  return lineIn(parse(ctx.root, file), file, imp.imported, name);
}

/** file:line of the handler, through the routes file's own imports. */
function locateHandler(ctx, name) {
  const imp = ctx.imports.get(name);
  return imp ? importedHandler(ctx, name, imp) : lineIn(ctx.sf, ROUTES_FILE, name, name);
}

/** A regex literal's source, without its slashes and flags. */
const regexSource = (node) => node.text.slice(1, node.text.lastIndexOf('/'));

function constRegex(ctx, node) {
  const init = ts.isIdentifier(node) ? ctx.consts.get(node.text)?.initializer : undefined;
  return init && ts.isRegularExpressionLiteral(init) ? regexSource(init) : null;
}

function routeOf(ctx, node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return regexSource(node);
  return constRegex(ctx, node) ?? fail(`unrecognised path ${node.getText(ctx.sf)}`);
}

function fieldsOf(entry) {
  const ok = ts.isArrayLiteralExpression(entry) && [3, 4].includes(entry.elements.length);
  return ok ? entry.elements : fail('expected an array of 3 or 4 fields');
}

function methodOf(ctx, node) {
  const ok = ts.isStringLiteral(node) && /^[A-Z]+$/.test(node.text);
  return ok ? node.text : fail(`unrecognised method ${node.getText(ctx.sf)}`);
}

function handlerOf(ctx, node) {
  return ts.isIdentifier(node) ? node.text : fail(`unrecognised handler ${node.getText(ctx.sf)}`);
}

function entryLine(ctx, entry) {
  const [method, route, handler] = fieldsOf(entry);
  const name = handlerOf(ctx, handler);
  return [methodOf(ctx, method), routeOf(ctx, route), name, locateHandler(ctx, name)].join('\t');
}

function routeTable(ctx) {
  const init = ctx.consts.get(TABLE)?.initializer;
  const ok = init && ts.isArrayLiteralExpression(init);
  return ok ? init.elements : fail(`${TABLE} not found in ${ROUTES_FILE}`);
}

/** One entry to { line } or { problem }; only RouteMapError becomes a problem. */
function mapEntry(ctx, entry) {
  try {
    return { line: entryLine(ctx, entry) };
  } catch (err) {
    if (!(err instanceof RouteMapError)) throw err;
    const text = entry.getText(ctx.sf).replace(/\s+/g, ' ');
    return { problem: `${ROUTES_FILE}:${lineOf(ctx.sf, entry)}: ${err.message}: ${text}` };
  }
}

function buildRouteMap(root) {
  const sf = parse(root, ROUTES_FILE);
  const ctx = { root, sf, consts: topLevelConsts(sf), imports: namedImports(sf) };
  const results = routeTable(ctx).map((entry) => mapEntry(ctx, entry));
  return {
    lines: results.filter((r) => r.line).map((r) => r.line),
    problems: results.filter((r) => r.problem).map((r) => r.problem),
  };
}

function rootFrom(argv, cwd) {
  const i = argv.indexOf('--root');
  if (i === -1) return cwd;
  return argv[i + 1] ? path.resolve(argv[i + 1]) : null;
}

/** buildRouteMap, with a missing file or table reported as one problem. */
function tryBuild(root) {
  try {
    return buildRouteMap(root);
  } catch (err) {
    if (!(err instanceof RouteMapError) && err.code !== 'ENOENT') throw err;
    return { lines: [], problems: [err.message] };
  }
}

function main(argv, io = { log: console.log, error: console.error }, cwd = process.cwd()) {
  const root = rootFrom(argv, cwd);
  if (!root) {
    io.error(USAGE);
    return 2;
  }
  const { lines, problems } = tryBuild(root);
  problems.forEach((p) => io.error(`route-map: ${p}`));
  if (problems.length) return 1;
  lines.forEach((l) => io.log(l));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildRouteMap, main };
