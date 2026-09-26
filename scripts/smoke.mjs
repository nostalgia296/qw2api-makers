import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const functionsDir = join(root, 'edge-functions');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

const files = await walk(functionsDir);
let failed = 0;

for (const file of files) {
  const rel = relative(root, file);
  try {
    const mod = await import(pathToFileURL(file).href);
    const handlers = ['onRequest', 'onRequestGet', 'onRequestPost', 'onRequestPut', 'onRequestDelete', 'onRequestOptions'].filter(
      (name) => typeof mod[name] === 'function'
    );
    const isShared = rel.includes('_shared');
    if (!isShared && handlers.length === 0) {
      failed++;
      console.log(`FAIL  ${rel} exports no request handler`);
    } else {
      console.log(`PASS  ${rel}${handlers.length ? ` [${handlers.join(', ')}]` : ''}`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL  ${rel}: ${err.message}`);
  }
}

const html = await readFile(join(root, 'public', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  failed++;
  console.log('FAIL  public/index.html has no inline script');
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'qw2api-'));
  const file = join(tmp, 'ui.mjs');
  writeFileSync(file, match[1]);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('PASS  public/index.html inline script parses');
  } catch (err) {
    failed++;
    console.log(`FAIL  public/index.html inline script: ${String(err.stderr || err.message).split('\n').slice(0, 3).join(' ')}`);
  }
}

console.log(failed === 0 ? '\nall modules load' : `\n${failed} module check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
