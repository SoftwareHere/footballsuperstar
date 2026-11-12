import './ui/styles.css';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

try {
  // Exposed for debugging and the automated smoke test.
  window.__fs = new Game({ canvas, uiRoot });
} catch (err) {
  console.error(err);
  uiRoot.innerHTML = `<div class="screen"><div class="panel"><h2>Could not start</h2>
    <p class="tagline">This game needs WebGL. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration turned on.</p></div></div>`;
}
