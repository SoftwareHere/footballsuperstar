const MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'action',
  KeyQ: 'jukeL',
  KeyE: 'jukeR',
  // Calling for the ball lives on the right hand; the left stays on the run.
  Enter: 'call',
  NumpadEnter: 'call',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
};

/**
 * Input state for the game: the keyboard, plus a virtual layer the on-screen
 * touch controls write to. `held(name)` is true while a key or touch button is
 * down; `take(name)` is true once per press, so one tap is one snap, jump or
 * juke. `axis` is the touch joystick: an analog direction, 0..1 long.
 */
export class Input {
  constructor(target = window) {
    this.down = new Set(); // physical key codes
    this.presses = new Set(); // action names waiting to be taken
    this.capture = false; // true during a rep: game keys don't scroll the page
    this.onCommand = null; // (name) => void for pause / camera / mute
    this.virtualHeld = new Set(); // action names held by on-screen buttons
    this.axis = { x: 0, z: 0, active: false }; // the touch joystick
    target.addEventListener('keydown', (e) => this.keydown(e));
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.reset());
  }

  keydown(e) {
    const name = MAP[e.code];
    if (!name || e.ctrlKey || e.metaKey || e.altKey) return;
    if (name === 'pause' || name === 'camera' || name === 'mute') {
      if (!e.repeat && this.onCommand?.(name)) e.preventDefault();
      return;
    }
    if (!this.capture) return;
    e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.presses.add(name);
  }

  held(name) {
    if (this.virtualHeld.has(name)) return true;
    for (const code of this.down) if (MAP[code] === name) return true;
    return false;
  }

  /** A tap on an on-screen button: one press of `name`. */
  press(name) {
    if (this.capture) this.presses.add(name);
  }

  /** An on-screen button held down (sprint) or let go. */
  setHeld(name, on) {
    if (on && this.capture) this.virtualHeld.add(name);
    else this.virtualHeld.delete(name);
  }

  /** The touch joystick. Screen up is -z, the same as the keys. */
  setAxis(x, z, active = true) {
    const on = active && this.capture;
    this.axis.x = on ? x : 0;
    this.axis.z = on ? z : 0;
    this.axis.active = on;
  }

  take(name) {
    return this.presses.delete(name);
  }

  clearPresses() {
    this.presses.clear();
  }

  reset() {
    this.down.clear();
    this.presses.clear();
    this.virtualHeld.clear();
    this.setAxis(0, 0, false);
  }
}
