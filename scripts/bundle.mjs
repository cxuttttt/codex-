import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const r = spawnSync('npm', ['run', 'build'], { cwd: resolve('upstream'), stdio: 'inherit' });
if (r.status !== 0) throw new Error('Vite build failed.');
const dest = 'android/app/src/main/assets/game';
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync('upstream/dist', dest, { recursive: true });
const credits = join(dest, 'licenses');
mkdirSync(credits, { recursive: true });
for (const name of ['LICENSE', 'CREDITS.md']) cpSync(join('upstream', name), join(credits, name));
const sourcePublic = resolve('upstream/public');
const manifest = [];
function scan(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scan(path);
    else {
      const rel = path.slice(sourcePublic.length + 1).replaceAll('\\', '/');
      const built = join(dest, rel);
      const original = readFileSync(path), packaged = readFileSync(built);
      if (!original.equals(packaged)) throw new Error('Missing or changed upstream asset: ' + rel);
      manifest.push({ path: rel, size: original.length, sha256: createHash('sha256').update(original).digest('hex') });
    }
  }
}
scan(sourcePublic);
const html = readFileSync(join(dest, 'index.html'), 'utf8');
if (/https?:\/\/fonts\.(googleapis|gstatic)\.com/.test(html)) throw new Error('Remote fonts remain in HTML.');
const config = JSON.parse(readFileSync('upstream.json', 'utf8'));
writeFileSync('build-report.json', JSON.stringify({
  upstream: config, createdAt: new Date().toISOString(), upstreamPublicFileCount: manifest.length,
  upstreamPublicBytes: manifest.reduce((n, x) => n + x.size, 0), completeOriginalAssetsVerified: true,
  networkPermissionRequested: false, minimumAndroidApi: 31, mobileTests: 'see workflow checks',
  physicalDeviceTested: false, assets: manifest
}, null, 2));
writeFileSync(join(dest, 'mobile-build.json'), JSON.stringify({ ...config, assetCount: manifest.length }));
console.log('Bundled all ' + manifest.length + ' original public assets.');
