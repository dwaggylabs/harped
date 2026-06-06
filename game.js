/* ============================================================================
   HARPED — Midnight at the Academy
   A first-person, candlelit love-letter survival-horror recital.
   Vanilla HTML5 Canvas + JS raycasting. No dependencies, no build step.
   Just open index.html.

   THE IDEA: the music is the weapon. Hold SPACE to PERFORM — Huw Boucher's
   Fauré Impromptu swells, and the vain harp FREEZES to listen (it cannot move
   while something that gorgeous is playing). Performing burns PROPRANOLOL
   (your nerve). Find Skaila Kanga — she calls you "dear" and hands you the
   tuning key — then reach the glowing door. Wander to collect mementos.
   ============================================================================ */

/* ============================================================================
   ★★★ YOUR MEMORIES — EDIT THESE! ★★★
   Each entry is a glowing keepsake hidden in the maze. Walk over it to read it.
   `icon` is any single emoji (drawn as the sprite). `title` is the line shown.
   Add/remove freely — the counter and placement adapt automatically.
   (Placeholders marked "(edit me)" are for Rupert to replace with the real ones.)
   ============================================================================ */
const ARTIFACTS = [
  { icon: '🎼', title: '“The Fauré Impromptu — the take that gave you goosebumps.”' },
  { icon: '🎧', title: '“9 March, the Academy: the day Huw recorded it for real.”' },
  { icon: '🐉', title: '“Draggy — keeping watch over the both of you.”' },
  { icon: '☕', title: '(edit me) “the first coffee that ran four hours long.”' },
  { icon: '🎹', title: '(edit me) “the first time you heard Huw play live.”' },
  { icon: '🌙', title: '(edit me) “a late-night walk you both still talk about.”' },
  { icon: '💌', title: '(edit me) “the message that started it all.”' },
  { icon: '🎟️', title: '(edit me) “a ticket stub you couldn’t throw away.”' },
];

/* ============================================================================
   TUNABLE CONSTANTS — tweak to taste.
   ============================================================================ */

// --- Maze (smaller + very open = easier to read and wander) ---
const MAZE_COLS      = 9;
const MAZE_ROWS      = 7;
const EXTRA_OPENINGS = 24;   // lots of loops so it's airy, not a dead-end trap

// --- Render (brighter + see further) ---
const RENDER_W = 800;        // crisper on iPad Pro; ~4:3 to match the screen
const RENDER_H = 600;
const FOV      = 0.66;
const VIEW_FOG = 24;         // how far you can see (bigger = clearer)
const AMBIENT  = 0.50;       // minimum light so the halls are always clearly visible

// --- Player ---
const MOVE_SPEED   = 3.0;
const TURN_SPEED   = 2.9;
const MOUSE_SENS   = 0.0024;
const PLAYER_RADIUS= 0.22;

// --- Difficulty tempos: harp speed (cells/sec) + opening head-start (sec) ---
const DIFFS = {
  lullaby: { harp: 0.55, grace: 4.0 }, // barely chases — pure exploration
  pp:      { harp: 0.95, grace: 2.8 },
  mf:      { harp: 1.35, grace: 2.2 },
  ff:      { harp: 1.95, grace: 1.6 },
};
const CATCH_DIST   = 0.45;
const BFS_INTERVAL = 0.13;

// --- Propranolol (your performing nerve) — generous so it's forgiving ---
const MED_MAX    = 120;
const MED_DRAIN  = 18;       // per second while performing
const MED_REFILL = 16;       // per second while resting

// --- Metronome power-up ---
const METRO_SLOW_FACTOR = 0.3;
const METRO_DURATION    = 9;

// --- Atmosphere ---
const DANGER_DIST = 4.5;     // cells; drone + crimson tint within this
const MUSIC_VOL   = 0.92;    // performing volume for Huw's recording

/* ============================================================================
   DERIVED MAP GRID  (1 = wall, 0 = open)
   ============================================================================ */
const GW = MAZE_COLS * 2 + 1;
const GH = MAZE_ROWS * 2 + 1;
let map, carpetDir;

/* ============================================================================
   CANVAS + DOM
   ============================================================================ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = RENDER_W; canvas.height = RENDER_H;
ctx.imageSmoothingEnabled = false;
const zBuffer = new Float32Array(RENDER_W);
let floorImg = null;            // reusable buffer for world-locked floor casting

const hud         = document.getElementById('hud');
const medBar      = document.getElementById('medBar');
const objectiveEl = document.getElementById('objective');
const memCountEl   = document.getElementById('memCount');
const barkEl      = document.getElementById('bark');
const crosshair   = document.getElementById('crosshair');
const startScreen = document.getElementById('startScreen');
const winScreen   = document.getElementById('winScreen');
const loseScreen  = document.getElementById('loseScreen');
const winText     = document.getElementById('winText');
const loseText    = document.getElementById('loseText');
const touch       = document.getElementById('touch');
const performEl   = document.getElementById('perform'); // Huw's Fauré

/* ============================================================================
   STATE
   ============================================================================ */
let state = 'start';
let difficulty = 'pp';
let harpBaseSpeed = DIFFS.pp.harp;

let player, harp;
let skaila, door, metronome;
let artifacts = [];
let memCollected = 0;
let med = MED_MAX;
let musicVol = 0;            // smoothed volume of Huw's recording
let hasKey = false;
let slowTimer = 0, bfsTimer = 0, graceTimer = 0;
let harpPath = [];
let lastTime = 0, clock = 0, barkTimer = 0, hintTimer = 0;
let wasPlaying = false, outOfMedBarked = false;

const keys = { fwd:false, back:false, left:false, right:false, strafeL:false, strafeR:false, play:false };
// Analog movement from the on-screen joystick (Minecraft-style). -1..1 each.
const tmove = { fwd:0, str:0 };

/* ============================================================================
   MAZE GENERATION — recursive backtracker + extra loops.
   ============================================================================ */
function rand(n) { return Math.floor(Math.random() * n); }

