import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Check failed: ' + cmd + ' ' + args.join(' '));
}
for (const name of readdirSync('mobile').filter(x => x.endsWith('.js'))) run(process.execPath, ['--check', 'mobile/' + name]);
run(process.execPath, ['--test', 'tests/input.test.mjs']);
run(process.execPath, ['--test', 'tests/shader-bindings.test.mjs']);
run(process.execPath, ['--test', 'tests/mip-limit.test.mjs']);
run(process.execPath, ['--test', 'tests/pipeline-compilation.test.mjs']);
run(process.execPath, ['test/game-logic.mjs'], resolve('upstream'));
