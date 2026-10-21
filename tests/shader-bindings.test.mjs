import test from 'node:test';
import assert from 'node:assert/strict';
import { GPU } from '../upstream/src/engine/gpu/GPU.js';
import { ShaderModule, composeShader, setFrameUniforms, reachableIdentifiers } from '../upstream/src/engine/gpu/Shader.js';

globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
GPU.features = new Set();
GPU.device = { createBindGroupLayout({ label, entries }) {
  for (const stage of [1, 2, 4]) {
    const n = entries.filter(e => e.texture && (e.visibility & stage)).length;
    assert.ok(n <= 16, `${label}: ${n} textures exceeds the phone limit`);
  }
  return { label, entries };
} };
setFrameUniforms({ structName: 'TestFrame', wgsl: 'struct TestFrame { time: f32 };' });
const texture = { defaultViewDimension: '2d', sampleType: 'float', sampleCount: 1, wgslType: () => 'texture_2d<f32>' };
const bindings = Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['tex' + i, { texture }]));
const module = new ShaderModule({ name: 'all-module-textures', bindings, code: `
  fn needed() -> vec4f { return textureLoad(tex0, vec2i(0), 0); }
  fn unusedHelper() -> vec4f { return textureLoad(tex20, vec2i(0), 0); }
  // fn misleading() { tex19 tex18 }
` });

test('compute kernels fit 16 textures even when dependency modules declare 21', () => {
  const shader = composeShader({ modules: [module], stage: 'compute', code: `
    @compute @workgroup_size(1) fn main() { let value = needed(); }
  ` });
  const entries = shader.bindings.layout.entries;
  assert.deepEqual(entries.filter(e => e.visibility).map(e => e.binding), [0]);
  assert.equal(entries[0].visibility, GPUShaderStage.COMPUTE);
  assert.equal(entries.length, 21, 'retain original binding numbers and unused-helper declarations');
  assert.match(shader.code, /@binding\(20\) var tex20/);
  assert.match(shader.code, /fn unusedHelper/);
});

test('render bindings count only in the stages that actually use them', () => {
  const shader = composeShader({ modules: [module], code: `
    @vertex fn vs() -> @builtin(position) vec4f { return vec4f(textureLoad(tex1, vec2i(0), 0).xyz, 1.0); }
    @fragment fn fs() -> @location(0) vec4f { return needed(); }
  ` });
  const entries = shader.bindings.layout.entries;
  assert.equal(entries[0].visibility, GPUShaderStage.FRAGMENT);
  assert.equal(entries[1].visibility, GPUShaderStage.VERTEX);
  assert.ok(entries.slice(2).every(e => e.visibility === 0));
});

test('nested comments and disabled preprocessor branches do not consume texture slots', () => {
  const code = `/* fn fake() { /* nested } */ tex20 } */
    fn helper() -> vec4f { return textureLoad(tex0, vec2i(0), 0); }
    @compute @workgroup_size(1) fn main() {
      // tex19 }
      let v = helper();
    }
  `;
  const used = reachableIdentifiers(code, 'main');
  assert.ok(used.has('tex0'));
  assert.ok(!used.has('tex19'));
  assert.ok(!used.has('tex20'));
  const shader = composeShader({ modules: [module], stage: 'compute', defines: { OPTIONAL: false }, code: `
    @compute @workgroup_size(1) fn main() {
      let a = needed();
      #if OPTIONAL
      let b = textureLoad(tex19, vec2i(0), 0);
      #endif
    }
  ` });
  assert.equal(shader.bindings.layout.entries[19].visibility, 0);
});

test('a real over-budget shader still fails rather than silently losing textures', () => {
  const reads = Array.from({ length: 17 }, (_, i) => `let t${i} = textureLoad(tex${i}, vec2i(0), 0);`).join('\n');
  assert.throws(() => composeShader({ modules: [module], stage: 'compute', code: `@compute @workgroup_size(1) fn main() { ${reads} }` }), /17 textures exceeds/);
});