function generateMaze() {
  map = Array.from({ length: GH }, () => Array(GW).fill(1));
  for (let cy = 0; cy < MAZE_ROWS; cy++)
    for (let cx = 0; cx < MAZE_COLS; cx++)
      map[cy*2+1][cx*2+1] = 0;

  const visited = Array.from({ length: MAZE_ROWS }, () => Array(MAZE_COLS).fill(false));
  const stack = [];
  let cx = rand(MAZE_COLS), cy = rand(MAZE_ROWS);
  visited[cy][cx] = true; stack.push([cx, cy]);
  const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];

  while (stack.length) {
    [cx, cy] = stack[stack.length-1];
    const nbrs = [];
    for (const [dx, dy] of DIRS) {
      const nx = cx+dx, ny = cy+dy;
      if (nx>=0&&nx<MAZE_COLS&&ny>=0&&ny<MAZE_ROWS&&!visited[ny][nx]) nbrs.push([nx,ny,dx,dy]);
    }
    if (!nbrs.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nbrs[rand(nbrs.length)];
    map[cy*2+1+dy][cx*2+1+dx] = 0;
    visited[ny][nx] = true; stack.push([nx, ny]);
  }

  let made = 0, tries = 0;
  while (made < EXTRA_OPENINGS && tries < EXTRA_OPENINGS*20) {
    tries++;
    const x = rand(GW), y = rand(GH);
    const isH = (x%2===0 && y%2===1), isV = (x%2===1 && y%2===0);
    if ((isH||isV) && map[y][x]===1 && x>0&&x<GW-1&&y>0&&y<GH-1) { map[y][x]=0; made++; }
  }
  computeCarpet();
}

// Per open cell, which way the carpet runner runs: 1 = N-S, 2 = E-W, 3 = junction
// /room (cross), 0 = none. Lets the floor-caster lay continuous runners that follow
// the corridors and turn corners — all world-locked.
function computeCarpet() {
  carpetDir = Array.from({ length: GH }, () => Array(GW).fill(0));
  for (let y=0; y<GH; y++) for (let x=0; x<GW; x++) {
    if (map[y][x] !== 0) continue;
    const N = y>0 && map[y-1][x]===0, S = y<GH-1 && map[y+1][x]===0;
    const E = x<GW-1 && map[y][x+1]===0, W = x>0 && map[y][x-1]===0;
    const ns = N||S, ew = E||W;
    carpetDir[y][x] = (ns&&ew) ? 3 : ns ? 1 : ew ? 2 : 0;
  }
}

/* ============================================================================
   PLACEMENT
   ============================================================================ */
function cellDist(ax, ay, bx, by) { return Math.abs(ax-bx) + Math.abs(ay-by); }
function randomRoom() { return { cx: rand(MAZE_COLS)*2+1, cy: rand(MAZE_ROWS)*2+1 }; }

function setupEntities() {
  player = { x:1.5, y:1.5, dirX:1, dirY:0, planeX:0, planeY:FOV };
  harp   = { x:GW-1.5, y:GH-1.5, eye:0 };
  door   = { cx:GW-2, cy:GH-2 };

  const used = new Set(['1,1', (GW-2)+','+(GH-2)]);
  do { skaila = randomRoom(); } while (used.has(skaila.cx+','+skaila.cy) || cellDist(skaila.cx,skaila.cy,1,1) < MAZE_COLS);
  skaila.taken = false; used.add(skaila.cx+','+skaila.cy);
  do { metronome = randomRoom(); } while (used.has(metronome.cx+','+metronome.cy));
  metronome.taken = false; used.add(metronome.cx+','+metronome.cy);

  // Scatter mementos in remaining rooms.
  artifacts = [];
  for (const a of ARTIFACTS) {
    let c, guard = 0;
    do { c = randomRoom(); guard++; } while (used.has(c.cx+','+c.cy) && guard < 200);
    used.add(c.cx+','+c.cy);
    artifacts.push({ cx:c.cx, cy:c.cy, taken:false, icon:a.icon, title:a.title, cv:makeArtifactSprite(a.icon) });
  }

  memCollected = 0; med = MED_MAX; musicVol = 0; hasKey = false;
  slowTimer = 0; bfsTimer = 0; graceTimer = DIFFS[difficulty].grace;
  harpPath = []; clock = 0; barkTimer = 0; hintTimer = 7; wasPlaying = false; outOfMedBarked = false;
}

/* ============================================================================
   BFS pathfinding (open cells, harp -> player)
   ============================================================================ */
function bfsNext(sx, sy, gx, gy) {
  if (map[sy][sx] === 1) return [];
  const prev = Array.from({ length: GH }, () => Array(GW).fill(null));
  const seen = Array.from({ length: GH }, () => Array(GW).fill(false));
  const q = [{x:sx,y:sy}]; seen[sy][sx] = true;
  const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];
  let found = false;
  while (q.length) {
    const c = q.shift();
    if (c.x===gx && c.y===gy) { found = true; break; }
    for (const [dx, dy] of DIRS) {
      const nx = c.x+dx, ny = c.y+dy;
      if (nx<0||ny<0||nx>=GW||ny>=GH||seen[ny][nx]||map[ny][nx]===1) continue;
      seen[ny][nx] = true; prev[ny][nx] = c; q.push({x:nx,y:ny});
    }
  }
  if (!found) return [];
  const path = []; let n = {x:gx,y:gy};
  while (n && !(n.x===sx && n.y===sy)) { path.push(n); n = prev[n.y][n.x]; }
  path.reverse(); return path;
}

/* ============================================================================
   AUDIO — Web Audio synth for tension/stings; Huw's recording is the <audio>.
   ============================================================================ */
