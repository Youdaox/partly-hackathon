#!/usr/bin/env node
// Runs an executable from backend/.venv, resolving the platform-specific
// layout (Scripts/*.exe on Windows, bin/* elsewhere) so package.json scripts
// don't have to hardcode one or the other.
//
// Usage: node scripts/venv-run.mjs [--cwd <dir>] <venv-executable> [args...]

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);

let cwd = '.';
if (args[0] === '--cwd') {
  cwd = args[1];
  args.splice(0, 2);
}

const [exe, ...rest] = args;
if (!exe) {
  console.error('Usage: node scripts/venv-run.mjs [--cwd <dir>] <venv-executable> [args...]');
  process.exit(1);
}

const venvDir = path.join('backend', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const binPath = path.resolve(venvDir, process.platform === 'win32' ? `${exe}.exe` : exe);

const result = spawnSync(binPath, rest, { stdio: 'inherit', cwd });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
