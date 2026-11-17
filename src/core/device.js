// What kind of device is this? Phones and tablets get the touch controls and
// have to be held sideways; everything else plays on the keyboard.

/**
 * True on a phone or tablet. `?touch=1` / `?touch=0` in the address forces it
 * either way. A laptop with a touch screen still has a mouse, so it stays a
 * keyboard device.
 */
export function isMobile() {
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS asks for the desktop site and says it is a Mac.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return window.matchMedia?.('(pointer: coarse) and (hover: none)').matches ?? false;
}

const landscapeQuery = () => window.matchMedia?.('(orientation: landscape)');

export function isLandscape() {
  const q = landscapeQuery();
  return q ? q.matches : window.innerWidth >= window.innerHeight;
}

/** Calls `cb(landscape)` whenever the device turns. */
export function onOrientation(cb) {
  let last = isLandscape();
  const check = () => {
    const now = isLandscape();
    if (now !== last) {
      last = now;
      cb(now);
    }
  };
  landscapeQuery()?.addEventListener?.('change', check);
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
}

/**
 * Best effort at keeping the phone sideways: full screen, then an orientation
 * lock. Android browsers allow both from a tap; iPhones allow neither, and the
 * rotate prompt covers that case. Failures are expected and ignored.
 */
export async function tryLockLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* not allowed here */
  }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* not supported */
  }
}
