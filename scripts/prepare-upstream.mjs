import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const upstream = JSON.parse(readFileSync('upstream.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(upstream.commit)) throw new Error('An exact upstream commit is required.');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(command + ' failed with exit ' + result.status);
}
if (!existsSync('upstream/.git')) run('git', ['clone', '--depth', '1', upstream.repository, 'upstream']);
run('git', ['fetch', '--depth', '1', 'origin', upstream.commit], resolve('upstream'));
run('git', ['checkout', '--detach', upstream.commit], resolve('upstream'));
mkdirSync('upstream/src/mobile', { recursive: true });
for (const name of readdirSync('mobile')) {
  if (name !== 'Input.js' && name !== 'entry.js') cpSync('mobile/' + name, 'upstream/src/mobile/' + name);
}
cpSync('mobile/Input.js', 'upstream/src/core/Input.js');
cpSync('mobile/entry.js', 'upstream/src/mobile-entry.js');
function patch(path, before, after) {
  const original = readFileSync(path, 'utf8');
  if (original.split(before).length !== 2) throw new Error('Unexpected upstream layout in ' + path);
  writeFileSync(path, original.replace(before, after));
}
const main = 'upstream/src/main.js';
patch(main, 'window.__ui = ui;', 'window.__ui = ui;\nwindow.__tideApp = app;');
patch(main, 'app.init( ( p, text, until ) => ui.setLoading( p, text, until ) )',
  "app.init( ( p, text, until ) => { ui.setLoading( p, text, until ); window.dispatchEvent( new CustomEvent( 'tidewater:progress', { detail: { p, text } } ) ); } )");
patch(main, 'ui.showStartOverlay( () => {', "window.__tideReady = true;\n\tui.showStartOverlay( () => {");
patch(main, "ui.setLoadingError( 'Something went wrong: ' + e.message );",
  "ui.setLoadingError( 'Something went wrong: ' + e.message );\n\twindow.dispatchEvent( new CustomEvent( 'tidewater:error', { detail: e.message } ) );");
patch('upstream/src/engine/gpu/GPU.js',
  "device.lost.then( ( info ) => console.error( 'WebGPU device lost:', info.message ) );",
  "device.lost.then( ( info ) => { console.error( 'WebGPU device lost:', info.message ); if ( typeof window !== 'undefined' ) window.dispatchEvent( new CustomEvent( 'tidewater:gpu-lost', { detail: info.message } ) ); } );");
let html = readFileSync('upstream/index.html', 'utf8');
html = html.replace(/^\s*<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*$/gm, '');
html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
html = html.replace('src="/src/main.js"', 'src="/src/mobile-entry.js"');
html = html.replace('<html lang="en">', '<html lang="zh-CN">');
html = html.replace('Press <kbd>R</kbd> for the rod.', '点击「鱼竿」取出鱼竿，长按「抛竿 / 收线」蓄力，松开抛出。');
html = html.replace('The first launch compiles the shaders and can take a minute or two. Later visits load much faster.',
  '首次启动需要编译着色器，请保持前台等待。后续启动通常更快。');
writeFileSync('upstream/index.html', html);
console.log('Prepared complete upstream at ' + upstream.commit);
