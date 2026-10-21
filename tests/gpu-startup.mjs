import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TIDEWATER_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '../upstream/dist');
const out = resolve(process.env.TIDEWATER_GPU_OUTPUT || '/tmp/tidewater-gpu-test');
const expectFailure = process.argv.includes('--expect-failure');
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + sep)) throw new Error('Outside test root');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch (_) { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
const errors = [];
let report;
try {
  browser = await chromium.launch({
    // Use Chrome's current headless compositor; the headless shell cannot
    // present Dawn Vulkan swap-chain textures through its default GL path.
    channel: 'chromium',
    executablePath: process.env.TIDEWATER_CHROMIUM || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
      '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
      '--disable-vulkan-surface', '--disable-dev-shm-usage', '--disable-gpu-watchdog'],
  });
  page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.addInitScript(() => {
    window.__testTextureLimit = 16;
    window.__testBindingCounts = [];
    window.__testDeviceLimits = [];
    window.__testStorageLimits = [];
    window.__testPipelines = { started: 0, completed: 0, active: {}, failed: [] };
    const modules = new WeakMap();
    const createModule = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function(descriptor) {
      const module = createModule.call(this, descriptor);
      modules.set(module, descriptor.code);
      return module;
    };
    for (const [method, kind] of [['createComputePipelineAsync', 'compute'], ['createRenderPipelineAsync', 'render']]) {
      const create = GPUDevice.prototype[method];
      GPUDevice.prototype[method] = async function(descriptor) {
        const stats = window.__testPipelines;
        const id = ++stats.started;
        const stages = Object.fromEntries(['compute', 'vertex', 'fragment'].filter(s => descriptor[s]).map(s =>
          [s, { ...descriptor[s], module: undefined, code: modules.get(descriptor[s].module) }]));
        const record = { kind, descriptor: { ...descriptor, layout: 'auto', ...stages } };
        stats.active[id] = record;
        try {
          const pipeline = await create.call(this, descriptor);
          stats.completed++;
          return pipeline;
        } catch (error) {
          if (stats.failed.length < 4) stats.failed.push({ ...record, error: error.message });
          throw error;
        } finally { delete stats.active[id]; }
      };
    }
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(descriptor = {}) {
      const device = await request.call(this, {
        ...descriptor,
        requiredLimits: { ...descriptor.requiredLimits, maxSampledTexturesPerShaderStage: 16, maxStorageTexturesPerShaderStage: 4 },
      });
      window.__testDeviceLimits.push(device.limits.maxSampledTexturesPerShaderStage);
      window.__testStorageLimits.push(device.limits.maxStorageTexturesPerShaderStage);
      return device;
    };
    const create = GPUDevice.prototype.createBindGroupLayout;
    GPUDevice.prototype.createBindGroupLayout = function(descriptor) {
      const counts = {};
      for (const [name, stage] of [['vertex', 1], ['fragment', 2], ['compute', 4]]) {
        counts[name] = Array.from(descriptor.entries).filter(e => e.texture && (e.visibility & stage)).length;
        counts[name + 'Storage'] = Array.from(descriptor.entries).filter(e => e.storageTexture && (e.visibility & stage)).length;
      }
      window.__testBindingCounts.push({ label: descriptor.label, ...counts });
      return create.call(this, descriptor);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?mobile=1&scale=0.5`, { timeout: 60000 });
  await page.waitForFunction(() => window.__tideReady || window.__TIDE_REPORT__?.().stage === '运行失败', null, { timeout: 900000 });
  if (!expectFailure && await page.evaluate(() => !!window.__tideReady)) {
    await page.evaluate(() => window.__ui?.startEl?.click());
    await page.waitForFunction(() => window.__tideApp?.engine?.frame >= 3, null, { timeout: 180000 });
  }
  report = await page.evaluate(() => ({
    report: window.__TIDE_REPORT__?.(),
    deviceLimits: window.__testDeviceLimits,
    storageLimits: window.__testStorageLimits,
    bindingCounts: window.__testBindingCounts,
    startOverlay: window.__ui?._start,
    pipelineStats: { started: window.__testPipelines.started, completed: window.__testPipelines.completed,
      active: Object.values(window.__testPipelines.active).map(p => p.descriptor.label),
      failed: window.__testPipelines.failed.map(p => ({ label: p.descriptor.label, error: p.error })) },
    canvasSize: Array.from(document.querySelectorAll('canvas')).map(c => [c.width, c.height]),
  }));
  report.consoleErrors = errors;
  await page.screenshot({ path: resolve(out, 'screen.png'), timeout: 60000 });
  await writeFile(resolve(out, 'gpu-startup.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(out, 'pipeline-diagnostics.json'), JSON.stringify(await page.evaluate(() => window.__testPipelines), null, 2));
  console.log(JSON.stringify({ ...report, bindingCounts: report.bindingCounts.filter(c => Math.max(c.vertex, c.fragment, c.compute) > 14) }, null, 2));
  assert.ok(report.deviceLimits.length >= 2, 'GPU probe and actual game must both create devices');
  assert.ok(report.deviceLimits.every(n => n === 16), 'Native WebGPU device must enforce 16 sampled textures');
  assert.ok(report.storageLimits.every(n => n === 4), 'Native WebGPU device must enforce 4 storage textures');
  if (expectFailure) {
    assert.equal(report.report.stage, '运行失败');
    assert.ok(errors.some(e => /sampled textures.*maximum per-stage limit/s.test(e)), 'Reproduce the reported texture-limit error');
    console.log('REPRODUCED: original game exceeds the phone texture limit');
  } else {
    assert.equal(report.report.ready, true, 'Complete game startup');
    assert.ok(report.report.renderedFrames >= 3, 'Render actual game frames');
    assert.equal(report.report.errors.length, 0, 'No WebGPU, WGSL or game errors');
    assert.equal(errors.length, 0, 'No browser console errors');
    assert.ok(report.bindingCounts.every(c => Math.max(c.vertex, c.fragment, c.compute) <= 16), 'All stage texture counts fit the phone limit');
    assert.ok(report.bindingCounts.every(c => Math.max(c.vertexStorage, c.fragmentStorage, c.computeStorage) <= 4), 'All storage-texture counts fit the portable limit');
    console.log('PASSED: complete game starts and renders with a 16-texture WebGPU device');
  }
} finally {
  if (page && !report) {
    try {
      const state = await page.evaluate(() => ({ report: window.__TIDE_REPORT__?.(), body: document.body.innerText.slice(-5000) }));
      console.log(JSON.stringify({ state, consoleErrors: errors }, null, 2));
      await writeFile(resolve(out, 'failure.json'), JSON.stringify({ state, consoleErrors: errors }, null, 2));
      await writeFile(resolve(out, 'pipeline-diagnostics.json'), JSON.stringify(await page.evaluate(() => window.__testPipelines), null, 2));
      await page.screenshot({ path: resolve(out, 'failure.png'), timeout: 15000 });
    } catch (_) {}
  }
  await browser?.close();
  await new Promise(done => server.close(done));
}