const Audio = {
  ctx:null, droneOsc:null, droneGain:null, droneLp:null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // Tension "drone" is now a SOFT low pad (triangle through a low-pass), not the
    // old buzzy sawtooth — warm dread instead of a wasp in a jar.
    this.droneOsc = this.ctx.createOscillator();
    this.droneLp  = this.ctx.createBiquadFilter();
    this.droneGain = this.ctx.createGain();
    this.droneLp.type = 'lowpass'; this.droneLp.frequency.value = 420; this.droneLp.Q.value = 0.6;
    this.droneOsc.type = 'triangle'; this.droneOsc.frequency.value = 98;
    this.droneGain.gain.value = 0;
    this.droneOsc.connect(this.droneLp).connect(this.droneGain).connect(this.ctx.destination);
    this.droneOsc.start();
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  // A real plucked-harp voice: bright attack, ringing decay, stacked partials, and a
  // low-pass that closes over the note — the timbre of a plucked string, not a beep.
  harpPluck(freq=440, dur=1.4, vol=0.2) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(Math.min(7200, freq*8), t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(600, freq*2), t0 + dur);
    lp.connect(this.ctx.destination);
    const partials = [[1,1.0],[2,0.5],[3,0.28],[4,0.13]];
    for (const [n, amp] of partials) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = n === 1 ? 'triangle' : 'sine';
      o.frequency.value = freq * n;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol*amp, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur*(1 - 0.1*(n-1)));
      o.connect(g).connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
  },
  // The harp idly arpeggiates as it hunts — a Db-major figure from the Fauré Impromptu.
  _motif: [277.18, 349.23, 415.30, 554.37, 415.30, 349.23], _mi: 0,
  harpHunt(vol) { this.harpPluck(this._motif[this._mi++ % this._motif.length], 1.3, vol); },
  harpRoll(vol=0.18) { // a quick rising flourish (intro / accents)
    [277.18,349.23,415.30,554.37,698.46].forEach((f,i)=>setTimeout(()=>this.harpPluck(f,1.2,vol), i*90));
  },
  // Route Huw's recording through a GainNode. iOS Safari IGNORES <audio>.volume,
  // so the swell only works if we control gain via Web Audio. Call once, post-gesture.
  musicGain:null, mediaSrc:null,
  initMusic(el) {
    if (this.mediaSrc || !this.ctx) return;
    try {
      this.mediaSrc = this.ctx.createMediaElementSource(el);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.mediaSrc.connect(this.musicGain).connect(this.ctx.destination);
    } catch (e) { this.musicGain = null; } // fall back to el.volume off-iOS
  },
  setMusicVol(v) {
    v = Math.max(0, Math.min(1, v));
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    else { try { performEl.volume = v; } catch (e) {} }
  },
  setProximity(t) {
    if (!this.ctx) return;
    // Soft, low, and restrained — atmosphere, never a buzz.
    this.droneGain.gain.setTargetAtTime(Math.min(0.06, t*0.06), this.ctx.currentTime, 0.15);
    this.droneOsc.frequency.setTargetAtTime(92 + t*28, this.ctx.currentTime, 0.15);
  },
  silenceDrone() { if (this.ctx) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); },
  pluck(freq=330, dur=0.5, type='triangle', vol=0.22) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  chime() { [415.30,554.37,698.46,830.61].forEach((f,i)=>setTimeout(()=>this.harpPluck(f,1.1,0.2), i*80)); },
  tick()  { this.pluck(880,0.08,'square',0.16); setTimeout(()=>this.pluck(660,0.08,'square',0.14),120); },
  deathGliss() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(880,t0);
    o.frequency.exponentialRampToValueAtTime(70, t0+1.4);
    g.gain.setValueAtTime(0.3,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+1.6);
    o.connect(g).connect(this.ctx.destination); o.start(t0); o.stop(t0+1.7);
  },
  victoryArp() { [277.18,349.23,415.30,554.37,698.46,830.61,1108.7].forEach((f,i)=>setTimeout(()=>this.harpPluck(f,1.4,0.22), i*100)); },
};

/* ============================================================================
   FLAVOR TEXT — funny, pretend-scary; Skaila always calls you "dear".
   ============================================================================ */
const SKAILA_KEY = [
  'Skaila Kanga: “The tuning key, dear. Now go — and do stand up straight.”',
  'Skaila Kanga: “Take it, dear. I taught that harp everything; sadly, including ambition.”',
  'Skaila Kanga: “The key’s yours, dear. Perform if it nears — vanity roots it to the spot.”',
];
const SKAILA_HINTS = [
  'Skaila Kanga: “It can’t bear silence, dear — but oh, it does love to be adored.”',
  'Skaila Kanga: “When it’s close, perform, dear. It simply cannot leave an audience.”',
  'Skaila Kanga: “Mind your propranolol, dear. No nerve, no nerve.”',
  'Skaila Kanga: “Find the metronome, dear. Even monsters respect a ritardando.”',
  'Skaila Kanga: “I’m the far side of the building, dear. Do hurry — and posture!”',
];
const LOSE_LINES = [
  'The harp embraced you in a sweeping glissando. The reviews were glowing.',
  'Caught. The harp insists this counts as “audience participation.”',
  'It played one perfect arpeggio. The arpeggio was about you.',
  'Skaila Kanga gave you four stars, dear: “Lovely tone, poor survival instincts.”',
  'The harp took a bow. You were the bow.',
];
const WIN_LINES = [
  'Lulled by Huw’s Fauré, the harp finally sleeps. Skaila applauds softly: “Lovely, dear.”',
  'You tuned the door and slipped out. The harp is still waiting for its encore.',
  'Escaped! Skaila blew you a kiss; the harp filed for joint custody of the Fauré.',
  'Free at last, dear. Somewhere behind you, a single string sighs in C minor.',
];
function pick(a) { return a[rand(a.length)]; }
function bark(t, secs=3.2) { barkEl.textContent = t; barkEl.classList.remove('hidden'); barkTimer = secs; }

/* ============================================================================
   SPRITE BITMAPS
   ============================================================================ */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; }

const harpCv   = makeCanvas(96, 140);
const skailaCv = makeCanvas(96, 150);
const metroCv  = makeCanvas(80, 110);
const doorCv   = makeCanvas(100, 150);

// memento sprite from an emoji + soft glow
function makeArtifactSprite(emoji) {
  const c = makeCanvas(72, 72), x = c.getContext('2d');
  const g = x.createRadialGradient(36,36,2, 36,36,34);
  g.addColorStop(0, 'rgba(231,166,196,0.85)');
  g.addColorStop(1, 'rgba(231,166,196,0)');
  x.fillStyle = g; x.beginPath(); x.arc(36,36,34,0,7); x.fill();
  x.font = '40px "Apple Color Emoji","Segoe UI Emoji",serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(emoji, 36, 38);
  return c;
}

