const report = {
  version: '0.1.1',
  upstreamCommit: '4811ba48d795197de5621985f404e765c0b7c0ef',
  startedAt: new Date().toISOString(),
  stage: '检查运行环境',
  errors: [],
  samples: []
};
let panel, diagnostics, badge, savedEnabled = true;
let lastTime = 0, lastFrame = 0, sampling = false;
let paused = false;
const reasons = new Set();

function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function rememberError(value) {
  const message = value instanceof Error ? (value.stack || value.message) : String(value);
  if (!report.errors.some(x => x.message === message)) {
    report.errors.push({ at: new Date().toISOString(), message });
    report.errors = report.errors.slice(-30);
  }
}
function saveState() {
  try { window.__tideApp?.game?.state?.save(); } catch (_) {}
}
function pause(reason) {
  reasons.add(reason);
  window.__tideApp?.input?.reset();
  saveState();
  const app = window.__tideApp;
  if (window.__tideReady && !paused) { app?.engine?.stop(); paused = true; }
  const context = app?.audio?.context || app?.audio?.ctx;
  context?.suspend?.()?.catch?.(() => {});
  sampling = false;
}
function resume(reason) {
  reasons.delete(reason);
  if (!reasons.size && paused) {
    paused = false;
    window.__tideApp?.start();
    window.__tideApp?.audio?.resume();
  }
}

export function reportObject() {
  const app = window.__tideApp;
  const samples = report.samples;
  return {
    ...report,
    android: window.__ANDROID_ENV__ || null,
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    webgpuExposed: !!navigator.gpu,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    ready: !!window.__tideReady,
    renderedFrames: app?.engine?.frame || 0,
    renderScale: app?.settings?.renderScale,
    renderSize: app?.sceneRenderer ? [app.sceneRenderer.width, app.sceneRenderer.height] : null,
    foregroundSampleSeconds: samples.reduce((n, x) => n + x.seconds, 0),
    averageFps: samples.length ? samples.reduce((n, x) => n + x.frames, 0) / samples.reduce((n, x) => n + x.seconds, 0) : null,
    minimumOneSecondFps: samples.length ? Math.min(...samples.map(x => x.fps)) : null
  };
}

