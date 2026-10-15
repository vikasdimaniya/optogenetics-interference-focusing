#!/usr/bin/env node
/**
 * Test runner.  node test/run.js [filter]
 *
 * No dependencies, no config. Every file in test/ matching test-*.js runs.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { report } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const files = readdirSync(here)
  .filter((f) => /^test-.*\.js$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`no test files matched ${filter ?? '*'}`);
  process.exit(1);
}

console.log(`\nRunning ${files.length} test file(s)`);
for (const f of files) {
  await import(join(here, f));
}

const ok = report();
process.exit(ok ? 0 : 1);
