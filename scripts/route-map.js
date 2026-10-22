#!/usr/bin/env node
/**
 * Print the Worker's API route map: one line per MINIMAL_API_ROUTES entry,
 *   METHOD<TAB>path-or-pattern<TAB>handler<TAB>file:line
 * where file:line is the handler's definition under workers/src/.
 *
 * Usage: node scripts/route-map.js [--root <repo root>]
 *
 * Read-only. An entry it cannot parse or a handler it cannot locate makes it
 * exit 1 and name the entry; it never skips one. Test files are never searched.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROUTES_FILE = 'workers/src/index-minimal.ts';
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(__tests__|test)\//;

class RouteMapError extends Error {}

/**
 * Split the body of the table array into top-level entries. Strings, regex
 * literals and comments are skipped so their brackets and commas do not count.
 * Returns [{ text, line }] where text is the entry without its outer brackets.
 */
function splitEntries(src, start) {
  const entries = [];
  let depth = 0;
  let entryStart = -1;
  let prev = '[';
  let i = start;
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      if (i < 2) throw new RouteMapError('unterminated comment in route table');
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      prev = 'x';
      continue;
    }
    if (c === '/' && (prev === ',' || prev === '[')) {
      i++;
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(src[i] || '')) i++;
      prev = 'x';
      continue;
    }
    if (c === '[') {
      if (depth === 1) entryStart = i;
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 1 && entryStart >= 0) {
        entries.push({ text: src.slice(entryStart + 1, i), line: lineAt(entryStart) });
        entryStart = -1;
      }
      if (depth === 0) return entries;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  throw new RouteMapError('route table is not closed');
}

/** Split an entry on top-level commas, skipping strings and regex literals. */
function splitFields(text) {
  const fields = [];
  let from = 0;
  let prev = ',';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
      i++;
      prev = 'x';
      continue;
    }
    if (c === '/' && prev === ',') {
      i++;
      let inClass = false;
      while (i < text.length && (inClass || text[i] !== '/')) {
        if (text[i] === '\\') i++;
        else if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(text[i] || '')) i++;
      prev = 'x';
      continue;
    }
    if (c === ',') {
      fields.push(text.slice(from, i).trim());
      from = i + 1;
      prev = ',';
    } else if (!/\s/.test(c)) prev = c;
    i++;
  }
  const last = text.slice(from).trim();
  if (last) fields.push(last);
  return fields;
}

function regexSource(literal) {
  const m = /^\/(.*)\/[a-z]*$/s.exec(literal);
  return m ? m[1] : null;
}

/** Map imported local name -> module specifier (relative imports only). */
function parseImports(src) {
  const map = new Map();
  const re = /import\s+(?!type\b)\{([^}]*)\}\s*from\s*'(\.[^']*)'/g;
  let m;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(',')) {
      const spec = part.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const [imported, local] = spec.split(/\s+as\s+/);
      map.set((local || imported).trim(), { name: imported.trim(), from: m[2] });
    }
  }
  return map;
}

function findDeclaration(src, name) {
  const re = new RegExp(
    `^(?:export\\s+)?(?:async\\s+function\\s*\\*?\\s*|function\\s*\\*?\\s*|const\\s+)${name}\\b`,
    'm',
  );
  const m = re.exec(src);
  return m ? src.slice(0, m.index).split('\n').length : null;
}

function resolveModule(root, fromFile, specifier) {
  const base = path.resolve(root, path.dirname(fromFile), specifier);
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return path.relative(root, cand).split(path.sep).join('/');
    }
  }
  return null;
}

function locateHandler(root, name, src, imports) {
  const imp = imports.get(name);
  let file = ROUTES_FILE;
  let target = name;
  if (imp) {
    file = resolveModule(root, ROUTES_FILE, imp.from);
    target = imp.name;
    if (!file) throw new RouteMapError(`cannot resolve import '${imp.from}' for ${name}`);
  }
  if (TEST_FILE.test(file)) throw new RouteMapError(`${name} resolves to test file ${file}`);
  const text = imp ? fs.readFileSync(path.join(root, file), 'utf8') : src;
  const line = findDeclaration(text, target);
  if (!line) throw new RouteMapError(`cannot locate ${target} in ${file}`);
  return `${file}:${line}`;
}

function buildRouteMap(root) {
  const src = fs.readFileSync(path.join(root, ROUTES_FILE), 'utf8');
  const decl = /export\s+const\s+MINIMAL_API_ROUTES\b[^=]*=\s*\[/.exec(src);
  if (!decl) throw new RouteMapError(`MINIMAL_API_ROUTES not found in ${ROUTES_FILE}`);
  const imports = parseImports(src);
  const lines = [];
  const problems = [];
  for (const entry of splitEntries(src, decl.index + decl[0].length - 1)) {
    try {
      const fields = splitFields(entry.text);
      if (fields.length < 3 || fields.length > 4) throw new RouteMapError('expected 3 or 4 fields');
      const [methodRaw, pathRaw, handler] = fields;
      const method = /^'([A-Z]+)'$/.exec(methodRaw);
      if (!method) throw new RouteMapError(`unrecognised method ${methodRaw}`);
      if (!/^[A-Za-z_$][\w$]*$/.test(handler))
        throw new RouteMapError(`unrecognised handler ${handler}`);
      let route;
      const str = /^'([^']*)'$/.exec(pathRaw);
      if (str) route = str[1];
      else if (/^RE_[A-Z0-9_]+$/.test(pathRaw)) {
        const def = new RegExp(`^const\\s+${pathRaw}\\s*=\\s*(/.*/[a-z]*);`, 'm').exec(src);
        route = def && regexSource(def[1]);
        if (route === null || route === undefined)
          throw new RouteMapError(`cannot find ${pathRaw}`);
      } else {
        route = regexSource(pathRaw);
        if (route === null) throw new RouteMapError(`unrecognised path ${pathRaw}`);
      }
      lines.push(
        [method[1], route, handler, locateHandler(root, handler, src, imports)].join('\t'),
      );
    } catch (err) {
      if (!(err instanceof RouteMapError)) throw err;
      problems.push(
        `${ROUTES_FILE}:${entry.line}: ${err.message}: [${entry.text.replace(/\s+/g, ' ').trim()}]`,
      );
    }
  }
  return { lines, problems };
}

function main(argv, io = { log: console.log, error: console.error }, cwd = process.cwd()) {
  let root = cwd;
  const i = argv.indexOf('--root');
  if (i >= 0) {
    if (!argv[i + 1]) {
      io.error('usage: node scripts/route-map.js [--root <repo root>]');
      return 2;
    }
    root = path.resolve(argv[i + 1]);
  }
  let result;
  try {
    result = buildRouteMap(root);
  } catch (err) {
    if (!(err instanceof RouteMapError) && err.code !== 'ENOENT') throw err;
    io.error(`route-map: ${err.message}`);
    return 1;
  }
  if (result.problems.length) {
    for (const p of result.problems) io.error(`route-map: ${p}`);
    return 1;
  }
  for (const l of result.lines) io.log(l);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildRouteMap, splitEntries, splitFields, main };