export async function copyReport() {
  const text = JSON.stringify(reportObject(), null, 2);
  try {
    if (window.TidewaterHost?.copyReport) window.TidewaterHost.copyReport(text);
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = node('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    if (badge) badge.textContent = '诊断已复制';
  } catch (_) {
    openPanel();
    diagnostics.value = text;
    diagnostics.focus();
    diagnostics.select();
  }
}

export function openPanel() {
  if (!panel || panel.open) return;
  const input = window.__tideApp?.input;
  savedEnabled = input?.enabled ?? true;
  if (input) { input.reset(); input.enabled = false; }
  window.__tidePanelOpen = true;
  const select = panel.querySelector('select');
  if (select) select.value = String(window.__tideApp?.settings?.renderScale || 0.7);
  diagnostics.value = JSON.stringify(reportObject(), null, 2);
  panel.showModal();
}

function closePanel() {
  if (!panel?.open) return;
  panel.close();
}
function createPanel() {
  panel = node('dialog', 'tw-mobile-panel tw-interactive');
  panel.append(node('h2', '', 'Tidewater · 安卓验证版'));
  panel.append(node('p', 'tw-mobile-note', '左侧摇杆移动，拖动画面转向。长按「抛竿 / 收线」蓄力，松开抛出；鱼上钩后再按住收线。首次启动请保持前台等待。'));
  const quality = node('label', 'tw-mobile-quality', '渲染精细度 ');
  const select = node('select');
  for (const [value, label] of [['0.5', '省电 · 50%'], ['0.7', '均衡 · 70%'], ['1', '精细 · 100%']]) {
    const option = node('option', '', label);
    option.value = value;
    select.append(option);
  }
  select.value = String(window.__tideApp?.settings?.renderScale || 0.7);
  select.addEventListener('change', () => {
    const value = Number(select.value);
    try { localStorage.setItem('tidewater.mobile.scale', String(value)); } catch (_) {}
    window.__tideApp?.setRenderScale(value);
    diagnostics.value = JSON.stringify(reportObject(), null, 2);
  });
  quality.append(select);
  panel.append(quality);
  const tools = node('div', 'tw-mobile-tools');
  for (const [label, code] of [['自由视角', 'KeyF'], ['船舶视角', 'KeyV'], ['手电', 'KeyL'], ['昼夜暂停', 'KeyT'], ['声音', 'KeyM']]) {
    const button = node('button', '', label);
    button.type = 'button';
    button.addEventListener('click', () => { closePanel(); window.__tideApp?.input?.tap(code); });
    tools.append(button);
  }
  panel.append(tools);
  diagnostics = node('textarea', 'tw-mobile-diagnostics');
  diagnostics.readOnly = true;
  diagnostics.setAttribute('aria-label', '运行诊断');
  panel.append(diagnostics);
  const bottom = node('div', 'tw-mobile-tools');
  const copy = node('button', '', '复制诊断');
  copy.addEventListener('click', copyReport);
  const close = node('button', '', '返回游戏');
  close.addEventListener('click', closePanel);
  bottom.append(copy, close);
  panel.append(bottom);
  panel.addEventListener('close', () => {
    window.__tidePanelOpen = false;
    const input = window.__tideApp?.input;
    if (input) { input.reset(); input.enabled = savedEnabled; }
  });
  document.body.append(panel);
  badge = node('button', 'tw-mobile-badge tw-interactive', '正在检查 GPU');
  badge.type = 'button';
  badge.setAttribute('aria-label', '查看运行诊断');
  badge.addEventListener('click', openPanel);
  document.body.append(badge);
}

export function showFatal(error) {
  rememberError(error);
  report.stage = '运行失败';
  window.__tideApp?.engine?.stop();
  saveState();
  if (document.getElementById('tw-mobile-fatal')) return;
  const card = node('section', 'tw-mobile-fatal tw-interactive');
  card.id = 'tw-mobile-fatal';
  card.append(node('h2', '', '暂时无法运行'));
  card.append(node('p', '', error?.message || String(error)));
  card.append(node('p', 'tw-mobile-note', '可先更新 Android System WebView 再重试。请复制诊断信息，用于判断是设备兼容问题还是场景运行错误。'));
  const copy = node('button', '', '复制诊断');
  copy.addEventListener('click', copyReport);
  const reload = node('button', '', '重新载入');
  reload.addEventListener('click', () => location.reload());
  card.append(copy, reload);
  document.body.append(card);
  if (badge) badge.textContent = '运行失败 · 诊断';
}

async function gpuProbe() {
  if (!window.isSecureContext) throw new Error('当前页面不是安全上下文，WebGPU 无法启用。');
  if (!navigator.gpu) throw new Error('当前 Android WebView 未提供 WebGPU。');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('无法取得 WebGPU 适配器，可能受到设备、驱动或 WebView 的限制。');
  const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
  report.gpu = {
    vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
    features: Array.from(adapter.features),
    limits: {
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxSampledTexturesPerShaderStage: adapter.limits.maxSampledTexturesPerShaderStage,
      maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
      maxStorageTexturesPerShaderStage: adapter.limits.maxStorageTexturesPerShaderStage,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      maxBufferSize: adapter.limits.maxBufferSize
    }
  };
  const device = await adapter.requestDevice();
  let buffer, readback;
  try {
    device.pushErrorScope('validation');
    buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> data: array<u32>; @compute @workgroup_size(1) fn main() { data[0] = 42u; }' });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(buffer, 0, readback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint32Array(readback.getMappedRange())[0];
    readback.unmap();
    const validation = await device.popErrorScope();
    if (validation) throw new Error(validation.message);
    if (result !== 42) throw new Error('GPU 计算读取校验失败。');
    report.gpuComputeProbe = 'passed';
  } finally {
    buffer?.destroy();
    readback?.destroy();
    device.destroy();
  }
}

function sample() {
  const app = window.__tideApp;
  const ready = !!window.__tideReady && !window.__ui?._start && !document.hidden && !paused;
  const now = performance.now(), frame = app?.engine?.frame || 0;
  if (ready && sampling) {
    const seconds = (now - lastTime) / 1000, frames = frame - lastFrame;
    if (seconds > 0 && seconds < 5 && frames >= 0) {
      const fps = frames / seconds;
      report.samples.push({ seconds, frames, fps });
      report.samples = report.samples.slice(-900);
      badge.textContent = Math.round(fps) + ' FPS · 诊断';
    }
  } else if (!window.__tideReady && report.stage !== '运行失败') {
    badge.textContent = report.stage;
  }
  sampling = ready;
  lastTime = now;
  lastFrame = frame;
  if (panel?.open) diagnostics.value = JSON.stringify(reportObject(), null, 2);
}

export async function prepareMobile() {
  createPanel();
  window.__TIDE_REPORT__ = reportObject;
  const originalError = console.error.bind(console);
  console.error = (...args) => { rememberError(args.map(x => x?.message || String(x)).join(' ')); originalError(...args); };
  window.addEventListener('error', e => rememberError(e.error || e.message));
  window.addEventListener('unhandledrejection', e => rememberError(e.reason));
  window.addEventListener('tidewater:error', e => showFatal(e.detail));
  window.addEventListener('tidewater:gpu-lost', e => showFatal('GPU 连接丢失：' + e.detail));
  window.addEventListener('tidewater:progress', e => { report.stage = e.detail.text; });
  window.addEventListener('tidewater:pause', () => pause('native'));
  window.addEventListener('tidewater:resume', () => resume('native'));
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => document.hidden ? pause('visibility') : resume('visibility'));
  window.__tideHandleBack = () => {
    if (panel.open) { closePanel(); return true; }
    const app = window.__tideApp, ui = window.__ui, hud = app?.game?.hud;
    if (hud?.invOpen) { hud.toggleInventory(false); return true; }
    if (hud?.standOpen) { hud.closeStand(); return true; }
    if (ui?._panelOpen) { ui.togglePanel(); return true; }
    saveState();
    return false;
  };
  const url = new URL(location.href);
  if (!url.searchParams.has('scale')) {
    let scale = 0.7;
    try {
      const saved = Number(localStorage.getItem('tidewater.mobile.scale'));
      if ([0.5, 0.7, 1].includes(saved)) scale = saved;
    } catch (_) {}
    url.searchParams.set('scale', String(scale));
  }
  url.searchParams.set('mobile', '1');
  history.replaceState(null, '', url);
  const timer = setInterval(sample, 1000);
  try {
    await gpuProbe();
    report.stage = '加载完整海岛';
    return true;
  } catch (error) {
    clearInterval(timer);
    showFatal(error);
    return false;
  }
}
