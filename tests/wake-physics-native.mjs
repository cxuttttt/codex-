// Run with a Vulkan ICD and loader available. This executes all 512x512 cells.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create, globals } from '../upstream/node_modules/webgpu/index.js';
import { GPU, ShaderModule, UniformBlock, Texture, commonModule } from '../upstream/src/engine/webgpu.js';
import { FrameUniforms } from '../upstream/src/engine/render/Frame.js';
import { WakeSim } from '../upstream/src/ocean/WakeSim.js';
import { HullLines } from '../upstream/src/world/boat/HullLines.js';

Object.assign(globalThis, globals);
Object.defineProperty(globalThis, 'navigator', { value: { gpu: create(['backend=vulkan']) }, configurable: true });
await GPU.init({ headless: true, requiredLimits: { maxSampledTexturesPerShaderStage: 16, maxStorageTexturesPerShaderStage: 4 } });
GPU.device.pushErrorScope('validation');
const terrainCode = readFileSync(new URL('../upstream/src/world/TerrainGPU.js', import.meta.url), 'utf8')
  .split('const TERRAIN_WGSL = /* wgsl */`')[1].split('`;')[0];
const texture = format => new Texture({ width: 2, height: 2, format });
const height = new Texture({ width: 2, height: 2, format: 'r32float', data: new Float32Array(4).fill(-10) });
const params = new UniformBlock('TerrainParams', { origin: ['f32', -1000], size: ['f32', 4000], res: ['f32', 2], shoreRes: 'f32', sunBake: 'vec3f', sunBaked: 'f32' });
const terrain = { module: new ShaderModule({ name: 'terrain', deps: [commonModule], uniforms: params, bindings: {
  terrainHeightTex: { texture: height, sampleType: 'unfilterable-float' },
  terrainNormalTex: { texture: texture('rgba8unorm') }, terrainSplatTex: { texture: texture('rgba8unorm') },
  terrainDetailTex: { texture: texture('rgba8unorm') }, terrainShoreTex: { texture: texture('rgba32float'), sampleType: 'unfilterable-float' },
  terrainSunShadowTex: { texture: texture('rgba16float') },
}, code: terrainCode }) };
const started = performance.now();
const wake = new WakeSim(null, { terrainGPU: terrain, boat: { model: { lines: new HullLines() } } });
assert.ok(wake.physicsKernel, 'Portable device uses separate cell physics');
await GPU.pipelinesReady();
console.log('Compiled actual split-physics wake and three original FFT pipelines in', Math.round(performance.now() - started), 'ms');

const n = 512, dt = 0.01, amplitude = 0.01, kx = 3, kz = 5;
const k = 2 * Math.PI / (n * 0.4) * Math.hypot(kx, kz);
const initial = new Float32Array(n * n * 4);
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) initial[(z * n + x) * 4] = amplitude * Math.cos(2 * Math.PI * (kx * x + kz * z) / n);
const clamp = x => Math.min(1, Math.max(0, x));
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
for (const depth of [10, 1]) {
  height.getGPU(); height.upload(new Float32Array(4).fill(-depth));
  wake.state.write(initial);
  for (const [name, value] of Object.entries({ reset: 0, dt, source: 0, wash: 0, bow: 0, visc: 0, foamGain: 0, aerGain: 0 })) wake.kernelParams.fields[name].value = value;
  FrameUniforms.fields.seaLevel.value = 0;
  GPU.beginFrame();
  wake._dispatch();
  const readback = GPU.device.createBuffer({ size: initial.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  GPU.getEncoder().copyBufferToBuffer(wake.state.getGPU(), 0, readback, 0, initial.byteLength);
  GPU.submit();
  await readback.mapAsync(GPUMapMode.READ);
  const actual = new Float32Array(readback.getMappedRange());
  const deepWeight = depth > 6 ? 1 - Math.exp(-(depth - 6) / 9) : 0;
  const middleWeight = depth > 6 ? 1 - deepWeight : depth > 1.8 ? ((depth - 1.8) / 4.2) ** 0.8 : 0;
  const shallowWeight = depth > 6 ? 0 : depth > 1.8 ? 1 - middleWeight : depth > 0.6 ? ((depth - 0.6) / 1.2) ** 0.85 : 0;
  const shoreWeight = depth > 1.8 ? 0 : depth > 0.6 ? 1 - shallowWeight : clamp(depth / 0.6);
  const operator = k * (deepWeight + middleWeight * Math.tanh(Math.min(k * 6, 12)) + shallowWeight * Math.tanh(Math.min(k * 1.8, 12)) + shoreWeight * Math.tanh(Math.min(k * 0.6, 12)));
  let maxHeightError = 0, maxVelocityError = 0;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = (z * n + x) * 4;
    const edge = Math.min(x + 0.5, n - x - 0.5, z + 0.5, n - z - 0.5);
    const sponge = Math.exp(-dt * 6 * smooth((22 - edge) / 22) ** 2);
    const velocity = -9.81 * operator * initial[i] * dt;
    const expectedHeight = (initial[i] + velocity * dt) * sponge;
    maxHeightError = Math.max(maxHeightError, Math.abs(actual[i] - expectedHeight));
    maxVelocityError = Math.max(maxVelocityError, Math.abs(actual[i + 1] - velocity * sponge));
    assert.ok(Number.isFinite(actual[i]) && Number.isFinite(actual[i + 1]));
    assert.equal(actual[i + 2], 0, 'No spurious foam');
  }
  console.log(JSON.stringify({ depth, cellsVerified: n * n, maxHeightError, maxVelocityError }));
  assert.ok(maxHeightError < 0.000002, 'Analytic wave height agrees: ' + maxHeightError);
  // Absolute tolerance: five micrometres per second for the software driver's FFT.
  assert.ok(maxVelocityError < 0.000005, 'Analytic dispersion agrees: ' + maxVelocityError);
  readback.unmap(); readback.destroy();
}
const validation = await GPU.device.popErrorScope();
assert.equal(validation, null, validation?.message);
console.log('PASSED actual Vulkan wake computation: deep and shallow dispersion match analytic solutions across every cell');
GPU.device.destroy(); process.exit(0);
