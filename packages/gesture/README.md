# cortex-gesture (prototype)

Hands-free and controller input for the browser. Three independent inputs, each
optional, all feeding the same adapters, so any mix (plus the mouse) can run at once:

- **Hands** (the "Iron Man" interaction): MediaPipe Hand Landmarker.
- **Head**: MediaPipe Face Landmarker. Your head is a joystick; your mouth grabs.
- **Game controller**: the Gamepad API, two sticks and triggers.

Each has a recognizer that turns its readings into generic events; an adapter
applies the events to whatever you're controlling.

**The video never leaves the device.** Tracking runs in the browser (WASM/WebGL);
only the model is downloaded, once, and the lab self-hosts even that.

```
webcam → HandTracker → GestureRecognizer → GestureEvent → adapter
                              │                            ├─ cortex-map (createCortexMapAdapter)
                              └─ state → GestureOverlay    ├─ any three.js camera (createOrbitAdapter)
                                                           └─ plain DOM (createDomAdapter)
webcam → FaceTracker → HeadRecognizer ────→ GestureEvent → (same adapters)
Gamepad API ─────────→ GamepadRecognizer ─→ GestureEvent →
```

## Gestures

| Do this | Event | cortex-map |
| --- | --- | --- |
| Point (or any open-ish hand) | `hover` | hover card + highlight |
| Pinch and let go, without moving | `select` | select the node (again within 1.2 s: fly to it) |
| Pinch and move | `panstart` / `pan` / `panend` | grab the table and slide it |
| Pinch with both hands | `twostart` / `transform` / `twoend` | spread = zoom, twist = turn, move = slide |
| Let go mid-move | (momentum) | it glides / spins on; a pinch catches it |
| Pinch a node, hold still ~0.5 s, then drag | `panstart` (`held`) / `pan` / `panend` | pull it out as a floating card; let go to pin it |
| Both hands held still in a cluster, then spread | `twostart` (`held`) / `transform` | pull that cluster apart (`spreadCluster`) |
| Index + middle out in a V, draw a loop | `draw` / `drawend` (`closed`) | light up every node inside |
| Draw with the V from one node to another | `drawend` (a line) | light up the chain between them (`shortestPath`) |
| Make a fist (thumb tucked) and turn it like a knob | `dialstart` / `dial` / `dialend` | scrub back through time (`setTime`); elsewhere a zoom knob |
| A shape you recorded, held ~0.4 s | `pose` | whatever you bound it to |
| Open palm, held still ~0.6 s | `reset` | back to the opening framing (and clears the time cursor, spotlights, spreads) |

Head (`HeadController`):

| Do this | Event | cortex-map |
| --- | --- | --- |
| Turn left / right | `orbit` (yaw) | the view turns with you |
| Tip your head back / down | `orbit` (pitch) | fly up over the top / drop underneath |
| Lean in / back | `orbit` (zoom) | zoom in / out |
| Mouth open, move your head | `panstart` / `pan` / `panend` | grab and drag |
| Hold the crosshair on a node, head still, ~1 s | `select` (look-to-select) | select it |
| Quick mouth open | `select` at the crosshair | select (again: fly to it) |
| Eyebrows up, held 0.7 s | `reset` | back to the opening framing |

It learns your resting pose in the first 0.6 s (`recenter()` to redo it). Steering is
rate control: a deadzone, then speed rises with how far you turn (curve 1.5). Steering
pauses while the mouth is open and briefly after it closes, so grabbing never also
steers. Eyebrows are measured as a rise over your own resting level, because resting
scores differ a lot between faces.

Look-to-select (`dwell: { ms }`, default 1000; `{ ms: 0 }` turns it off) fills a ring round
the crosshair while it rests on one target, and selects once per target: look away and back
to arm it again. Steering, an open mouth or a brow hold pauses it. It needs an adapter that
reports targets (all three built-in ones do).

Controller (`GamepadController`, standard mapping):

| Input | Event | cortex-map |
| --- | --- | --- |
| Left stick | `orbit` (dx, dy) | fly across the map |
| Right stick | `orbit` (yaw, pitch) | turn; up = over the top, down = underneath |
| RT / LT (LB / RB) | `orbit` (zoom) | zoom in / out |
| A | `select` at the crosshair | select (again: fly to it) |
| B | `select` at `NOWHERE` | clear the selection |
| Y or Start | `reset` | back to the opening framing |
| D-pad | `step` | hop to the linked node that way, and fly there |

