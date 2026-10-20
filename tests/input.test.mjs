import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../mobile/Input.js';

function fixture() {
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.hidden = false;
  const canvas = new EventTarget();
  const input = new Input(canvas, { touch: false });
  return { input, canvas };
}

test('a key remains held until every input source releases it', () => {
  const { input } = fixture();
  input.setKey('KeyW', true, 'keyboard');
  input.setKey('KeyW', true, 'stick');
  assert.equal(input.hit('KeyW'), true);
  input.endFrame();
  input.setKey('KeyW', false, 'stick');
  assert.equal(input.down('KeyW'), true);
  assert.equal(input.hit('KeyW'), false);
  input.setKey('KeyW', false, 'keyboard');
  assert.equal(input.down('KeyW'), false);
});

test('tap is observed once without leaving a key held', () => {
  const { input } = fixture();
  input.tap('KeyE');
  assert.equal(input.hit('KeyE'), true);
  assert.equal(input.down('KeyE'), false);
  input.endFrame();
  assert.equal(input.hit('KeyE'), false);
});

test('different fingers can share a held action safely', () => {
  const { input } = fixture();
  input.setMouse(0, true, 'touch:1');
  input.setMouse(0, true, 'touch:2');
  input.setMouse(0, false, 'touch:1');
  assert.equal(input.mouseDown, true);
  input.setMouse(0, false, 'touch:2');
  assert.equal(input.mouseDown, false);
});

test('focus loss cancels movement, fishing and view deltas', () => {
  const { input } = fixture();
  input.setKey('Space', true, 'touch:1');
  input.setMouse(0, true, 'touch:2');
  input.look.x = 50;
  window.dispatchEvent(new Event('blur'));
  assert.equal(input.down('Space'), false);
  assert.equal(input.hit('Space'), false);
  assert.equal(input.mouseDown, false);
  assert.deepEqual(input.consumeLook(), { x: 0, y: 0 });
});

test('native pause clears held actions to prevent stuck controls', () => {
  const { input } = fixture();
  input.setKey('KeyD', true, 'stick');
  input.setMouse(1, true, 'touch:3');
  window.dispatchEvent(new Event('tidewater:pause'));
  assert.equal(input.keys.size, 0);
  assert.equal(input.rightDown, false);
});

test('disabled input does not trigger game actions', () => {
  const { input } = fixture();
  input.setKey('KeyR', true);
  input.enabled = false;
  assert.equal(input.hit('KeyR'), false);
  assert.equal(input.down('KeyR'), false);
});