function drawHarpSprite(playing, danger) {
  const c = harpCv, x = c.getContext('2d');
  x.clearRect(0,0,c.width,c.height); x.save(); x.translate(48,0);
  if (danger > 0.1) { x.shadowColor = `rgba(192,57,43,${0.5*danger})`; x.shadowBlur = 30; }
  else { x.shadowColor = 'rgba(233,198,107,0.5)'; x.shadowBlur = 12; }
  x.fillStyle = '#6b5524';
  x.beginPath(); x.arc(-22,132,7,0,7); x.fill();
  x.beginPath(); x.arc(20,132,7,0,7); x.fill();
  x.strokeStyle = playing ? '#fff0c0' : '#e9c66b'; x.lineWidth = 11; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(-24,130); x.lineTo(-24,30);
  x.quadraticCurveTo(-24,-2,8,4);
  x.quadraticCurveTo(36,10,30,128); x.lineTo(-24,130);
  x.stroke();
  x.fillStyle = playing ? 'rgba(255,240,192,0.25)' : 'rgba(233,198,107,0.18)'; x.fill();
  x.strokeStyle = playing ? 'rgba(255,255,255,0.9)' : 'rgba(233,198,107,0.55)'; x.lineWidth = 1.4;
  for (let i=0;i<9;i++){ const t=i/8; x.beginPath(); x.moveTo(-18+t*38,6+t*6); x.lineTo(-20+t*46,126); x.stroke(); }
  x.shadowBlur = 0;
  const px = Math.sin(harp.eye)*3.5, py = 2 + Math.cos(harp.eye*1.4)*2.5;
  for (const [ex,ey] of [[-8,48],[12,48]]) {
    x.fillStyle='#fff'; x.beginPath(); x.arc(ex,ey,9,0,7); x.fill();
    x.strokeStyle='#000'; x.lineWidth=1.5; x.stroke();
    x.fillStyle='#000'; x.beginPath(); x.arc(ex+px,ey+py,4,0,7); x.fill();
  }
  x.strokeStyle = playing ? '#fff0c0' : '#5a1410'; x.lineWidth = 2.5; x.beginPath();
  if (playing) x.arc(2,66,8,0.1*Math.PI,0.9*Math.PI);
  else { x.moveTo(-8,66); x.lineTo(-3,70); x.lineTo(2,66); x.lineTo(7,70); x.lineTo(12,66); }
  x.stroke();
  x.restore();
}

(function drawSkaila() {
  const x = skailaCv.getContext('2d'); x.save(); x.translate(48,0);
  x.shadowColor='rgba(233,198,107,0.6)'; x.shadowBlur=16;
  x.fillStyle='#6d2440'; x.beginPath(); x.moveTo(0,50); x.lineTo(-26,144); x.lineTo(26,144); x.closePath(); x.fill();
  x.fillStyle='#8a3055'; x.beginPath(); x.moveTo(0,50); x.lineTo(-10,144); x.lineTo(10,144); x.closePath(); x.fill();
  x.strokeStyle='#e7b89a'; x.lineWidth=7; x.lineCap='round';
  x.beginPath(); x.moveTo(-10,60); x.lineTo(-24,92); x.stroke();
  x.beginPath(); x.moveTo(10,60); x.lineTo(24,92); x.stroke();
  x.fillStyle='#e7b89a'; x.beginPath(); x.arc(0,36,15,0,7); x.fill();
  x.fillStyle='#3a2a22'; x.beginPath(); x.arc(0,30,17,Math.PI,0); x.fill();
  x.fillRect(-17,28,6,26); x.fillRect(11,28,6,26);
  x.shadowBlur=0; x.fillStyle='#2a1a12';
  x.beginPath(); x.arc(-5,36,1.8,0,7); x.fill();
  x.beginPath(); x.arc(5,36,1.8,0,7); x.fill();
  x.strokeStyle='#a0322f'; x.lineWidth=1.6; x.beginPath(); x.arc(0,40,5,0.15*Math.PI,0.85*Math.PI); x.stroke();
  x.strokeStyle='#e9c66b'; x.lineWidth=4; x.shadowColor='rgba(233,198,107,0.6)'; x.shadowBlur=10;
  x.beginPath(); x.moveTo(20,132); x.lineTo(20,96); x.quadraticCurveTo(20,86,40,92); x.lineTo(40,132); x.closePath(); x.stroke();
  x.restore();
})();

(function drawMetro() {
  const x = metroCv.getContext('2d'); x.save(); x.translate(40,0);
  x.shadowColor='rgba(127,227,216,0.8)'; x.shadowBlur=16;
  x.fillStyle='#1c3a38'; x.strokeStyle='#7fe3d8'; x.lineWidth=4;
  x.beginPath(); x.moveTo(0,20); x.lineTo(26,104); x.lineTo(-26,104); x.closePath(); x.fill(); x.stroke();
  x.strokeStyle='#bafff7'; x.lineWidth=3; x.beginPath(); x.moveTo(0,96); x.lineTo(10,30); x.stroke();
  x.fillStyle='#bafff7'; x.beginPath(); x.arc(10,30,5,0,7); x.fill();
  x.restore();
})();

(function drawDoor() {
  const x = doorCv.getContext('2d'); x.save(); x.translate(50,0);
  x.shadowColor='rgba(233,198,107,0.9)'; x.shadowBlur=26;
  x.fillStyle='#3a2c14'; x.strokeStyle='#e9c66b'; x.lineWidth=5;
  x.beginPath(); x.moveTo(-32,148); x.lineTo(-32,30);
  x.quadraticCurveTo(-32,-6,0,-6); x.quadraticCurveTo(32,-6,32,30);
  x.lineTo(32,148); x.closePath(); x.fill(); x.stroke();
  x.fillStyle='#e9c66b'; x.beginPath(); x.arc(20,80,4,0,7); x.fill();
  x.fillStyle='rgba(233,198,107,0.85)'; x.fillRect(-20,8,40,10);
  x.restore();
})();

// Draggy the dragon — companion drawn in the screen corner (screen-space).
function drawDraggy(t) {
  const s = RENDER_H/300;            // scale to render size
  const bx = 46*s, by = RENDER_H - 40*s + Math.sin(t*2.2)*3*s;
  ctx.save(); ctx.translate(bx, by); ctx.scale(s*1.4, s*1.4);
  ctx.fillStyle='#3f9b4f'; ctx.beginPath(); ctx.ellipse(9,5,5,3,0.6,0,7); ctx.fill(); // tail
  ctx.fillStyle='#2e7d3e';
  ctx.beginPath(); ctx.ellipse(-8,-2,4,6,-0.5,0,7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8,-2,4,6,0.5,0,7); ctx.fill();
  ctx.fillStyle='#56c266'; ctx.beginPath(); ctx.arc(0,0,9,0,7); ctx.fill();
  ctx.fillStyle='#cdeeb0'; ctx.beginPath(); ctx.arc(0,2,5.4,0,7); ctx.fill();
  ctx.fillStyle='#cdeeb0';
  ctx.beginPath(); ctx.moveTo(-4,-8); ctx.lineTo(-6,-12); ctx.lineTo(-2,-9); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4,-8); ctx.lineTo(6,-12); ctx.lineTo(2,-9); ctx.fill();
  ctx.fillStyle='#0a0710';
  ctx.beginPath(); ctx.arc(-2.6,-1,1.5,0,7); ctx.fill();
  ctx.beginPath(); ctx.arc(2.6,-1,1.5,0,7); ctx.fill();
  ctx.restore();
}

