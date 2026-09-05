// Dead-code scan: list source files whose basename is never imported by any
// other source file. Heuristic but effective for this repo layout.
// Entry points (framework-instantiated or config) are classified separately.
const fs = require('fs');
const path = require('path');

const ROOTS = ['api-server/src', 'app', 'lib', 'hooks', 'components'];
const EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'baselines', 'exccalidraw_gif', '.git', 'scripts']);

// Framework entry points / generated / type-only files that are never "imported".
const ENTRY_PATTERNS = [/^app\/(api|[\w-]+)\/.*(page|route|layout|loading|error|not-found)\.tsx?$/, /^app\/.+\/\[/, /middleware\.ts$/, /\.d\.ts$/, /next-env/, /tailwind\.config/, /postcss\.config/, /instrumentation/];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

const root = path.resolve(__dirname, '..', '..'); // repo root (script lives in api-server/scripts)
const files = [];
for (const r of ROOTS) {
  const d = path.join(root, r);
  if (fs.existsSync(d)) files.push(...walk(d));
}

// Build the import corpus: every import/require/export-from specifier.
const corpus = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) corpus.push({ from: f, spec: m[1] });
}

function importedBase(file) {
  const base = path.basename(file).replace(/\.tsx?$/, '').replace(/\.d$/, '');
  return corpus.some((c) => c.spec.includes(base));
}

const dead = [];
const entries = [];
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (ENTRY_PATTERNS.some((re) => re.test(rel))) { entries.push(rel); continue; }
  if (!importedBase(f)) dead.push(rel);
}

console.log('=== FILES WITH NO INBOUND IMPORT (dead-code candidates) ===');
dead.forEach((d) => console.log('  ' + d));
console.log(`\n${dead.length} candidates of ${files.length} source files (${entries.length} framework entries skipped)`);
