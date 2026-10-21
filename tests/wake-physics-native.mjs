// Run with a Vulkan ICD and loader available. This executes all 512x512 cells.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create, globals } from '../upstream/node_modules/webgpu/index.js';
import { GPU, ShaderModule, UniformBlock, Texture, StorageBuffer, ComputeKernel, commonModule } from '../upstream/src/engine/webgpu.js';
import { FrameUniforms } from '../upstream/src/engine/render/Frame.js';
import { generateMipmaps } from '../upstream/src/engine/gpu/Mipmaps.js';
import { createTerrainSurfaceTexture } from '../upstream/src/world/TerrainGPU.js';
import { installUnderwaterLighting } from '../upstream/src/ocean/UnderwaterLighting.js';
import { WakeSim } from '../upstream/src/ocean/WakeSim.js';
import { HullLines } from '../upstream/src/world/boat/HullLines.js';

Object.assign(globalThis, globals);
Object.defineProperty(globalThis, 'navigator', { value: { gpu: create(['backend=vulkan']) }, configurable: true });
await GPU.init({ headless: true, requiredLimits: { maxSampledTexturesPerShaderStage: 16, maxStorageTexturesPerShaderStage: 4 } });
GPU.device.pushErrorScope('validation');

// Compare every texel of every mip against the original two-texture path.
const mapSize = 32;
const normalData = Uint8Array.from({ length: mapSize * mapSize * 4 }, (_, i) => (i * 13 + 29) % 256);
const splatData = Uint8Array.from({ length: mapSize * mapSize * 4 }, (_, i) => (i * 37 + 101) % 256);
const originalNormal = new Texture({ width: mapSize, height: mapSize, format: 'rgba8unorm', mips: true, data: normalData });
const originalSplat = new Texture({ width: mapSize, height: mapSize, format: 'rgba8unorm', mips: true, data: splatData });
generateMipmaps(originalNormal); generateMipmaps(originalSplat);
const packed = createTerrainSurfaceTexture(normalData, splatData, mapSize);
const results = new StorageBuffer({ count: 2, type: 'atomic<u32>' });
const equality = new ComputeKernel({ label: 'Terrain array equality', workgroupSize: [8, 8, 1], bindings: {
  normalMap: { texture: originalNormal }, splatMap: { texture: originalSplat },
  packedMap: { texture: packed }, results: { storage: results, access: 'read_write' },
}, code: `
@compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) gid:vec3u) {
  let level=i32(gid.z); if(any(gid.xy>=textureDimensions(packedMap,level))){return;}
  let p=vec2i(gid.xy);
  if(any(textureLoad(normalMap,p,level)!=textureLoad(packedMap,p,0,level))){atomicAdd(&results[0],1u);}
  if(any(textureLoad(splatMap,p,level)!=textureLoad(packedMap,p,1,level))){atomicAdd(&results[0],1u);}
  atomicAdd(&results[1],2u);
}` });
await GPU.pipelinesReady();
equality.dispatch([4, 4, packed.mipLevelCount]);
const mapReadback = GPU.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
GPU.getEncoder().copyBufferToBuffer(results.getGPU(), 0, mapReadback, 0, 16);
GPU.submit(); await mapReadback.mapAsync(GPUMapMode.READ);
const compared = new Uint32Array(mapReadback.getMappedRange());
assert.equal(compared[0], 0, 'Array packing preserves every RGBA value at every mip level');
assert.equal(compared[1], 2730, 'Compare both layers over all six mip levels');
console.log('PASSED terrain array packing: all 2730 texels match the original two textures, including every mip');
mapReadback.unmap(); mapReadback.destroy();
originalNormal.destroy(); originalSplat.destroy(); packed.destroy(); results.destroy();

const oceanUniforms = new UniformBlock('ArrayTestOcean', { sizes: ['vec4f[2]', [[128, 0, 0, 0], [256, 0, 0, 0]]] });
const oceanDisplacement = new Texture({ width: 1, height: 1, depth: 2, dimension: '2d-array', format: 'rgba16float',
  data: new Uint16Array([0, 0x3d00, 0, 0, 0, 0x3d00, 0, 0]) }); // height 1.25 per cascade
const oceanDerivatives = new Texture({ width: 1, height: 1, depth: 2, dimension: '2d-array', format: 'rgba16float',
  data: new Uint16Array([0x3000, 0x3400, 0, 0, 0x3000, 0x3400, 0, 0]) }); // slopes 0.125, 0.25
const fft = { cascades: 2, module: new ShaderModule({ name: 'arrayTestOcean', uniforms: oceanUniforms, uniformName: 'ocean', bindings: {
  oceanDisplacement: { texture: oceanDisplacement }, oceanDerivatives: { texture: oceanDerivatives },
} }) };
const lighting = installUnderwaterLighting({ fft, caustics: null });
const lightResults = new StorageBuffer({ count: 2, type: 'atomic<u32>' });
const lightCheck = new ComputeKernel({ label: 'Underwater four-layer equality', workgroupSize: [8, 8, 1], bindings: {
  lightMaps: { texture: lighting.levels[0].maps }, results: { storage: lightResults, access: 'read_write' },
}, code: `
@compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) gid:vec3u) {
  if(any(gid.xy>=textureDimensions(lightMaps))){return;}
  let value=textureLoad(lightMaps,vec2i(gid.xy),i32(gid.z),0);
  let expected=select(vec4f(2.5,0.25,0.5,0.0),vec4f(2.5,1.0,0.0,1.0),(gid.z&1u)==1u);
  if(any(value!=expected)){atomicAdd(&results[0],1u);}
  atomicAdd(&results[1],1u);
}` });
await GPU.pipelinesReady();
lighting.update({ position: { x: 0, z: 0 } });
lightCheck.dispatch([64, 64, 4]);
const lightReadback = GPU.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
GPU.getEncoder().copyBufferToBuffer(lightResults.getGPU(), 0, lightReadback, 0, 16);
GPU.submit(); await lightReadback.mapAsync(GPUMapMode.READ);
const lightCompared = new Uint32Array(lightReadback.getMappedRange());
assert.equal(lightCompared[0], 0, 'Every independently written underwater layer contains the expected data');
assert.equal(lightCompared[1], 512 * 512 * 4);
console.log('PASSED underwater lighting array: all 1048576 texels in four independently written layers match');
lightReadback.unmap(); lightReadback.destroy();

const terrainCode = readFileSync(new URL('../upstream/src/world/TerrainGPU.js', import.meta.url), 'utf8')
  .split('const TERRAIN_WGSL = /* wgsl */`')[1].split('`;')[0];
const texture = format => new Texture({ width: 2, height: 2, format });
const height = new Texture({ width: 2, height: 2, format: 'r32float', data: new Float32Array(4).fill(-10) });
const params = new UniformBlock('TerrainParams', { origin: ['f32', -1000], size: ['f32', 4000], res: ['f32', 2], shoreRes: 'f32', sunBake: 'vec3f', sunBaked: 'f32' });
const terrain = { module: new ShaderModule({ name: 'terrain', deps: [commonModule], uniforms: params, bindings: {
  terrainHeightTex: { texture: height, sampleType: 'unfilterable-float' },
  terrainSurfaceTex: { texture: new Texture({ width: 2, height: 2, depth: 2, dimension: '2d-array', format: 'rgba8unorm' }) },
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