/* ============================================================================
   GAME FLOW
   ============================================================================ */
function startGame() {
  Audio.init(); Audio.resume(); Audio.initMusic(performEl);
  generateMaze(); setupEntities();
  state = 'play';
  startScreen.classList.add('hidden');
  winScreen.classList.add('hidden');
  loseScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  crosshair.classList.remove('hidden');
  objectiveEl.textContent = 'Find Skaila Kanga for the tuning key, dear…';
  memCountEl.textContent = `Mementos 0/${artifacts.length}`;
  if (isTouch) touch.classList.remove('hidden');
  // Start Huw's recording (silent; swells when you perform).
  try { performEl.currentTime = 0; } catch (e) {}
  Audio.setMusicVol(0); performEl.play().catch(()=>{});
  bark('A harp begins to play somewhere in the dark. It is, annoyingly, gorgeous.', 4);
  Audio.harpRoll(0.16);
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function endGame(won) {
  state = won ? 'win' : 'lose';
  Audio.silenceDrone();
  hud.classList.add('hidden'); crosshair.classList.add('hidden');
  barkEl.classList.add('hidden'); touch.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  if (won) {
    Audio.victoryArp();
    Audio.setMusicVol(0.6); // let the Fauré ring out in triumph
    let line = pick(WIN_LINES);
    if (memCollected === artifacts.length && artifacts.length) line += ` (All ${artifacts.length} mementos found — every one, dear.)`;
    winText.textContent = line;
    winScreen.classList.remove('hidden');
  } else {
    Audio.deathGliss();
    performEl.pause();
    loseText.textContent = pick(LOSE_LINES);
    loseScreen.classList.remove('hidden');
  }
}

/* ============================================================================
   COLLISION + TURN
   ============================================================================ */
function isOpen(x, y) {
  const gx = Math.floor(x), gy = Math.floor(y);
  if (gx<0||gy<0||gx>=GW||gy>=GH) return false;
  return map[gy][gx] === 0;
}
function tryMovePlayer(nx, ny) {
  const r = PLAYER_RADIUS;
  if (isOpen(nx + Math.sign(nx-player.x)*r, player.y) && isOpen(nx, player.y-r) && isOpen(nx, player.y+r)) player.x = nx;
  if (isOpen(player.x, ny + Math.sign(ny-player.y)*r) && isOpen(player.x-r, ny) && isOpen(player.x+r, ny)) player.y = ny;
}
function rotate(a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx=player.dirX, dy=player.dirY, px=player.planeX, py=player.planeY;
  player.dirX = dx*cos - dy*sin;   player.dirY = dx*sin + dy*cos;
  player.planeX = px*cos - py*sin; player.planeY = px*sin + py*cos;
}
function ticked(period) { return Math.floor(clock/period) !== Math.floor((clock-lastDt)/period); }
let lastDt = 0.016;

/* ============================================================================
   UPDATE
   ============================================================================ */
function update(dt) {
  lastDt = dt; clock += dt; harp.eye += dt*3;
  if (barkTimer > 0) { barkTimer -= dt; if (barkTimer <= 0) barkEl.classList.add('hidden'); }

  // Turn & move (keyboard turn keys; joystick gives analog move)
  if (keys.left)  rotate(-TURN_SPEED*dt);
  if (keys.right) rotate( TURN_SPEED*dt);
  let fwd = (keys.fwd?1:0) - (keys.back?1:0) + tmove.fwd;
  let str = (keys.strafeR?1:0) - (keys.strafeL?1:0) + tmove.str;
  fwd = Math.max(-1, Math.min(1, fwd));
  str = Math.max(-1, Math.min(1, str));
  if (Math.abs(fwd) > 0.001 || Math.abs(str) > 0.001) {
    const mv = MOVE_SPEED*dt;
    const plen = Math.hypot(player.planeX, player.planeY) || 1;
    const sx = player.planeX/plen, sy = player.planeY/plen;
    tryMovePlayer(player.x + (player.dirX*fwd + sx*str)*mv, player.y + (player.dirY*fwd + sy*str)*mv);
  }

  // Perform = music swells + harp freezes; costs propranolol
  const playing = keys.play && med > 0;
  if (playing) {
    med = Math.max(0, med - MED_DRAIN*dt);
    if (med === 0 && !outOfMedBarked) { bark('Out of propranolol — hands shaking, dear. Rest a moment!', 2.6); outOfMedBarked = true; }
  } else {
    med = Math.min(MED_MAX, med + MED_REFILL*dt);
    if (med > 12) outOfMedBarked = false;
  }
  // smooth Huw's recording toward target volume
  const targetVol = playing ? MUSIC_VOL : 0;
  musicVol += (targetVol - musicVol) * Math.min(1, dt*4);
  Audio.setMusicVol(musicVol);

  // Metronome slow
  if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - dt);
  const harpSpeed = harpBaseSpeed * (slowTimer > 0 ? METRO_SLOW_FACTOR : 1);

  // Harp AI (frozen while performing or during opening grace)
  if (graceTimer > 0) graceTimer -= dt;
  bfsTimer -= dt;
  const hcx = Math.floor(harp.x), hcy = Math.floor(harp.y);
  const pcx = Math.floor(player.x), pcy = Math.floor(player.y);
  if (bfsTimer <= 0) { harpPath = bfsNext(hcx, hcy, pcx, pcy); bfsTimer = BFS_INTERVAL; }
  const frozen = playing || graceTimer > 0;
  if (!frozen && harpPath.length) {
    const nx = harpPath[0].x + 0.5, ny = harpPath[0].y + 0.5;
    const dx = nx - harp.x, dy = ny - harp.y, d = Math.hypot(dx,dy) || 1, mv = harpSpeed*dt;
    harp.x += (dx/d)*mv; harp.y += (dy/d)*mv;
    if (Math.hypot(nx-harp.x, ny-harp.y) < mv+0.02) harpPath.shift();
  }

  // Proximity / atmosphere
  const dist = Math.hypot(player.x-harp.x, player.y-harp.y);
  const prox = Math.max(0, 1 - dist/DANGER_DIST);
  Audio.setProximity(playing ? prox*0.4 : prox);
  // the harp idly arpeggiates the Fauré as it hunts (creepy-pretty, properly harp-like)
  if (!frozen && prox > 0.22 && ticked(1.0)) Audio.harpHunt(0.16*prox + 0.04);

  // Skaila hint barks (until you've met her)
  if (!skaila.taken) { hintTimer -= dt; if (hintTimer <= 0) { bark(pick(SKAILA_HINTS), 3.4); hintTimer = 12; } }

  // Interactions
  if (!skaila.taken && cellDist(pcx,pcy,skaila.cx,skaila.cy) <= 1) {
    skaila.taken = true; hasKey = true; Audio.chime();
    bark(pick(SKAILA_KEY), 4);
    objectiveEl.textContent = 'Tuning key in hand — reach the glowing door, dear!';
  }
  if (!metronome.taken && cellDist(pcx,pcy,metronome.cx,metronome.cy) === 0) {
    metronome.taken = true; slowTimer = METRO_DURATION; Audio.tick();
    bark('Metronome! The harp slows to a dignified largo, dear. Use it.', 2.6);
  }
  for (const a of artifacts) {
    if (!a.taken && cellDist(pcx,pcy,a.cx,a.cy) === 0) {
      a.taken = true; memCollected++; Audio.harpPluck(880,1.1,0.2);
      memCountEl.textContent = `Mementos ${memCollected}/${artifacts.length}`;
      bark(a.title, 3.6);
    }
  }

  // Win / lose
  if (hasKey && cellDist(pcx,pcy,door.cx,door.cy) === 0) { endGame(true); return; }
  if (dist < CATCH_DIST) { endGame(false); return; }

  // HUD meter
  medBar.style.width = (med/MED_MAX*100) + '%';
  medBar.style.filter = playing ? 'brightness(1.4)' : 'none';
}

