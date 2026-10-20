import { openPanel } from './boot.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class MobileControls {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this._resets = [];
    this.viewPointer = null;
    this.movePointer = null;
    this.root = el('div', 'tw-mobile-controls tw-interactive');
    this.root.hidden = true;
    this.root.setAttribute('aria-label', '触屏操作');
    const top = el('div', 'tw-mobile-top');
    const tapButton = (label, code) => {
      const button = el('button', 'tw-mobile-small', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        const hud = window.__tideApp?.game?.hud;
        if (code === 'KeyI' && hud?.invOpen) hud.toggleInventory(false);
        else this.input.tap(code);
      });
      top.append(button);
    };
    tapButton('背包', 'KeyI');
    const settings = el('button', 'tw-mobile-small', '设置');
    settings.type = 'button';
    settings.addEventListener('click', () => window.__ui?.togglePanel());
    top.append(settings);
    const menu = el('button', 'tw-mobile-small', '更多');
    menu.type = 'button';
    menu.addEventListener('click', () => openPanel());
    top.append(menu);
    this.root.append(top);
    this.context = el('div', 'tw-mobile-context');
    this.root.append(this.context);
    const lower = el('div', 'tw-mobile-lower');
    const stick = el('div', 'tw-mobile-stick');
    stick.setAttribute('aria-label', '移动摇杆');
    stick.append(el('span', 'tw-mobile-stick-label', '移动'));
    this.knob = el('span', 'tw-mobile-knob');
    stick.append(this.knob);
    lower.append(stick);
    const actions = el('div', 'tw-mobile-actions');
    const makeHold = (label, code, button = null, extraClass = '') => {
      const node = el('button', 'tw-mobile-action ' + extraClass, label);
      node.type = 'button';
      const press = source => {
        if (button !== null) input.setMouse(button, true, source);
        else input.setKey(code, true, source);
        window.__tideApp?.audio?.resume();
      };
      const release = source => {
        if (button !== null) input.setMouse(button, false, source);
        else input.setKey(code, false, source);
      };
      this.bindHold(node, press, release);
      actions.append(node);
    };
    makeHold('互动', 'KeyE', null, 'tw-mobile-primary');
    makeHold('鱼竿', 'KeyR');
    makeHold('抛竿 / 收线', null, 0, 'tw-mobile-fish');
    makeHold('收回鱼线', null, 1);
    makeHold('跳跃 / 上浮', 'Space');
    makeHold('下潜', 'KeyC');
    makeHold('加速', 'ShiftLeft');
    lower.append(actions);
    this.root.append(lower);
    document.body.append(this.root);

    const move = e => {
      if (e.pointerId !== this.movePointer) return;
      e.preventDefault();
      const r = stick.getBoundingClientRect();
      const radius = Math.max(1, r.width / 2 - 23);
      let x = (e.clientX - r.left - r.width / 2) / radius;
      let y = (e.clientY - r.top - r.height / 2) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      this.setMove(x, y);
      this.knob.style.transform = 'translate(' + (x * radius) + 'px,' + (y * radius) + 'px)';
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.input.enabled || this.movePointer !== null) return;
      e.preventDefault();
      this.movePointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.input.requestLock();
      move(e);
    });
    stick.addEventListener('pointermove', move);
    const endMove = e => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.setMove(0, 0);
      this.knob.style.transform = '';
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, endMove);

    canvas.addEventListener('pointerdown', e => {
      if (!input.enabled || this.viewPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      this.viewPointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      input.requestLock();
      window.__tideApp?.audio?.resume();
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== this.viewPointer || !input.enabled) return;
      e.preventDefault();
      input.look.x += (e.clientX - this.lastX) * 1.35;
      input.look.y += (e.clientY - this.lastY) * 1.35;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const endLook = e => { if (e.pointerId === this.viewPointer) this.viewPointer = null; };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endLook);
    this.interval = setInterval(() => this.refresh(), 200);
  }

  bindHold(button, press, release) {
    const active = new Set();
    const end = e => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      release('touch:' + e.pointerId);
      button.classList.toggle('is-down', active.size > 0);
    };
    button.addEventListener('pointerdown', e => {
      if (!this.input.enabled) return;
      e.preventDefault();
      active.add(e.pointerId);
      button.setPointerCapture(e.pointerId);
      button.classList.add('is-down');
      press('touch:' + e.pointerId);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, end);
    this._resets.push(() => {
      for (const id of active) release('touch:' + id);
      active.clear();
      button.classList.remove('is-down');
    });
  }

  setMove(x, y) {
    this.input.setKey('KeyA', x < -0.2, 'stick');
    this.input.setKey('KeyD', x > 0.2, 'stick');
    this.input.setKey('KeyW', y < -0.2, 'stick');
    this.input.setKey('KeyS', y > 0.2, 'stick');
  }

  refresh() {
    const app = window.__tideApp, ui = window.__ui, hud = app?.game?.hud;
    const ready = !!window.__tideReady && !ui?._start;
    this.root.hidden = !ready;
    const blocked = !!(hud?.invOpen || hud?.standOpen || ui?._panelOpen || window.__tidePanelOpen);
    this.root.classList.toggle('tw-mobile-modal', blocked);
    if (blocked !== this.blocked) {
      this.blocked = blocked;
      this.input.enabled = !blocked;
      this.input.reset();
    }
    const prompt = app?.player?.prompt?.text || '';
    this.context.textContent = prompt ? '互动：' + prompt : '';
  }

  reset() {
    this.viewPointer = this.movePointer = null;
    this.knob.style.transform = '';
    for (const reset of this._resets) reset();
  }
}
