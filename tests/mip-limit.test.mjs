import test from 'node:test';
import assert from 'node:assert/strict';
import { GPU } from '../upstream/src/engine/gpu/GPU.js';
import { setFrameUniforms } from '../upstream/src/engine/gpu/Shader.js';
import { ComputeMips } from '../upstream/src/ocean/ComputeMips.js';

globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
GPU.features = new Set();
GPU.device = {
  createBindGroupLayout({ entries, label }) {
    const writes = entries.filter(e => e.storageTexture && (e.visibility & 4)).length;
    assert.ok(writes <= GPU.limits.maxStorageTexturesPerShaderStage, label + ' exceeds storage-texture limit');
    return { entries, label };
  },
  createShaderModule() { return {}; },
  createPipelineLayout(descriptor) { return descriptor; },
  async createComputePipelineAsync() { return {}; },
};
setFrameUniforms({ structName: 'TestFrame', wgsl: 'struct TestFrame { time: f32 };' });
const texture = {
  label: 'test ocean', width: 256, height: 256, depth: 4, dimension: '2d-array',
  mipLevelCount: 9, format: 'rgba16float', sampleType: 'float', sampleCount: 1,
  defaultViewDimension: '2d-array', wgslType: () => 'texture_2d_array<f32>',
};

test('four-storage-texture devices still generate every mip for every ocean layer', async () => {
  GPU.limits = { maxStorageTexturesPerShaderStage: 4 };
  const chain = new ComputeMips(texture);
  assert.equal(chain.lowBindingSteps.length, 8, 'all levels 1 through 8 remain present');
  for (let i = 0; i < chain.lowBindingSteps.length; i++) {
    const { kernel, groups } = chain.lowBindingSteps[i];
    assert.equal(kernel.bindings.specs.mipSource.view.baseMipLevel, i);
    assert.equal(kernel.bindings.specs.mipDestination.view.baseMipLevel, i + 1);
    assert.deepEqual(groups, [Math.ceil((256 >> (i + 1)) / 8), Math.ceil((256 >> (i + 1)) / 8), 4]);
    assert.equal(kernel.bindings.layout.entries.filter(e => e.storageTexture).length, 1);
  }
  await GPU.pipelinesReady();
});

test('devices with enough storage slots retain the original two-dispatch path', async () => {
  GPU.limits = { maxStorageTexturesPerShaderStage: 8 };
  const chain = new ComputeMips(texture);
  assert.equal(chain.lowBindingSteps, undefined);
  assert.ok(chain.kernelA && chain.kernelB);
  assert.equal(chain.kernelA.bindings.layout.entries.filter(e => e.storageTexture).length, 5);
  assert.equal(chain.kernelB.bindings.layout.entries.filter(e => e.storageTexture).length, 3);
  await GPU.pipelinesReady();
});
