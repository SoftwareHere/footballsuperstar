// On-screen controls for phones and tablets: a joystick under the left thumb,
// the action buttons under the right. They write into the same Input the
// keyboard does, so the game cannot tell them apart.

const STICK_RADIUS = 52; // px the knob can travel from the centre
const DEAD_ZONE = 0.12; // fraction of the radius that counts as "not moving"
const REGRAB = 1.7; // a touch this many radii from the stick grabs it where it is

const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not allowed */
  }
};

// What the Call button does right now, and what it says.
function callFace(s) {
  if (s.phase === 'done') return { text: 'NEXT', off: false };
  if (s.phase === 'presnap') return { text: s.role === 'wr' ? 'SNAP' : 'READY', off: false };
  if (s.role === 'wr' && s.phase === 'live') return { text: 'CALL', off: s.called };
  return { text: 'CALL', off: true };
}

export class TouchControls {
  /**
   * @param root    element to build into (#ui)
   * @param input   the game's Input
   * @param command (name) => void for 'pause' and 'camera'
   */
  constructor(root, input, command) {
    this.input = input;
    this.command = command;
    this.visible = false;
    this.face = '';
    const el = document.createElement('div');
    el.className = 'touchpad';
    el.hidden = true;
    el.innerHTML = `
      <button class="tp-icon tp-pause" data-cmd="pause" aria-label="Pause"><i></i><i></i></button>
      <button class="tp-icon tp-cam" data-cmd="camera" aria-label="Change camera">CAM</button>
      <div class="tp-zone" data-stick><div class="tp-stick"><i class="tp-knob"></i></div></div>
      <div class="tp-buttons">
        <button class="tp-btn tp-call" data-press="call"><b>SNAP</b></button>
        <button class="tp-btn tp-cutl" data-press="jukeL"><span class="tp-arrow l"></span>CUT</button>
        <button class="tp-btn tp-cutr" data-press="jukeR">CUT<span class="tp-arrow r"></span></button>
        <button class="tp-btn tp-sprint" data-hold="sprint">SPRINT</button>
        <button class="tp-btn tp-jump" data-press="action">JUMP</button>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.zone = el.querySelector('[data-stick]');
    this.stick = el.querySelector('.tp-stick');
    this.knob = el.querySelector('.tp-knob');
    this.call = el.querySelector('.tp-call');
    this.callText = this.call.querySelector('b');

    this.stickId = null; // pointer on the joystick
    this.center = null; // where the stick is while held, in px
    this.holds = new Map(); // pointerId -> button held down

    // Long presses must not select text or open a menu.
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.zone.addEventListener('pointermove', (e) => this.stickMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.zone.addEventListener(type, (e) => {
        if (e.pointerId === this.stickId) this.stickUp();
      });
    }

    for (const btn of el.querySelectorAll('button')) {
      btn.tabIndex = -1;
      btn.addEventListener('pointerdown', (e) => this.buttonDown(e, btn));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        btn.addEventListener(type, (e) => this.buttonUp(e));
      }
    }
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.el.hidden = !on;
    if (!on) this.release();
  }

  /** Let go of everything: the stick recentres and held buttons come up. */
  release() {
    this.stickUp();
    for (const btn of this.holds.values()) {
      btn.classList.remove('down');
      if (btn.dataset.hold) this.input.setHeld(btn.dataset.hold, false);
    }
    this.holds.clear();
  }

  /** Keep the Call button's label in step with the rep. */
  update(s) {
    const face = callFace(s);
    const key = `${face.text}:${face.off}`;
    if (key === this.face) return;
    this.face = key;
    this.callText.textContent = face.text;
    this.call.classList.toggle('off', face.off);
  }

  // ---------------------------------------------------------------- stick

  home() {
    const r = this.stick.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  stickDown(e) {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.zone.setPointerCapture?.(e.pointerId);
    const home = this.home();
    // A thumb that lands near the stick takes it where it sits; one that lands
    // further away gets the stick brought to it, so the first touch never
    // means "full speed in some direction".
    const far = Math.hypot(e.clientX - home.x, e.clientY - home.y) > STICK_RADIUS * REGRAB;
    this.center = far ? { x: e.clientX, y: e.clientY } : home;
    if (far) this.stick.style.transform = `translate(${e.clientX - home.x}px, ${e.clientY - home.y}px)`;
    this.stick.classList.add('held');
    this.stickMove(e);
  }

  stickMove(e) {
    if (e.pointerId !== this.stickId || !this.center) return;
    e.preventDefault();
    let dx = e.clientX - this.center.x;
    let dy = e.clientY - this.center.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, len / STICK_RADIUS);
    if (mag < DEAD_ZONE) {
      this.input.setAxis(0, 0, true);
      return;
    }
    // Past the dead zone, throttle runs 0..1 so a gentle push is a jog.
    const t = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    const ux = dx / (len || 1);
    const uy = dy / (len || 1);
    this.input.setAxis(ux * t, uy * t, true); // screen down is +z
  }

  stickUp() {
    this.stickId = null;
    this.center = null;
    this.stick.classList.remove('held');
    this.stick.style.transform = '';
    this.knob.style.transform = '';
    this.input.setAxis(0, 0, false);
  }

  // -------------------------------------------------------------- buttons

  buttonDown(e, btn) {
    e.preventDefault();
    e.stopPropagation();
    btn.setPointerCapture?.(e.pointerId);
    buzz();
    const { cmd, press, hold } = btn.dataset;
    if (cmd) {
      this.command(cmd);
      return;
    }
    this.holds.set(e.pointerId, btn);
    btn.classList.add('down');
    if (press) this.input.press(press);
    if (hold) this.input.setHeld(hold, true);
  }

  buttonUp(e) {
    const btn = this.holds.get(e.pointerId);
    if (!btn) return;
    this.holds.delete(e.pointerId);
    btn.classList.remove('down');
    if (btn.dataset.hold) this.input.setHeld(btn.dataset.hold, false);
  }
}
