import test from 'node:test';
import assert from 'node:assert/strict';
import { GPU } from '../upstream/src/engine/gpu/GPU.js';

function reset(device) {
  assert.equal(GPU._pending.size, 0);
  assert.equal(GPU._compileActive, 0);
  GPU.device = device;
  GPU._compileError = null;
  GPU.syncCompiles = [];
}

test('startup submits at most two asynchronous shader compiles and drains every queued request', async () => {
  let active = 0, peak = 0, count = 0;
  async function compile(desc) {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    count++;
    return { label: desc.label };
  }
  reset({ createComputePipelineAsync: compile, createRenderPipelineAsync: compile });
  const handles = Array.from({ length: 24 }, (_, i) =>
    i % 2 ? GPU.renderPipeline({ label: 'render ' + i }) : GPU.computePipeline({ label: 'compute ' + i }));
  await GPU.pipelinesReady();
  assert.equal(peak, 2);
  assert.equal(count, 24);
  assert.equal(active, 0);
  assert.equal(GPU._compileActive, 0);
  assert.equal(GPU._compileWaiting.length, 0);
  assert.ok(handles.every(h => GPU.ready(h).label === h.label));
});

test('a synchronous first use does not compile its queued pipeline twice', async () => {
  let asyncCount = 0, syncCount = 0;
  reset({
    async createComputePipelineAsync(desc) { asyncCount++; return { label: desc.label }; },
    createComputePipeline(desc) { syncCount++; return { label: desc.label }; },
  });
  const h = GPU.computePipeline({ label: 'one-off bake' });
  assert.equal(GPU.ready(h).label, 'one-off bake');
  await GPU.pipelinesReady();
  assert.equal(syncCount, 1);
  assert.equal(asyncCount, 0);
});

test('compile rejection preserves the shader error, releases queued slots and never returns a null pipeline', async () => {
  const cause = new Error('shader exceeds the device limit');
  const messages = [];
  const original = console.error;
  reset({
    async createComputePipelineAsync(desc) {
      if (desc.label === 'broken ocean') throw cause;
      return { label: desc.label };
    },
  });
  console.error = message => messages.push(message);
  try {
    const broken = GPU.computePipeline({ label: 'broken ocean' });
    const good = Array.from({ length: 8 }, (_, i) => GPU.computePipeline({ label: 'good ' + i }));
    await assert.rejects(GPU.pipelinesReady(), error =>
      error.cause === cause && /broken ocean.*shader exceeds the device limit/.test(error.message));
    assert.throws(() => GPU.ready(broken), error => error.cause === cause);
    assert.ok(good.every(h => GPU.ready(h).label === h.label));
    assert.equal(GPU._pending.size, 0);
    assert.equal(GPU._compileActive, 0);
    assert.equal(GPU._compileWaiting.length, 0);
    assert.equal(messages.length, 1);
  } finally { console.error = original; }
});
