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
 * Keyboard state for the game. `held(name)` is true while a key is down;
 * `take(name)` is true once per press, so one tap is one snap, jump or juke.
 */
export class Input {
  constructor(target = window) {
    this.down = new Set(); // physical key codes
    this.presses = new Set(); // action names waiting to be taken
    this.capture = false; // true during a rep: game keys don't scroll the page
    this.onCommand = null; // (name) => void for pause / camera / mute
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
    for (const code of this.down) if (MAP[code] === name) return true;
    return false;
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
  }
}
