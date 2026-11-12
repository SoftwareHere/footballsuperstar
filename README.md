# Football Superstar

A 3D football game about 1-on-1s. You line up against an AI rival, an AI
quarterback throws the ball, and you play both sides: receiver when you have
the ball, cornerback when he does. Win games, level up, and build a player who
wins more.

It runs in the browser (Three.js). There are no art or audio files: the field,
players and sounds are all generated in code.

## Play it

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (http://localhost:5173 by default).

To make a static build you can host anywhere:

```bash
npm run build
```

The result is in `dist/`.

## Rules

- **Both ways.** You and your rival trade roles every rep. With the ball you are
  the receiver; without it you are the corner.
- **Scoring.** A completion is a point for the receiver. An incompletion is a
  point for the defender. Possession flips after every point.
- **Game length.** First to 3, 5 or 7. You pick before the game. A coin toss
  decides who gets the ball first.
- **Offense is freestyle.** There are no plays to pick. Run wherever you want
  and press `F` to call for the ball. The QB leads you based on where you are
  heading, so call it as you come out of your break.
- **4-second pressure.** If nobody has called for the ball 4 seconds after the
  snap, the QB throws it anyway, and less accurately.
- **The catch.** A yellow ring marks where the ball is coming down and a white
  ring closes on it as the ball arrives. Be there and press `Space`.
- Interceptions, drops, swats, catches out of bounds and balls that hit the
  turf are all incompletions. The rep ends at the catch.

Your rival pays attention. Run the same kind of route a few times in a row and
he starts sitting on it; the game tells you when he has caught on.

## Controls

The same keys work in both roles, and up-screen is always downfield.

| Action | Keys |
| --- | --- |
| Move | `W` `A` `S` `D` or the arrow keys |
| Sprint (drains your sprint tank) | hold `Shift` |
| Jump: catch on offense, swat or intercept on defense | `Space` |
| Juke / quick break step, left and right | `Q` / `E` |
| Call for the ball (offense) | `F` |
| Snap, ready, next rep | `Space` or `Enter` |
| Camera: follow or broadcast | `C` |
| Pause | `Esc` or `P` |
| Mute | `M` |

Menus work with the arrow keys and `Enter`, or the mouse. On defense you can
move before the snap to set your own cushion, then press `Space` when ready.

## Levelling up

Every game earns XP: some for each point you score, a bonus for winning, and
more for longer games and tougher rivals. Each level gives 4 skill points to
spend on seven stats, all of which matter on both sides of the ball:

| Stat | What it does |
| --- | --- |
| Speed | Top speed |
| Acceleration | How quickly you reach it |
| Agility | Sharper cuts and jukes; tighter coverage |
| Hands | Catches in traffic; breakups and interceptions |
| Jumping | Reach on high balls |
| Strength | Winning contact and contested catches |
| Stamina | A bigger sprint tank that refills faster between reps |

There are eight rivals, from a JV walk-on to an All-Pro. Beating one unlocks
the next, and you can replay earlier ones. Progress is saved in your browser's
local storage; "Reset career" on the main menu clears it.

## Project layout

```
src/
  config.js        field dimensions and tuning constants
  game.js          game loop, match flow, keyboard controller
  core/            input, seeded RNG, vector helpers
  sim/             the football simulation (no rendering, runs in Node)
    athlete.js       movement, stamina, jumping
    qb.js            the AI quarterback and lead-pass solver
    receiverAI.js    the rival on offense
    defenderAI.js    the rival on defense
    catching.js      catch, contest and breakup odds
    rep.js           one rep: presnap -> live -> flight -> done
    match.js         first-to-N scoring and possession
  progression/     XP, levels, rivals, save data
  render/          Three.js scene, field, player models, camera
  ui/              menus and HUD
  audio/           synthesized sound effects
tests/             unit, rules and balance tests
```

## Tests

```bash
npm test
```

This runs the unit tests plus a balance suite that simulates thousands of
AI-vs-AI reps to check that ratings decide who wins, so levelling up really
helps.

There is also a browser smoke test that plays full games through the keyboard
on both offense and defense. It needs [Playwright](https://playwright.dev)
available to Node and the dev server running:

```bash
npm run e2e
```