/* ============================================================================
   RENDER
   ============================================================================ */
function renderWorld() {
  const candle = 0.93 + 0.07*Math.sin(clock*9) + 0.03*Math.sin(clock*23);

  const HZ = RENDER_H/2;
  // --- ceiling: a warm, dark vault with receding beams ---
  let g = ctx.createLinearGradient(0,0,0,HZ);
  g.addColorStop(0,'#160f1e'); g.addColorStop(1,'#2c2436');
  ctx.fillStyle = g; ctx.fillRect(0,0,RENDER_W,HZ);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  for (let i=1;i<=6;i++){ const yy = HZ - HZ*(i/6)*(i/6); ctx.beginPath(); ctx.moveTo(0,yy); ctx.lineTo(RENDER_W,yy); ctx.stroke(); }
  // --- floor: WORLD-LOCKED parquet + crimson carpet runners (true floor-casting,
  //     so the carpet is part of the ground and stays put as you turn) ---
  if (!floorImg) floorImg = ctx.createImageData(RENDER_W, RENDER_H - HZ);
  const fdata = floorImg.data;
  const posZ = 0.5 * RENDER_H;
  const rdx0 = player.dirX - player.planeX, rdy0 = player.dirY - player.planeY;
  const sxStep = (2*player.planeX) / RENDER_W, syStep = (2*player.planeY) / RENDER_W;
  let o = 0;
  for (let y = HZ; y < RENDER_H; y++) {
    const denom = y - HZ; const rowDist = posZ / (denom <= 0 ? 1e-4 : denom);
    let fx = player.x + rowDist * rdx0;
    let fy = player.y + rowDist * rdy0;
    const stepX = rowDist * sxStep, stepY = rowDist * syStep;
    const sh = Math.max(AMBIENT, 1 - rowDist/VIEW_FOG) * candle;
    for (let x = 0; x < RENDER_W; x++, fx += stepX, fy += stepY) {
      const cx = Math.floor(fx), cy = Math.floor(fy);
      const fracX = fx - cx, fracY = fy - cy;
      let r, gg, b, carpet = false, gold = false;
      if (cx>=0 && cy>=0 && cx<GW && cy<GH) {
        const d = carpetDir[cy][cx];
        const dxc = fracX - 0.5, dyc = fracY - 0.5;
        const ax = dxc>-0.2 && dxc<0.2, ay = dyc>-0.2 && dyc<0.2;
        carpet = d===1 ? ax : d===2 ? ay : d===3 ? (ax||ay) : (ax&&ay);
        if (carpet) {                                  // gilt edge along the runner
          if (d===1 || d===3) gold = Math.abs(Math.abs(dxc)-0.2) < 0.015;
          if (!gold && (d===2 || d===3)) gold = Math.abs(Math.abs(dyc)-0.2) < 0.015;
        }
      }
      if (gold)        { r=210; gg=176; b=104; }
      else if (carpet) { r=122; gg=32;  b=44;  }
      else {                                           // parquet boards
        const board = (Math.floor(fx*2) + Math.floor(fy*2)) & 1;
        if (board) { r=96; gg=70; b=44; } else { r=78; gg=56; b=36; }
      }
      fdata[o++] = r*sh; fdata[o++] = gg*sh; fdata[o++] = b*sh; fdata[o++] = 255;
    }
  }
  ctx.putImageData(floorImg, 0, HZ);

  // --- walls: conservatoire panelling (DDA raycast, then painted in bands) ---
  for (let col=0; col<RENDER_W; col++) {
    const cameraX = 2*col/RENDER_W - 1;
    const rdx = player.dirX + player.planeX*cameraX;
    const rdy = player.dirY + player.planeY*cameraX;
    let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
    const ddx = Math.abs(rdx)<1e-9 ? 1e9 : Math.abs(1/rdx);
    const ddy = Math.abs(rdy)<1e-9 ? 1e9 : Math.abs(1/rdy);
    let stepX, stepY, sideX, sideY;
    if (rdx<0){ stepX=-1; sideX=(player.x-mapX)*ddx; } else { stepX=1; sideX=(mapX+1-player.x)*ddx; }
    if (rdy<0){ stepY=-1; sideY=(player.y-mapY)*ddy; } else { stepY=1; sideY=(mapY+1-player.y)*ddy; }
    let side=0, hit=false, guard=0;
    while (!hit && guard++<256) {
      if (sideX<sideY){ sideX+=ddx; mapX+=stepX; side=0; } else { sideY+=ddy; mapY+=stepY; side=1; }
      if (mapX<0||mapY<0||mapX>=GW||mapY>=GH){ hit=true; break; }
      if (map[mapY][mapX]===1) hit=true;
    }
    const perp = side===0 ? (sideX-ddx) : (sideY-ddy);
    zBuffer[col] = perp;
    const lineH = RENDER_H/Math.max(perp,0.05);
    const top = HZ - lineH/2;                       // float top of the wall column
    const fog = Math.max(0,1 - perp/VIEW_FOG);
    const lum = Math.min(1.05, Math.max(AMBIENT, fog) * candle) * (side===1 ? 0.74 : 1.0);

    // hit coordinate along the wall (0..1) + a stable per-cell hash for features
    let wx = side===0 ? (player.y + perp*rdy) : (player.x + perp*rdx);
    wx -= Math.floor(wx);
    const cellId = ((mapX*73856093) ^ (mapY*19349663)) >>> 0;

    const paint = (fa,fb,r,gg,b) => {
      let ya = top + fa*lineH, yb = top + fb*lineH;
      if (yb<=0 || ya>=RENDER_H || yb<=ya) return;
      if (ya<0) ya=0; if (yb>RENDER_H) yb=RENDER_H;
      ctx.fillStyle = `rgb(${r*lum|0},${gg*lum|0},${b*lum|0})`;
      ctx.fillRect(col, ya|0, 1, Math.ceil(yb-ya));
    };

    const pilaster = (wx < 0.06 || wx > 0.94);       // fluted column at each cell edge
    if (pilaster) {
      paint(0.00,1.00, 150,124,82);
      paint(0.00,0.06, 206,176,118);                 // capital
      paint(0.93,1.00, 66,46,28);                    // plinth
    } else {
      paint(0.00,0.05, 206,176,118);                 // crown moulding
      paint(0.05,0.10, 150,128,92);                  // cornice shadow
      paint(0.10,0.50, 196,178,146);                 // upper plaster
      paint(0.50,0.54, 200,166,98);                  // picture rail
      const seam = Math.abs(wx-0.25)<0.013 || Math.abs(wx-0.5)<0.013 || Math.abs(wx-0.75)<0.013;
      paint(0.54,0.92, seam?80:122, seam?56:86, seam?34:52);   // walnut wainscot + seams
      paint(0.92,1.00, 66,46,28);                    // baseboard
      // a framed portrait on ~1/3 of cells…
      if (cellId % 3 === 0 && wx>0.32 && wx<0.68) {
        if (wx<0.346 || wx>0.654) paint(0.14,0.46, 196,162,96);   // gilt frame sides
        else { paint(0.14,0.17, 196,162,96); paint(0.17,0.43, 54,42,52); paint(0.43,0.46, 196,162,96); }
      }
      // …a warm candle sconce on ~1/3 of the others
      else if (cellId % 3 === 1 && Math.abs(wx-0.5)<0.018) {
        paint(0.20,0.30, 255,206,128);
      }
    }
  }

  // sprites
  const sprites = [];
  sprites.push({ cv:harpCv, x:harp.x, y:harp.y, sw:1.0, sh:1.0, vb:0.18 });
  if (!skaila.taken)    sprites.push({ cv:skailaCv, x:skaila.cx+0.5, y:skaila.cy+0.5, sw:0.85, sh:0.92, vb:0.16 });
  if (!metronome.taken) sprites.push({ cv:metroCv,  x:metronome.cx+0.5, y:metronome.cy+0.5, sw:0.55, sh:0.6, vb:0.42, bob:true });
  for (const a of artifacts) if (!a.taken) sprites.push({ cv:a.cv, x:a.cx+0.5, y:a.cy+0.5, sw:0.45, sh:0.45, vb:0.3, bob:true });
  sprites.push({ cv:doorCv, x:door.cx+0.5, y:door.cy+0.5, sw:1.0, sh:1.05, vb:0.12, dim:!hasKey });

  const dist = Math.hypot(player.x-harp.x, player.y-harp.y);
  drawHarpSprite(keys.play && med>0, Math.max(0,1-dist/DANGER_DIST));

  sprites.sort((a,b)=> ((b.x-player.x)**2+(b.y-player.y)**2) - ((a.x-player.x)**2+(a.y-player.y)**2));
  const invDet = 1/(player.planeX*player.dirY - player.dirX*player.planeY);
  for (const s of sprites) {
    const relX = s.x-player.x, relY = s.y-player.y;
    const tX = invDet*(player.dirY*relX - player.dirX*relY);
    const tY = invDet*(-player.planeY*relX + player.planeX*relY);
    if (tY <= 0.05) continue;
    const screenX = Math.floor((RENDER_W/2)*(1 + tX/tY));
    const spH = Math.abs(Math.floor(RENDER_H/tY))*s.sh;
    const spW = Math.abs(Math.floor(RENDER_H/tY))*s.sw;
    const bob = s.bob ? Math.sin(clock*4 + s.x)*spH*0.05 : 0;
    const vMove = RENDER_H/2 + (RENDER_H/tY)*s.vb;
    const y0 = Math.floor(vMove - spH/2 + bob);
    const startX = Math.floor(screenX - spW/2);
    const texW = s.cv.width, texH = s.cv.height;
    const fog = Math.max(0.15, 1 - tY/(VIEW_FOG+2));
    for (let stripe=startX; stripe<startX+spW; stripe++) {
      if (stripe<0||stripe>=RENDER_W) continue;
      if (tY >= zBuffer[stripe]) continue;
      const texX = Math.min(texW-1, Math.floor((stripe-startX)*texW/spW));
      ctx.globalAlpha = (s.dim?0.55:1)*Math.min(1, fog+0.25);
      ctx.drawImage(s.cv, texX, 0, 1, texH, stripe, y0, 1, spH);
    }
    ctx.globalAlpha = 1;
  }

  // crimson danger vignette
  const danger = Math.max(0,1-dist/DANGER_DIST);
  if (danger > 0.12) {
    const pulse = 0.6 + 0.4*Math.sin(clock*7);
    const v = ctx.createRadialGradient(RENDER_W/2,RENDER_H/2,RENDER_H*0.2, RENDER_W/2,RENDER_H/2,RENDER_H*0.75);
    v.addColorStop(0,'rgba(192,57,43,0)');
    v.addColorStop(1,`rgba(192,57,43,${danger*0.5*pulse})`);
    ctx.fillStyle = v; ctx.fillRect(0,0,RENDER_W,RENDER_H);
  }
  // warm "performing" glow
  if (keys.play && med>0) { ctx.fillStyle='rgba(233,198,107,0.07)'; ctx.fillRect(0,0,RENDER_W,RENDER_H); }

  drawDraggy(clock);
}

