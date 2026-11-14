# Football Superstar

A 3D football game about 1-on-1s. You line up against an AI rival, an AI
quarterback throws the ball, and you play both sides: receiver when you have
the ball, cornerback when he does. Win games, level up, and build a player who
wins more.

It runs in the browser (Three.js). There are no art or audio files: the
stadium, players and sounds are all generated in code. The players are jointed
bodies animated from what they are doing: their feet plant, they lean into
cuts, their hands go to the ball and to each other, and they load their legs
and leave the ground to jump. They fight to stay on their feet through
contact, turn into rag dolls when they lose that fight, and pick themselves
up off the turf afterwards.

## Play it

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (http://localhost:5173 by default).

If the frame rate stays low the game lowers its own picture quality (first
resolution, then shadows). Add `?quality=high` or `?quality=low` to the address
to pin it instead.

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
  and press `Enter` to call for the ball. The QB leads you based on where you
  are heading, so call it as you come out of your break.
- **4-second pressure.** If nobody has called for the ball 4 seconds after the
  snap, the QB throws it anyway, and less accurately.
- **The catch.** A yellow ring marks where the ball is coming down and a white
  ring closes on it as the ball arrives. Be there and press `Space` to go up
  for it. If it is coming down out of reach, `Space` lays you out in a dive
  instead.
- **Tipped balls stay live.** A ball that comes off somebody's hands can pop
  up instead of dying. The ring turns orange and moves to where it is coming
  down, and either player can still catch it.
- **Go up and get it.** A jump is a real one: your player loads his legs
  (his hands are up from the moment you press), leaves the turf off his
  plant foot, pushes off toward the ball and turns his whole body to it,
  then lands and has to gather himself before he can cut again.
- **Finish the catch.** Getting your hands on it is not enough. If the
  defender arrives while you are securing the ball, the hit can jar it loose;
  if you dove for it, you have to hold on when you hit the turf. On defense,
  when you cannot get to the ball, run through the receiver as it arrives.
- **Hands at the line.** Inside arm's reach the hands come up on their own.
  A corner who is squared up in front of the receiver jams him. The hands
  land with a punch that takes a bite out of his speed and rocks his
  balance, then stay on his chest: he can only drive into them at a walk,
  and he has to fight his way to a shoulder to get by. Who gets the better
  of it is strength against strength: a stronger receiver drives through and
  sheds the hands sooner, a much weaker one is stood up at arm's length
  until he does. The jam is at full strength for the first five yards and
  only a hand-check after that. Once the receiver sheds it he has beaten it:
  there is no second jam until there is daylight between them again.
- **Riding him.** A corner who has hold of a receiver keeps it when the
  receiver gets past: his hands go to the hip and the back and he rides him.
  So does a corner who is trailing and runs into him. He does not bounce
  off, he stays on him. Being ridden costs the receiver about a quarter of
  his top speed and half his footwork, and when he tries to pull away the
  corner hangs on and is towed along. It works anywhere on the field. The
  receiver sheds it in time (sooner if he is stronger), and a juke is the
  quickest way out; after that the corner has to hit him again to get his
  hands back on. All hands come off when the ball is in the air.
- **Contact costs speed.** It never hands any out. A receiver who runs into
  a man comes off him slower, sliding past a shoulder; nobody is slung past
  a defender or sent off faster than he was going. On offense, steer for a
  shoulder (a juke as the hands come up helps); on defense, get in front of
  him to jam, and get your body on him to ride.
- **Balance.** Contact takes balance away instead of knocking a man straight
  over. A bump is shrugged off; a hit makes him stumble, arms out, a few
  ragged steps with less speed and less control until he catches himself; a
  hit that takes all of it puts him on the turf. The weaker man loses more,
  the man who brings the hit loses less, and a man in the air has less to
  stand on. Before the catch a man on his feet only ever stumbles. After it,
  a receiver who holds on through a hit can stay up and stumble on, or go
  down with the ball.
- Interceptions, drops, swats, balls jarred loose, catches out of bounds and
  balls that hit the turf are all incompletions. The rep ends when the catch
  is finished.

How a catch was made is called out when it is something special: diving,
one-handed, over the shoulder, a toe-tap on the boundary, a juggling catch off
a tip, or holding on through a hit.

Your rival pays attention. Run the same kind of route a few times in a row and
he starts sitting on it; the game tells you when he has caught on.

## Controls

The same keys work in both roles, and up-screen is always downfield.

| Action | Keys |
| --- | --- |
| Move | `W` `A` `S` `D` or the arrow keys |
| Sprint (drains your sprint tank) | hold `Shift` |
| Play the ball: jump, or dive when it is out of reach | `Space` |
| Juke / quick break step, left and right | `Q` / `E` |
| Call for the ball (offense) | `Enter` |
| Snap, ready, next rep | `Space` |
| Camera: follow, broadcast or cinematic | `C` |
| Pause | `Esc` or `P` |
| Mute | `M` |

Calling for the ball is on `Enter` so your right hand can do it while your left
stays on the movement keys. Menus work with the arrow keys and `Enter`, or the
mouse. On defense you can move before the snap to set your own cushion, then
press `Space` when ready.

There are three cameras. All of them look toward the end zone, so up-screen is
always downfield:

- **Follow** sits behind your player and eases after him.
- **Broadcast** is a high, wide angle of the whole rep.
- **Cinematic** is bolted to your player. It moves exactly as he moves, with
  no lag and no swivel, close over his shoulder on offense and farther back
  on defense so the receiver stays in the picture.

## Levelling up

Every game earns XP: some for each point you score, a bonus for winning, and
more for longer games and tougher rivals. Each level gives 4 skill points to
spend on seven stats, all of which matter on both sides of the ball:

| Stat | What it does |
| --- | --- |
| Speed | Top speed |
| Acceleration | How quickly you reach it |
| Agility | Sharper cuts and jukes; tighter coverage; better balance through contact and quicker to get it back |
| Hands | Catches in traffic; holding on through a hit or the ground; breakups and interceptions |
| Jumping | Reach on high balls |
| Strength | Winning the hand fight, both ways: the jam, the release, and how long a corner can ride you; staying on your feet through a hit, and delivering one; contested catches |
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
    athlete.js       movement, stamina, jumping, diving, balance, going down
    ball.js          the football: flight, tips, deflections
    qb.js            the AI quarterback and lead-pass solver
    receiverAI.js    the rival on offense
    defenderAI.js    the rival on defense
    catching.js      reach, catch types, contest, hit and breakup odds
    rep.js           one rep: presnap -> live -> flight -> done; the hand
                     fight (jam, release, ride) and what a collision does
                     to each man
    match.js         first-to-N scoring and possession
  physics/         the rag doll (no rendering, runs in Node)
    body.js          body dimensions shared by the skeleton and the rag doll
    ragdoll.js       particles, joint limits and stiffness, turf contact
    getup.js         how a man on the turf gets back to his feet
  progression/     XP, levels, rivals, save data
  render/          Three.js scene, sky, stadium, field, effects, camera
    athlete/         the player: skeleton and meshes, inverse kinematics,
                     procedural animation, rag-doll-to-skeleton posing
  ui/              menus and HUD
  audio/           synthesized sound effects
tests/             unit, rules and balance tests
```

## Tests

```bash
npm test
```

This runs the unit tests (rules, catching, contact, the rag doll, getting up,
save data) plus a balance suite that simulates thousands of AI-vs-AI reps to
check that ratings decide who wins, so levelling up really helps.

There is also a browser smoke test that plays full games through the keyboard
on both offense and defense. It needs [Playwright](https://playwright.dev)
available to Node and the dev server running:

```bash
npm run e2e
```