Radial stick deadzone 0.16 with a 1.7 curve; rumbles on select / reset / hop where the pad can.
A hop goes from the selection (or, with none, the node nearest the middle) along a link, to the
linked node lying most nearly that way on screen (within 70°, nearer and more on-axis wins).

Head **window mode** (`head: { mode: "window" }`): instead of steering, moving your head
(not turning it) shifts the view as if the screen were a window into the scene (`view`
events). Mouth, brows and look-to-select work as in steer mode.

## Custom gestures

`PoseLibrary` learns hand shapes by example: `add(name, landmarks)` for a second or two of
frames, then `recognizer.setPoses(library)`. Matching is nearest-neighbour over a canonical
hand (wrist at the origin, palm-sized, left hands mirrored onto right), not
rotation-invariant (a thumbs down isn't a thumbs up). The built-in shapes are in the library
as negatives, so a custom pose can never steal a pinch, point, V, palm or fist; `clash(name)`
says how much a recording looks like one of them. A pose fires once per hold
(`poseHoldMs`, 380 ms); `setPoses(lib, { quiet: name })` stops a just-recorded pose firing
while the hand is still holding it. `toJSON()` / `load()` to keep them.

## History dial

A fist, turned like a knob: `dialstart`, then `dial` per frame (`delta`, radians, + =
clockwise on screen), `dialend` when the hand opens. It arms after 250 ms of fist and starts
only once it has turned 0.14 rad, so closing your hand never moves anything. On cortex-map
it moves a time cursor across the nodes' `lastSeenAt` span (half a turn = the whole span,
`dialSpan`): nodes last seen after it are ghosted, the ones touched just before it glow,
and a pill says the date. Past the newest is "now" again; reset clears it. Feedback clicks
like a detented knob. Other adapters treat it as a zoom knob.

## Accessibility

- **Point and hold** to select, no pinch (`GestureController` `dwell: { ms }`, off by default).
- **Says what it's on** and what it did: `feedback.announce` (an `Announcer`) writes to a
  polite `aria-live` region for screen readers, and can speak through `speechSynthesis`.
  Off by default.
- `overlay.scale` for a bigger cursor; a steadier filter, bigger drag deadzone and
  firmer pinch are all `RecognizerOptions`. The lab's "Accessible mode" turns all of this on,
  plus bigger hit targets and no glide.
- Head and controller each work alone, so any one can stand in for hands.

## Record and replay