/* ============================================================================
   MAIN LOOP
   ============================================================================ */
function loop(now) {
  if (state !== 'play') return;
  const dt = Math.min(0.05, (now-lastTime)/1000);
  lastTime = now;
  update(dt);
  if (state === 'play') renderWorld();
  requestAnimationFrame(loop);
}

/* ============================================================================
   INPUT — keyboard
   ============================================================================ */
const KEYMAP = {
  'w':'fwd','arrowup':'fwd','s':'back','arrowdown':'back',
  'a':'left','arrowleft':'left','d':'right','arrowright':'right',
  'q':'strafeL','e':'strafeR',' ':'play',
};
window.addEventListener('keydown', (e)=>{
  const k = KEYMAP[e.key.toLowerCase()];
  if (k){ keys[k]=true; if (e.key===' '||e.key.startsWith('Arrow')) e.preventDefault(); Audio.resume(); }
});
window.addEventListener('keyup', (e)=>{ const k=KEYMAP[e.key.toLowerCase()]; if (k) keys[k]=false; });

canvas.addEventListener('click', ()=>{ if (state==='play') canvas.requestPointerLock(); });
document.addEventListener('mousemove', (e)=>{ if (state==='play' && document.pointerLockElement===canvas) rotate(e.movementX*MOUSE_SENS); });

