# HARPED — Midnight at the Conservatoire

A candlelit, first-person survival-horror recital where **the music is the weapon**.
You stayed late to practise; the Academy's vain gilded pedal harp has rolled out of the
recital hall and is prowling the corridors, hunting for an audience. Hold **PERFORM** and
Huw Boucher's *Fauré Impromptu* swells — the harp *freezes to listen*, too vain to leave
something that gorgeous. Find Skaila Kanga for the tuning key, reach the glowing door,
and gather the mementos along the way.

Pure vanilla HTML5 Canvas raycaster — no build step, no dependencies.

## Play

Open the GitHub Pages URL on any device. Best on an **iPad in landscape** — use Safari's
**Share → Add to Home Screen** for the full-screen experience. Tap **BEGIN THE RECITAL**
to start (the tap also unlocks audio on iOS).

## Develop

`index.html` is a self-contained bundle (CSS, JS, and the recording all inlined) so it runs
from anywhere. Edit the sources — `game.js` (mementos live in the `ARTIFACTS` array at the
top), `style.css`, `template.html` — then run `./build.sh` to regenerate `index.html`.

🎼 Built with love.