`Recorder` captures the landmark streams (hand points, head readings, pad axes, rounded,
timed by its own clock) from any controller's `onFrame`, never the video. `replay(rec,
sinks, { speed, signal })` plays it back through the real controllers. Recordings are plain
JSON (`parseRecording` checks one): a session to watch again, a bug report, or a test.

## Together, and the phone remote

`Relay` joins a room on a WebSocket relay (the lab's `worker/index.js`: a Durable Object
per room, hibernating, storing nothing). Two uses in the lab:

- **Shared sessions**: each person's hand landmarks (only those, throttled to 20 fps) go to
  the others, where `RemoteHands` runs them through a recogniser of its own and applies the
  gestures to the same adapter, drawing their cursor in their colour with their name. Their
  hover moves only their cursor.
- **Phone remote** (`phone.html`, paired by QR code): a trackpad. One finger moves a cursor,
  tap selects, two fingers drag / pinch / twist, a slider scrubs time (the dial), and
  "tilt to steer" turns the phone's angle into orbit steering. The screen applies its events
  at the phone's cursor and sends back what it's on.

The relay has no auth of its own: anyone with a room name can join. If you deploy the lab,
put it behind Cloudflare Access (or similar).

## Feedback, and running inputs together

- **Target lock**: when the crosshair (head, controller) lands on something, corner brackets
  close round it and its name shows below. The adapter reports what its last hover landed on
  (`GestureAdapter.target()`); cortex-map also glows the node and its links, as on mouse hover.
- **Sounds** (`sound: true` on any controller, or `controller.feedback.sound.enabled`): a soft
  tick on each new target, chirps for select / clear / hop / reset, a low thump for a grab.
  Synthesised with Web Audio, no files. Off by default.
- **Hands and head at once** share one webcam stream (`acquireCamera`, reference-counted): one
  permission prompt, and the camera light goes off when the last one stops. Both models then run
  on every frame, so each gets less of a slow machine.
- **Saying what landed**: the cursor shows a word for a moment when a gesture takes ("select",
  "grab", "zoom · turn", "loop", "dial", a custom pose's name; `flashWord(event)`), and a lost
  hand's cursor fades out where it was instead of vanishing.
- **Resting when nobody's there** (`pace` on `HandTracker` / `FaceTracker`, on by default): every
  video frame while a hand or face is in view; after 2 s with nothing, about 8 checks a second,
  back to full rate as soon as one shows. `tracker.idle` says which. `pace: false` turns it off.
- **Too dark?** `measureLight(video)` gives the picture's mean brightness (0 … 1); under ~0.18
  tracking starts to struggle. The lab uses it to say so.

## The feel (what most demos get wrong)

- **One Euro filter** on the cursor: steady when your hand is still, no lag when it moves fast.
- **Pinch hysteresis**: closes below 0.30 × palm size, opens above 0.45, and each change must hold for 2 frames.
- **A fist is not a pinch**: a pinch needs the index finger reaching out from the palm.
- **Drag deadzone** measured from where the pinch *confirmed*, so the drift of closing your fingers never becomes a drag.
- **Select uses the cursor from just before the pinch closed**, for the same reason.
- **No accidental grabs** after a two-hand gesture: the hand still pinching must let go before it can grab again.
- **Reset needs a still, open palm** held ~0.6 s, never in the first 0.35 s a hand is seen (hands enter the frame open), with a visible progress ring and a cooldown.
- **Active area**: the middle ~72% of the camera frame maps to the whole surface, so you never reach for the edges.
- Dropped frames (under 180 ms) don't end a gesture; a hand gone longer does.

All thresholds are in `RecognizerOptions` (`DEFAULT_OPTIONS`).

## Use

```ts
import { GestureController, createCortexMapAdapter } from "cortex-gesture";

const controller = new GestureController({
  surface: mapWrapperElement,
  adapter: createCortexMapAdapter(() => mapRef.current),
});
await controller.start(); // asks for the camera
```

`createCortexMapAdapter` uses the `CortexMapHandle` input hooks added for this
(`getView`, `nodeAt`, `hover`, `select`, `resetView`). The mouse keeps working
alongside.

## Tests

Unit tests also cover momentum, window mode, drawing (loops vs lines), held grabs, custom
poses (matching, built-in negatives, handedness, clash, quiet), the dial, and record / replay fidelity. e2e adds the map tricks,
custom gestures through the panel, the dial, accessible mode, and record / replay.

- `npm test -w cortex-gesture`: the hand recognizer against synthetic landmark sequences
  (hover, select with drift, hysteresis, pan, dropped frames, two-hand zoom/rotate,
  release-before-regrab, palm reset rules); the head and gamepad recognizers (deadzones,
  direction, rate, mouth tap vs grab, brow reset, face lost mid-grab, button edges); the
  face-matrix reader; the orbit camera's steering (elevation clamp, yaw, zoom); look-to-select
  timing; d-pad hop choice; feedback sounds; and the shared camera's reference count.
- `npm run e2e`: builds `gesture-lab/` and drives all three lab pages headless
  (Chromium + SwiftShader) with scripted ghost hands, head and pad through the real
  recognizers and adapters, checking each gesture lands and moves things the right way;
  plus look-to-select, d-pad hops, and hands + head sharing Chromium's fake webcam.
  `e2e/run.mjs` runs each block in its own process and browser and retries a block once if
  Chromium itself dies. One block: `node gesture-lab/e2e/run.mjs three-dpad`.
- `gesture-lab/e2e/tracker.e2e.mjs` / `face.e2e.mjs`: the real MediaPipe trackers on a
  video of hand / face photos (needs a local video; see the files). The face run checks
  the direction conventions: a face turned to its own right reads + yaw.