/* ============================================================================
   INPUT — touch
   ============================================================================ */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
// CSS keys touch-only hints + the rotate nudge off this class; nothing set it before.
if (isTouch) document.body.classList.add('is-touch');

// PERFORM button (press-and-hold).
function bindHold(el, on, off) {
  const s=(e)=>{ e.preventDefault(); Audio.resume(); on(); };
  const f=(e)=>{ e.preventDefault(); off(); };
  el.addEventListener('touchstart',s,{passive:false});
  el.addEventListener('touchend',f,{passive:false});
  el.addEventListener('touchcancel',f,{passive:false});
  el.addEventListener('mousedown',s); el.addEventListener('mouseup',f); el.addEventListener('mouseleave',f);
}
bindHold(document.getElementById('playBtn'), ()=>keys.play=true, ()=>keys.play=false);

/* Minecraft-style touch: a LEFT thumbstick moves/strafes; dragging anywhere else
   looks (turns). Touches are tracked by identifier so you can move and look at the
   same time. */
const joyBase = document.getElementById('joyBase');
const joyKnob = document.getElementById('joyKnob');
const stageEl = document.getElementById('stage');
const TOUCH_LOOK_SENS = 0.0052;
let joyId = null, joyCX = 0, joyCY = 0, joyR = 60;
let lookId = null, lookLastX = 0;

function setJoy(cx, cy) {
  let dx = cx - joyCX, dy = cy - joyCY;
  const len = Math.hypot(dx, dy) || 1;
  const cl = Math.min(len, joyR) / joyR;            // clamped 0..1 magnitude
  const nx = dx/len, ny = dy/len;
  tmove.str =  nx * cl;
  tmove.fwd = -ny * cl;                             // pushing up = forward
  const kpx = cl * (joyR - 34);                     // keep the knob inside the base
  joyKnob.style.transform = `translate(${(nx*kpx)|0}px, ${(ny*kpx)|0}px)`;
}
function releaseJoy() { tmove.fwd = 0; tmove.str = 0; joyKnob.style.transform = 'translate(0px,0px)'; }
function nearJoy(t) {
  const r = joyBase.getBoundingClientRect();
  if (t.clientX >= r.left-24 && t.clientX <= r.right+24 && t.clientY >= r.top-24 && t.clientY <= r.bottom+24) return r;
  return null;
}
stageEl.addEventListener('touchstart', (e)=>{
  Audio.resume();
  for (const t of e.changedTouches) {
    if (t.target && t.target.closest && t.target.closest('#playBtn')) continue; // button handles itself
    const r = nearJoy(t);
    if (r && joyId === null) {
      joyId = t.identifier; joyCX = r.left + r.width/2; joyCY = r.top + r.height/2; joyR = r.width/2;
      setJoy(t.clientX, t.clientY);
    } else if (lookId === null) {
      lookId = t.identifier; lookLastX = t.clientX;
    }
  }
  if (state === 'play') e.preventDefault();
}, {passive:false});
stageEl.addEventListener('touchmove', (e)=>{
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) setJoy(t.clientX, t.clientY);
    else if (t.identifier === lookId) {
      if (state === 'play') rotate((t.clientX - lookLastX) * TOUCH_LOOK_SENS);
      lookLastX = t.clientX;
    }
  }
  if (state === 'play') e.preventDefault();
}, {passive:false});
function endTouches(e){
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) { joyId = null; releaseJoy(); }
    else if (t.identifier === lookId) lookId = null;
  }
}
stageEl.addEventListener('touchend', endTouches, {passive:false});
stageEl.addEventListener('touchcancel', endTouches, {passive:false});

/* ============================================================================
   INPUT — UI
   ============================================================================ */
document.querySelectorAll('.diff').forEach((btn)=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.diff').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    difficulty = btn.dataset.diff;
    harpBaseSpeed = (DIFFS[difficulty] || DIFFS.pp).harp;
  });
});
document.getElementById('startBtn').addEventListener('click', startGame);
document.querySelectorAll('.restart').forEach((b)=> b.addEventListener('click', startGame));

/* ============================================================================
   INIT — faint frame behind the start screen.
   ============================================================================ */
generateMaze(); setupEntities();
drawHarpSprite(false, 0);
renderWorld();
