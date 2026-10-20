import { MobileControls } from '../mobile/MobileControls.js';

// Same public interface as upstream Input, shared by walking, swimming, boating and fishing.
export class Input {
  constructor(dom, options = {}) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.wheel = 0;
    this.mouseDown = false;
    this.rightDown = false;
    this.locked = false;
    this.enabled = true;
    this._sources = new Map();
    this._mouseSources = [new Set(), new Set()];
    this.isTouch = options.touch ?? (new URLSearchParams(location.search).has('mobile') || window.matchMedia('(pointer: coarse)').matches);
    window.addEventListener('keydown', e => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      this.setKey(e.code, true, 'keyboard');
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.setKey(e.code, false, 'keyboard'));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('tidewater:pause', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    dom.addEventListener('mousedown', e => {
      if (this.isTouch && e.sourceCapabilities?.firesTouchEvents) return;
      if (e.button === 0 || e.button === 2) this.setMouse(e.button === 0 ? 0 : 1, true, 'mouse');
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0 || e.button === 2) this.setMouse(e.button === 0 ? 0 : 1, false, 'mouse');
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (!this.isTouch && (this.locked || this.mouseDown || this.rightDown)) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    dom.addEventListener('wheel', e => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (!this.isTouch) this.locked = document.pointerLockElement === dom;
    });
    if (this.isTouch) this.mobile = new MobileControls(this, dom);
  }

  setKey(code, down, source = 'virtual') {
    let sources = this._sources.get(code);
    if (down) {
      if (!sources) { sources = new Set(); this._sources.set(code, sources); }
      if (sources.has(source)) return;
      sources.add(source);
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    } else if (sources) {
      sources.delete(source);
      if (!sources.size) { this._sources.delete(code); this.keys.delete(code); }
    }
  }

  tap(code) {
    const source = 'tap';
    this.setKey(code, true, source);
    this.setKey(code, false, source);
  }

  setMouse(button, down, source = 'virtual') {
    const set = this._mouseSources[button];
    if (!set) return;
    if (down) set.add(source); else set.delete(source);
    this.mouseDown = this._mouseSources[0].size > 0;
    this.rightDown = this._mouseSources[1].size > 0;
  }

  reset() {
    this.keys.clear();
    this.pressed.clear();
    this._sources.clear();
    for (const set of this._mouseSources) set.clear();
    this.mouseDown = this.rightDown = false;
    this.look.x = this.look.y = this.wheel = 0;
    this.mobile?.reset();
  }

  requestLock() {
    if (this.isTouch) { this.locked = true; return; }
    if (!this.locked) this.dom.requestPointerLock?.()?.catch?.(() => {});
  }
  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  consumeLook() { const v = { ...this.look }; this.look.x = this.look.y = 0; return v; }
  consumeWheel() { const v = this.wheel; this.wheel = 0; return v; }
  endFrame() { this.pressed.clear(); }
}
