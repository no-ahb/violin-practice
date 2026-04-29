// Violin Practice PWA — single-file app logic.
// Keeps state in IndexedDB, synthesizes audio with Web Audio, renders notation with VexFlow.

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

// ---------- Constants ----------
const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const NOTE_TO_PC = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
const TONICS_CYCLE = [
  {label:'G',   minor:'G',  major:'G'},
  {label:'D',   minor:'D',  major:'D'},
  {label:'A',   minor:'A',  major:'A'},
  {label:'E',   minor:'E',  major:'E'},
  {label:'B',   minor:'B',  major:'B'},
  {label:'F#/Gb', minor:'F#', major:'Gb'},
  {label:'C#/Db', minor:'C#', major:'Db'},
  {label:'G#/Ab', minor:'G#', major:'Ab'},
  {label:'D#/Eb', minor:'D#', major:'Eb'},
  {label:'Bb',  minor:'Bb', major:'Bb'},
  {label:'F',   minor:'F',  major:'F'},
  {label:'C',   minor:'C',  major:'C'},
];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PALETTE = [
  '#c6442b', // saturated red-orange
  '#2f6b3b', // deep green
  '#244a9a', // saturated blue
  '#d98f28', // orange
  '#6b2f6a', // purple
  '#7a4a1f', // brown
  '#b8a02a', // ochre yellow
  '#186a6a', // teal
  '#a42453', // magenta-red
  '#3a6e2f', // olive green
];

// Scale intervals (semitones from tonic)
const SCALE = {
  major:    [0,2,4,5,7,9,11],
  natural:  [0,2,3,5,7,8,10],
  harmonic: [0,2,3,5,7,8,11],
  melodic:  [0,2,3,5,7,9,11],
  ionian:   [0,2,4,5,7,9,11],
  dorian:   [0,2,3,5,7,9,10],
  phrygian: [0,1,3,5,7,8,10],
  lydian:   [0,2,4,6,7,9,11],
  mixolydian:[0,2,4,5,7,9,10],
  aeolian:  [0,2,3,5,7,8,10],
  locrian:  [0,1,3,5,6,8,10],
  phrygDom: [0,1,4,5,7,8,10],
};

const MODE_INFO = {
  dorian:    { charDeg:'M6 above tonic', charIdx:5, cell:[0,7,9,7,3], tonic:'i', chChord:'IV maj', chIntv:[5,9,12] },
  phrygian:  { charDeg:'m2 above tonic', charIdx:1, cell:[0,1,0,1,3,1], tonic:'i', chChord:'bII maj', chIntv:[1,5,8] },
  lydian:    { charDeg:'#4 above tonic', charIdx:3, cell:[0,4,6,7], tonic:'I', chChord:'II maj', chIntv:[2,6,9] },
  mixolydian:{ charDeg:'b7 above tonic', charIdx:6, cell:[0,10,0,7,10,12], tonic:'I', chChord:'bVII maj', chIntv:[10,14,17] },
  aeolian:   { charDeg:'b6 above tonic', charIdx:5, cell:[0,8,7,5,8,7], tonic:'i', chChord:'iv min', chIntv:[5,8,12] },
  locrian:   { charDeg:'b5 above tonic', charIdx:4, cell:[0,6,0,1,6], tonic:'i°', chChord:'(tritone is the color)', chIntv:[0,3,6] },
  ionian:    { charDeg:'(reference)', charIdx:-1, cell:[0,4,7], tonic:'I', chChord:'(reference)', chIntv:[0,4,7] },
};

// Day-of-week scale form (0=Sun..6=Sat). Practice days Mon-Fri (1..5).
function dayScaleForm(dow, minor) {
  if (!minor) return 'major'; // major week
  if (dow === 2) return 'harmonic'; // Tue
  if (dow === 4) return 'melodic';  // Thu
  return 'melmix'; // Mon, Wed, Fri — melodic asc / natural desc
}
function droneDegree(dow, minor) {
  // returns semitone offset from tonic
  switch (dow) {
    case 1: return 0;                      // tonic
    case 2: return minor ? 11 : 4;         // raised 7 (B natural over G minor => offset 11 above G); 3rd for major
    case 3: return 7;                      // 5th
    case 4: return minor ? 10 : 11;        // b7 minor / maj7 major
    case 5: return minor ? 8 : 9;          // b6 minor / 6 major
    default: return 0;
  }
}
function dayBowing(dow) {
  return ['free/choice','sustained','detaché','slurred 4','slurred 8','free/choice','free/choice'][dow] || 'sustained';
}
// Default subdivision suggestion for each bowing — the "how many notes per bow"
// question from session-1. Tempo-dependent in reality; these are reasonable
// defaults at the practice tempo (60–80 bpm). Player can deviate and note it.
function dayBowingDetail(dow) {
  return [
    'your choice — note what you played',
    'long bow · half notes · 1 per stroke',     // Mon sustained
    '♩ quarter notes · 1 per bow',              // Tue detaché
    '♫ eighth notes · 4 per bow (1 beat per slur)',   // Wed slurred 4
    '♬ sixteenth notes · 8 per bow (2 beats per slur)', // Thu slurred 8
    'your choice — note what you played',       // Fri free
    'your choice', 'your choice'
  ][dow] || '';
}
function dayModalFocus(dow, minor) {
  // Week 1 (minor): Mon G dorian, Tue C dorian, Wed G phrygian, Thu D phrygian, Fri G locrian
  // Week 2 (major): Mon G lydian, Tue C lydian, Wed G mixolydian, Thu D mixolydian, Fri G aeolian
  if (minor) {
    if (dow===1) return {mode:'dorian', shift:0};
    if (dow===2) return {mode:'dorian', shift:5}; // 4th above (C = P4 above G)
    if (dow===3) return {mode:'phrygian', shift:0};
    if (dow===4) return {mode:'phrygian', shift:7}; // 5th above (D)
    if (dow===5) return {mode:'locrian', shift:0};
  } else {
    if (dow===1) return {mode:'lydian', shift:0};
    if (dow===2) return {mode:'lydian', shift:5};
    if (dow===3) return {mode:'mixolydian', shift:0};
    if (dow===4) return {mode:'mixolydian', shift:7};
    if (dow===5) return {mode:'aeolian', shift:0};
  }
  return {mode:'dorian', shift:0};
}
function dayChordProgression(dow, minor, tonicPc) {
  // Returns {label, bars: [{chord, scale, roots, label, scaleName, scaleNotes}]}
  const T = tonicPc;
  const mkChord = (rootPc, quality, tones) => ({rootPc, quality, tones});
  const mkScale = (rootPc, type, name) => {
    const ints = SCALE[type];
    const notes = ints.map(i => NOTE_NAMES[(rootPc+i)%12]);
    return {rootPc, type, name, notes};
  };
  if (minor) {
    if (dow===1) return {label:'ii-V-i (functional)', bars:[
      {chord:`${NOTE_NAMES[(T+9)%12]}m7♭5`, root:(T+9)%12, tones:[0,3,6,10], scale:mkScale((T+9)%12,'locrian','locrian'), roman:'iiø7'},
      {chord:`${NOTE_NAMES[(T+2)%12]}7 (phryg-dom)`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'phrygDom','phrygian dominant'), roman:'V7♭9'},
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian'), roman:'i7'},
    ]};
    if (dow===2) return {label:'Extended functional', bars:[
      {chord:`${NOTE_NAMES[(T+5)%12]}m7`, root:(T+5)%12, tones:[0,3,7,10], scale:mkScale((T+5)%12,'dorian','dorian'), roman:'iv7'},
      {chord:`${NOTE_NAMES[(T+9)%12]}m7♭5`, root:(T+9)%12, tones:[0,3,6,10], scale:mkScale((T+9)%12,'locrian','locrian'), roman:'iiø7'},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'phrygDom','phrygian dominant'), roman:'V7♭9'},
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian'), roman:'i7'},
    ]};
    if (dow===3) return {label:'Modal vamp — Gm7 (dorian)', bars:[
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian'), roman:'i7 · dorian'},
    ]};
    if (dow===4) return {label:'Modal vamp — Gm7♭9 (phrygian)', bars:[
      {chord:`${NOTE_NAMES[T]}m7♭9`, root:T, tones:[0,3,7,10,13], scale:mkScale(T,'phrygian','phrygian'), roman:'i7♭9 · phrygian'},
    ]};
    if (dow===5) return {label:'Modal vamp — Gmaj7#11 (lydian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7#11`, root:T, tones:[0,4,7,11,6], scale:mkScale(T,'lydian','lydian'), roman:'Imaj7#11 · lydian'},
    ]};
  } else {
    if (dow===1) return {label:'ii-V-I (functional)', bars:[
      {chord:`${NOTE_NAMES[(T+9)%12]}m7`, root:(T+9)%12, tones:[0,3,7,10], scale:mkScale((T+9)%12,'dorian','dorian'), roman:'iim7'},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'mixolydian','mixolydian'), roman:'V7'},
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian'), roman:'Imaj7'},
    ]};
    if (dow===2) return {label:'Extended functional', bars:[
      {chord:`${NOTE_NAMES[(T+4)%12]}m7`, root:(T+4)%12, tones:[0,3,7,10], scale:mkScale((T+4)%12,'phrygian','phrygian'), roman:'iiim7'},
      {chord:`${NOTE_NAMES[(T+9)%12]}m7`, root:(T+9)%12, tones:[0,3,7,10], scale:mkScale((T+9)%12,'aeolian','aeolian'), roman:'vim7'},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'mixolydian','mixolydian'), roman:'V7'},
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian'), roman:'Imaj7'},
    ]};
    if (dow===3) return {label:'Modal vamp — maj7 (ionian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian'), roman:'Imaj7 · ionian'},
    ]};
    if (dow===4) return {label:'Modal vamp — maj7#11 (lydian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7#11`, root:T, tones:[0,4,7,11,6], scale:mkScale(T,'lydian','lydian'), roman:'Imaj7#11 · lydian'},
    ]};
    if (dow===5) return {label:'Modal vamp — 7 (mixolydian)', bars:[
      {chord:`${NOTE_NAMES[T]}7`, root:T, tones:[0,4,7,10], scale:mkScale(T,'mixolydian','mixolydian'), roman:'I7 · mixolydian'},
    ]};
  }
  return {label:'Rest', bars:[]};
}

function isoDate(d=new Date()){ return d.toISOString().slice(0,10); }
function todayDow(){ return new Date().getDay(); }
function daysBetween(a,b){ return Math.floor((new Date(b) - new Date(a)) / 86400000); }

// ---------- IndexedDB wrapper ----------
const DB_NAME = 'practice';
const DB_VERSION = 1;
let _db;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', {keyPath:'id'});
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', {keyPath:'id'});
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', {keyPath:'id'}); // chunk notes per piece
      if (!db.objectStoreNames.contains('patches')) db.createObjectStore('patches', {keyPath:'id', autoIncrement:true});
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}
function tx(store, mode='readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function idbGet(store, key){ return tx(store).then(s=>new Promise((r,e)=>{ const q=s.get(key); q.onsuccess=()=>r(q.result); q.onerror=()=>e(q.error); })); }
function idbSet(store, key, val){ return tx(store,'readwrite').then(s=>new Promise((r,e)=>{ const q = (s.keyPath ? s.put(val) : s.put(val,key)); q.onsuccess=()=>r(); q.onerror=()=>e(q.error); })); }
function idbAll(store){ return tx(store).then(s=>new Promise((r,e)=>{ const q=s.getAll(); q.onsuccess=()=>r(q.result||[]); q.onerror=()=>e(q.error); })); }
function idbDel(store, key){ return tx(store,'readwrite').then(s=>new Promise((r,e)=>{ const q=s.delete(key); q.onsuccess=()=>r(); q.onerror=()=>e(q.error); })); }
function kvGet(k){ return idbGet('kv', k); }
function kvSet(k,v){ return idbSet('kv', k, v); }

// ---------- Action log ----------
const LOG_BUFFER = [];
let LOG_FLUSH_T = null;
function logEvent(action, data) {
  const entry = { t: Date.now(), iso: new Date().toISOString(), screen: CURRENT_SCREEN, action, data: data ?? null };
  LOG_BUFFER.push(entry);
  try { console.log('[log]', action, data ?? ''); } catch(e){}
  clearTimeout(LOG_FLUSH_T);
  LOG_FLUSH_T = setTimeout(flushLogs, 800);
}
async function flushLogs() {
  if (!LOG_BUFFER.length) return;
  const existing = (await kvGet('logs')) || [];
  const merged = existing.concat(LOG_BUFFER.splice(0));
  // cap
  const trimmed = merged.slice(-2000);
  await kvSet('logs', trimmed);
}
let CURRENT_SCREEN = 'boot';

// ---------- Settings & state ----------
const defaultSettings = {
  startDate: isoDate(),
  performanceDate: '2026-05-17',
  referencePitch: 440,
  temperament: 'ji',
  handedness: 'right',
  droneSound: 'tanpura',
  metronomeSound: 'wood',
  piece1: { name:'Adagio', totalMeasures:30, chunkSize:4, currentStart:1, referenceDrone:'G' },
  piece2: { name:'Fuga',   totalMeasures:80, chunkSize:6, voices:3, currentStart:1, referenceDrone:'G' },
  currentPatchId: null,
  streakRule: 'weeks5',
  onboarded: false,
  volumes: { drone: 0.5, metro: 0.7, app: 1.0 },
  drone_on: true, metro_on: false,
  acousticConstraints: [
    'One pitch only, 15 min (Lucier-style)',
    'Sul pont / noise only, no pitched material',
    'Left hand only — pizz, tapping, hammer-ons',
    'Modal work in the week\'s mode',
    'Single bow length — one down-bow stretched 30 sec',
    'Silence-first — sound only when inevitable',
  ],
  acousticIdx: 0,
  vampRotationIdx: {}, // per tonic
  tempoPerKey: {}, // {"Gm": 72, "Gmaj": ...}
  tempoPerMode: {},
  cleanRunsAtTempo: {},
};
let SETTINGS = JSON.parse(JSON.stringify(defaultSettings));
let SESSION = null; // in-progress session object
let AUDIO = null;   // audio engine

// ---------- Audio engine ----------
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.droneGain = null;
    this.droneNode = null;
    this.metroGain = null;
    this.chordGain = null;
    this.metroTimer = null;
    this.metroBpm = 72;
    this.metroPlaying = false;
    this.droneBuffers = {}; // per tonic semitone
  }
  async ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = SETTINGS.volumes.app; this.master.connect(this.ctx.destination);
    this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = SETTINGS.volumes.drone; this.droneGain.connect(this.master);
    this.metroGain = this.ctx.createGain(); this.metroGain.gain.value = SETTINGS.volumes.metro; this.metroGain.connect(this.master);
    this.chordGain = this.ctx.createGain(); this.chordGain.gain.value = SETTINGS.volumes.app; this.chordGain.connect(this.master);
  }
  async resume() { await this.ensure(); if (this.ctx.state !== 'running') await this.ctx.resume(); }
  setVolume(kind, v) {
    SETTINGS.volumes[kind] = v; kvSet('settings', SETTINGS);
    if (!this.ctx) return;
    if (kind==='drone' && this.droneGain) this.droneGain.gain.value = v;
    if (kind==='metro' && this.metroGain) this.metroGain.gain.value = v;
    if (kind==='app' && this.master) this.master.gain.value = v;
  }

  // --- Drone: render an ~8 sec loop buffer for tonic semitone (relative to A=ref)
  async getDroneBuffer(pcOrFreq) {
    await this.ensure();
    const key = typeof pcOrFreq === 'number' ? pcOrFreq.toString() : 'f';
    if (this.droneBuffers[key]) return this.droneBuffers[key];
    const sr = this.ctx.sampleRate;
    const seconds = 8;
    const off = new OfflineAudioContext(1, sr*seconds, sr);
    const fund = typeof pcOrFreq === 'number' ? this.pcToFreq(pcOrFreq, 3) : pcOrFreq; // octave 3 (low)
    const sound = SETTINGS.droneSound;
    // Partial ratios (JI)
    const ji = [1, 2, 3, 4, 5, 6, 7, 8];
    const amps = sound==='shruti' ? [1.0, 0.55, 0.75, 0.35, 0.28, 0.18, 0.08, 0.06] :
                 sound==='sine'   ? [1.0, 0.2, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0] :
                 sound==='pad'    ? [1.0, 0.45, 0.25, 0.5, 0.18, 0.09, 0.0, 0.04] :
                                    [1.0, 0.6, 0.9, 0.4, 0.35, 0.15, 0.12, 0.07]; // tanpura default
    // Mix tonic + fifth + octave like a tanpura (Sa-Pa-Sa-Sa')
    const bodies = sound==='sine' ? [[fund,1.0]] :
                   sound==='pad'  ? [[fund,1.0],[fund*1.5,0.5],[fund*2,0.6]] :
                                    [[fund,1.0],[fund*1.5,0.7],[fund*2,0.7],[fund*2,0.5]];
    const masterGain = off.createGain(); masterGain.gain.value = sound==='sine'?0.25:0.18; masterGain.connect(off.destination);
    // Slow pluck-like envelope cycle ~2s per body staggered
    bodies.forEach((b) => {
      const [freq, g0] = b;
      const bus = off.createGain();
      // Steady, constant drone: smooth fade-in only at the loop seam
      bus.gain.setValueAtTime(0.0001, 0);
      bus.gain.linearRampToValueAtTime(g0*0.45, 0.4);
      bus.gain.setValueAtTime(g0*0.45, seconds-0.4);
      bus.gain.linearRampToValueAtTime(0.0001, seconds);
      bus.connect(masterGain);
      ji.forEach((r, i) => {
        const osc = off.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * r;
        const og = off.createGain();
        og.gain.value = amps[i]*0.5;
        osc.connect(og).connect(bus);
        osc.start(); osc.stop(seconds);
      });
    });
    const buf = await off.startRendering();
    this.droneBuffers[key] = buf;
    return buf;
  }
  pcToFreq(pc, octave=4) {
    // MIDI: A4 = ref
    // pc is 0..11 with C=0
    const midi = 12*(octave+1) + pc;
    const a4Midi = 69;
    return SETTINGS.referencePitch * Math.pow(2, (midi - a4Midi)/12);
  }
  async startDrone(pc) {
    await this.resume();
    this.stopDrone();
    // Real-time, constant drone — sustained, non-pulsing.
    const fund = this.pcToFreq(pc, 3);
    const sound = SETTINGS.droneSound;
    const ji = [1, 2, 3, 4, 5, 6, 7, 8];
    const amps = sound==='shruti' ? [1.0, 0.55, 0.75, 0.35, 0.28, 0.18, 0.08, 0.06] :
                 sound==='sine'   ? [1.0, 0.2, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0] :
                 sound==='pad'    ? [1.0, 0.45, 0.25, 0.5, 0.18, 0.09, 0.0, 0.04] :
                                    [1.0, 0.6, 0.9, 0.4, 0.35, 0.15, 0.12, 0.07];
    const bodies = sound==='sine' ? [[fund,1.0]] :
                   sound==='pad'  ? [[fund,1.0],[fund*1.5,0.5],[fund*2,0.6]] :
                                    [[fund,1.0],[fund*1.5,0.7],[fund*2,0.7]];
    const masterScale = sound==='sine' ? 0.25 : 0.18;
    const root = this.ctx.createGain();
    root.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    root.gain.linearRampToValueAtTime(masterScale, this.ctx.currentTime + 0.8);
    root.connect(this.droneGain);
    const oscs = [];
    bodies.forEach(([freq, g0]) => {
      const bus = this.ctx.createGain(); bus.gain.value = g0 * 0.45;
      bus.connect(root);
      ji.forEach((r, i) => {
        if (!amps[i]) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * r;
        const og = this.ctx.createGain();
        og.gain.value = amps[i] * 0.5;
        osc.connect(og).connect(bus);
        osc.start();
        oscs.push(osc);
      });
    });
    this.droneNode = { oscs, root };
    this.currentDronePc = pc;
  }
  // Stop the active drone with a configurable fade. Ramps the per-drone
  // `root` bus to silence (NOT the master `droneGain` — touching that here
  // caused a glitch where droneGain was instantly restored while the
  // oscillators were still sounding through their own ramping bus).
  stopDrone(fadeMs = 150) {
    if (!this.droneNode || !this.ctx) return;
    const node = this.droneNode;
    this.droneNode = null;
    this.currentDronePc = null;
    try {
      const now = this.ctx.currentTime;
      const fadeS = Math.max(0.01, fadeMs / 1000);
      node.root.gain.cancelScheduledValues(now);
      node.root.gain.setValueAtTime(node.root.gain.value, now);
      node.root.gain.linearRampToValueAtTime(0.0001, now + fadeS);
      setTimeout(()=>{ node.oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch(e){} }); try { node.root.disconnect(); } catch(e){} }, fadeMs + 30);
    } catch(e){}
  }
  // Slower fade-out (used on block transitions and toggle-off). Same path as
  // stopDrone, just a longer ramp so the drop isn't abrupt.
  fadeDrone(ms = 800) { this.stopDrone(ms); }

  // --- Metronome
  async startMetronome(bpm, accentEvery=0) {
    await this.resume();
    this.metroBpm = bpm;
    document.documentElement.style.setProperty('--metro-period', (60/bpm) + 's');
    // If already running, just retune; don't spawn a second tick loop.
    if (this.metroPlaying) return;
    this.metroPlaying = true;
    if (!this.ctx) return;
    const ctx = this.ctx;
    let next = ctx.currentTime + 0.05;
    let beat = 0;
    const tick = () => {
      if (!this.metroPlaying) return;
      const spb = 60 / this.metroBpm;
      while (next < ctx.currentTime + 0.15) {
        this.clickAt(next, accentEvery && beat%accentEvery===0);
        next += spb; beat++;
      }
      this.metroTimer = setTimeout(tick, 40);
    };
    tick();
  }
  stopMetronome() { this.metroPlaying = false; clearTimeout(this.metroTimer); }
  clickAt(when, accent=false) {
    const sound = SETTINGS.metronomeSound;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const freq = sound==='cowbell' ? (accent?900:720)
              : sound==='clave' ? (accent?2400:1800)
              : sound==='beep' ? (accent?1500:1100)
              : sound==='side' ? (accent?700:520)
              : (accent?1200:800); // wood
    o.type = (sound==='beep')?'sine':'square';
    o.frequency.value = freq;
    const dur = sound==='cowbell'?0.12 : sound==='beep'?0.04 : 0.03;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent?0.6:0.4, when+0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when+dur);
    o.connect(g).connect(this.metroGain);
    o.start(when); o.stop(when+dur+0.01);
  }
  setBpm(b){ this.metroBpm = b; document.documentElement.style.setProperty('--metro-period', (60/b) + 's'); }

  // --- Chord playback for chord-scale block
  // Voice-led chord placement. Each new chord's pitch classes are placed at
  // the octave that minimizes movement from the previous chord's voicing —
  // common tones stay put, others move by smallest interval. Greedy match,
  // not Hungarian-optimal, but good enough for 4–5 voices.
  voicePitches(rootPc, tones) {
    const newPcs = tones.map(s => ((rootPc + s) % 12 + 12) % 12);
    const prev = this.prevChordPitches;
    let pitches;
    if (!prev || prev.length === 0) {
      // First chord: close stack starting near C4 (MIDI 60).
      let last = 59;
      pitches = newPcs.map(pc => {
        let m = 12 * Math.floor(last / 12) + pc;
        while (m <= last) m += 12;
        last = m;
        return m;
      });
    } else {
      const used = new Set();
      pitches = newPcs.map(pc => {
        let bestMidi = 60 + pc;
        let bestDist = Infinity;
        let bestPrevIdx = -1;
        for (let i = 0; i < prev.length; i++) {
          if (used.has(i)) continue;
          const oct = Math.round((prev[i] - pc) / 12);
          const m = 12 * oct + pc;
          const d = Math.abs(m - prev[i]);
          if (d < bestDist) { bestDist = d; bestMidi = m; bestPrevIdx = i; }
        }
        if (bestPrevIdx >= 0) used.add(bestPrevIdx);
        return bestMidi;
      });
    }
    // Clamp to a sensible range (D3..G#5) without disturbing pitch class.
    pitches = pitches.map(m => {
      while (m < 50) m += 12;
      while (m > 80) m -= 12;
      return m;
    });
    this.prevChordPitches = pitches;
    return pitches;
  }
  resetChordVoicing() { this.prevChordPitches = null; }

  playChord(rootPc, tones, when, durSec, modal=false) {
    if (!this.ctx) return;
    const pitches = this.voicePitches(rootPc, tones);
    const ref = SETTINGS.referencePitch || 440;
    pitches.forEach(midi => {
      const f = ref * Math.pow(2, (midi - 69) / 12);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = modal ? 'sine' : 'triangle';
      o.frequency.value = f;
      // Envelope: punchy attack, brief decay to a high sustain that holds
      // through durSec, then a short release. Replaces the prior decay-heavy
      // shape that made chord hits sound one-shot rather than sustained.
      const peak = modal ? 0.10 : 0.14;
      const sus  = modal ? 0.085 : 0.10;
      const atk  = modal ? 0.30 : 0.015;
      const decToSus = modal ? 0.20 : 0.10;
      const rel = Math.min(modal ? 0.40 : 0.18, durSec * 0.25);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when + atk);
      g.gain.linearRampToValueAtTime(sus, when + atk + decToSus);
      g.gain.setValueAtTime(sus, Math.max(when + atk + decToSus, when + durSec - rel));
      g.gain.linearRampToValueAtTime(0.0001, when + durSec);
      o.connect(g).connect(this.chordGain);
      o.start(when);
      o.stop(when + durSec + 0.05);
    });
  }
  stopAll(){ this.stopDrone(); this.stopMetronome(); }
  chime() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [880, 1320].forEach((f,i)=>{
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type='sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now+i*0.08);
      g.gain.linearRampToValueAtTime(0.18, now+i*0.08+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now+i*0.08+0.4);
      o.connect(g).connect(this.master);
      o.start(now+i*0.08); o.stop(now+i*0.08+0.5);
    });
  }
}

// ---------- VexFlow helpers ----------
function vfAvailable(){ return !!window.Vex && !!window.Vex.Flow; }

function scaleNotesFromRoot(rootPc, intervals, octaves=3, startOctave=4) {
  const out = [];
  const asc = intervals.slice(0, -0).concat([12]); // include upper tonic
  let curOct = startOctave;
  for (let o=0; o<octaves; o++) {
    for (let i=0; i<intervals.length; i++) {
      const pc = (rootPc + intervals[i]) % 12;
      const noteOct = curOct + Math.floor((rootPc + intervals[i]) / 12);
      out.push({pc, octave: noteOct, name: NOTE_NAMES[pc]});
    }
    curOct += 1;
  }
  // final tonic
  out.push({pc: rootPc, octave: startOctave+octaves, name: NOTE_NAMES[rootPc]});
  return out;
}

function renderNotation(containerEl, notes, title='') {
  containerEl.innerHTML = '';
  if (!vfAvailable() || !notes.length) {
    const div = document.createElement('div');
    div.style.padding = '8px';
    div.style.color = '#111';
    div.style.fontSize = '14px';
    div.textContent = notes.map(n=>n.name + n.octave).join(' ');
    containerEl.appendChild(div);
    return;
  }
  try {
    const VF = Vex.Flow;
    const width = Math.min(containerEl.clientWidth || 340, 900);
    const per = 16;
    const lines = Math.ceil(notes.length / per);
    const height = 90 * lines;
    const renderer = new VF.Renderer(containerEl, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    ctx.setFont('Inter', 10);
    for (let li=0; li<lines; li++) {
      const slice = notes.slice(li*per, (li+1)*per);
      const stave = new VF.Stave(2, li*90, width-4);
      if (li===0) stave.addClef('treble');
      stave.setContext(ctx).draw();
      const vnotes = slice.map(n => {
        const key = (n.name[0].toLowerCase()) + (n.name.length>1 ? n.name[1] : '') + '/' + n.octave;
        const note = new VF.StaveNote({ clef:'treble', keys:[key], duration:'q' });
        if (n.name.includes('#')) note.addModifier(new VF.Accidental('#'));
        else if (n.name.includes('b') && n.name.length>1) note.addModifier(new VF.Accidental('b'));
        return note;
      });
      const voice = new VF.Voice({ num_beats: vnotes.length, beat_value: 4 }).setStrict(false).addTickables(vnotes);
      new VF.Formatter().joinVoices([voice]).format([voice], width-20);
      voice.draw(ctx, stave);
    }
  } catch (e) {
    console.warn('VexFlow render failed', e);
    const div = document.createElement('div'); div.style.color='#111'; div.style.padding='8px'; div.style.fontSize='14px';
    div.textContent = notes.map(n=>n.name + n.octave).join(' ');
    containerEl.appendChild(div);
  }
}

// ---------- DOM helpers ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function el(tag, attrs={}, children=[]) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === true) e.setAttribute(k, '');
    else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children)?children:[children]).forEach(c => {
    if (c==null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
// ---------- Modal (replaces window.confirm / prompt / alert) ----------
// Per-step note capture used inside scales screens. Skippable — Cancel returns
// without writing anything. Saves to SESSION.notes with the originating block
// + step context so the session-detail view can group them.
async function dropStepNote(block, ctx={}) {
  if (!SESSION) return;
  const ta = el('textarea',{placeholder:'A quick thought…',style:'min-height:90px;'});
  const wrap = el('div',{}); wrap.appendChild(ta);
  const tagRow = el('div',{class:'row wrap',style:'gap:8px;margin-top:8px;'});
  let tag = 'neutral';
  ['worked',"didn't",'neutral'].forEach(t => {
    const b = el('button',{class:'chip ' + (t===tag?'primary':'')}, [el('span',{class:'inner'}, t)]);
    b.addEventListener('click', () => { tag = t; Array.from(tagRow.children).forEach(c=>c.classList.remove('primary')); b.classList.add('primary'); });
    tagRow.appendChild(b);
  });
  wrap.appendChild(tagRow);
  const v = await modal({title:'Quick note', content: wrap, buttons:[{label:'Cancel',value:false},{label:'Save',value:true,primary:true}]});
  if (!v) return;
  const text = ta.value.trim(); if (!text) return;
  SESSION.notes.push({ block, ...ctx, text, tag, time: Date.now() });
  persistSession();
  logEvent('step_note', { block, ...ctx, tag });
  toast('Note saved');
}

function modal({ title, message, content, buttons, dismissible=false }) {
  return new Promise(resolve => {
    const overlay = el('div',{class:'modal-overlay'});
    const card = el('div',{class:'modal-card'});
    if (title) card.appendChild(el('div',{class:'modal-title'}, title));
    if (message) card.appendChild(el('div',{class:'modal-message'}, message));
    if (content) card.appendChild(content);
    const row = el('div',{class:'modal-btns'});
    function close(v){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
    (buttons||[{label:'OK', value:true, primary:true}]).forEach(b => {
      const btn = el('button',{class:'modal-btn '+(b.primary?'primary':b.danger?'danger':'')}, [el('span',{class:'inner'}, b.label)]);
      btn.addEventListener('click', () => { if (b.onclick){ const r = b.onclick(); if (r === false) return; } close(b.value); });
      row.appendChild(btn);
    });
    card.appendChild(row);
    overlay.appendChild(card);
    if (dismissible) overlay.addEventListener('click', e => { if (e.target===overlay) close(undefined); });
    document.body.appendChild(overlay);
  });
}
// Volume slider row used inside long-press modals.
function buildQuickVol(kind) {
  const wrap = el('div',{class:'vol-quick'});
  wrap.appendChild(el('div',{class:'vol-quick-label'}, 'VOLUME'));
  const slider = el('input',{type:'range',min:0,max:1,step:0.01,class:'vol-quick-slider', 'aria-label':kind+' volume'});
  slider.value = SETTINGS.volumes[kind] ?? 0.5;
  slider.addEventListener('input', e => AUDIO.setVolume(kind, parseFloat(e.target.value)));
  slider.addEventListener('change', e => logEvent(kind+'_volume', parseFloat(e.target.value)));
  wrap.appendChild(slider);
  return wrap;
}

// Drone long-press modal: volume on top, scale-degree picker below. Tap a
// degree to switch and close; Cancel/backdrop closes without changing pitch.
// Volume changes apply live and persist regardless of close path.
function openDronePicker(currentPc, tonicPc) {
  return new Promise(resolve => {
    const labels = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
    const overlay = el('div',{class:'modal-overlay'});
    const card = el('div',{class:'modal-card'});
    card.appendChild(el('div',{class:'modal-title'}, 'Drone'));
    card.appendChild(buildQuickVol('drone'));
    card.appendChild(el('div',{class:'modal-message',style:'margin-top:6px;'}, `Pitch — relative to ${NOTE_NAMES[tonicPc]}. Tap to switch.`));
    function close(v){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
    const grid = el('div',{class:'drone-pick-grid'});
    labels.forEach((lbl, semi) => {
      const pc = (tonicPc + semi) % 12;
      const btn = el('button',{class:'drone-pick-btn ' + (pc===currentPc?'primary':'')},[
        el('div',{class:'dp-degree'}, lbl),
        el('div',{class:'dp-note'}, NOTE_NAMES[pc]),
      ]);
      btn.addEventListener('click', () => close(pc));
      grid.appendChild(btn);
    });
    card.appendChild(grid);
    const cancelBtn = el('button',{class:'modal-btn'}, [el('span',{class:'inner'}, 'Done')]);
    cancelBtn.addEventListener('click', () => close(null));
    card.appendChild(el('div',{class:'modal-btns'}, [cancelBtn]));
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target===overlay) close(null); });
    document.body.appendChild(overlay);
  });
}

// Metro long-press modal: volume slider + current tempo readout.
function openMetroControl() {
  return new Promise(resolve => {
    const overlay = el('div',{class:'modal-overlay'});
    const card = el('div',{class:'modal-card'});
    card.appendChild(el('div',{class:'modal-title'}, 'Metronome'));
    card.appendChild(buildQuickVol('metro'));
    const tempoLine = SESSION ? `${SESSION.tempo} bpm — adjust on screen with − / +.` : 'Adjust tempo on screen.';
    card.appendChild(el('div',{class:'modal-message',style:'margin-top:6px;'}, tempoLine));
    function close(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(); }
    const doneBtn = el('button',{class:'modal-btn primary'}, [el('span',{class:'inner'}, 'Done')]);
    doneBtn.addEventListener('click', close);
    card.appendChild(el('div',{class:'modal-btns'}, [doneBtn]));
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
    document.body.appendChild(overlay);
  });
}

function askConfirm(title, message, { okLabel='Yes', cancelLabel='No', danger=false } = {}) {
  return modal({ title, message, buttons: [
    { label: cancelLabel, value: false },
    { label: okLabel, value: true, primary: !danger, danger },
  ]});
}

function toast(msg, ms=1600){
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.add('hidden'), ms);
}

// ---------- Wake lock ----------
let wakeLockRef = null;
async function requestWakeLock(){
  try { if ('wakeLock' in navigator) wakeLockRef = await navigator.wakeLock.request('screen'); } catch(e){}
}
function releaseWakeLock(){ if (wakeLockRef) { try{ wakeLockRef.release(); }catch(e){} wakeLockRef=null; } }
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible' && SESSION) requestWakeLock(); });

// ---------- Router / screens ----------
let CURRENT_COLOR = PALETTE[0];
function pickColor(){
  const next = PALETTE[Math.floor(Math.random()*PALETTE.length)];
  CURRENT_COLOR = next;
  const app = $('#app');
  const ink = pickInk(next);
  app.style.background = next;
  app.style.color = ink;
  app.style.setProperty('--bg', next);
  app.style.setProperty('--ink', ink);
  document.querySelector('meta[name=theme-color]').setAttribute('content', next);
}
function pickInk(hex){
  const r=parseInt(hex.substr(1,2),16), g=parseInt(hex.substr(3,2),16), b=parseInt(hex.substr(5,2),16);
  const lum = (0.299*r + 0.587*g + 0.114*b)/255;
  return lum > 0.55 ? '#0a0a0a' : '#f4f1ea';
}

function render(screenFn) {
  // Any screen transition kills active recording playback. The Audio object
  // would otherwise keep playing in the background after navigating away.
  if (typeof stopCurrentPlayback === 'function') stopCurrentPlayback();
  const app = $('#app');
  app.innerHTML = '';
  pickColor();
  const root = el('div',{class:'screen fade-in'});
  app.appendChild(root);
  screenFn(root);
}
function renderSameColor(screenFn) {
  const app = $('#app');
  app.innerHTML = '';
  const root = el('div',{class:'screen fade-in'});
  app.appendChild(root);
  screenFn(root);
}

// ---------- Weekly schedule derivation ----------
function weekInfo(sessionCount=null, startDate=null) {
  // Week advances by sessions completed. 5 sessions/week.
  const count = sessionCount ?? SESSION_COUNT_CACHE;
  const weekNum = Math.floor(count/5) + 1;
  const tonicIdx = Math.floor((weekNum-1)/2) % TONICS_CYCLE.length;
  const minor = ((weekNum-1) % 2) === 0;
  const entry = TONICS_CYCLE[tonicIdx];
  const rootName = minor ? entry.minor : entry.major;
  const rootPc = NOTE_TO_PC[rootName];
  return { weekNum, tonicIdx, minor, entry, rootName, rootPc, tonicLabel: entry.label };
}

let SESSION_COUNT_CACHE = 0;
async function refreshSessionCount() {
  const sessions = await idbAll('sessions');
  SESSION_COUNT_CACHE = sessions.filter(s => s.complete).length;
  return SESSION_COUNT_CACHE;
}

function sessionsThisWeek(sessions) {
  const counts = {};
  sessions.forEach(s => {
    if (!s.complete) return;
    const d = new Date(s.date);
    const wk = weekKey(d);
    counts[wk] = (counts[wk]||0) + 1;
  });
  return counts;
}
function weekKey(d){
  // ISO-ish week (Sun-start)
  const copy = new Date(d); copy.setHours(0,0,0,0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy.toISOString().slice(0,10);
}
function computeStreak(sessions) {
  const weekly = sessionsThisWeek(sessions);
  const now = new Date();
  let cur = 0, best = 0;
  // walk back weeks
  let cursor = new Date(now); cursor.setDate(cursor.getDate() - cursor.getDay());
  // don't penalize current partial week
  let first = true;
  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0,10);
    const count = weekly[key]||0;
    if (count >= 5) { streak++; }
    else if (first && count < 5) { /* current partial week, skip */ }
    else break;
    first = false;
    cursor.setDate(cursor.getDate() - 7);
    if (streak > 200) break;
  }
  cur = streak;
  // best = scan all keys
  const keys = Object.keys(weekly).sort();
  let run = 0;
  keys.forEach((k,i) => {
    if (weekly[k] >= 5) { run++; best = Math.max(best, run); }
    else run = 0;
  });
  best = Math.max(best, cur);
  return { cur, best };
}

// ---------- Session object ----------
function newSession(light=false) {
  const info = weekInfo();
  return {
    id: 'sess_'+Date.now(),
    date: isoDate(),
    dow: todayDow(),
    week: info.weekNum,
    tonic: info.rootName,
    tonicPc: info.rootPc,
    minor: info.minor,
    light,
    startedAt: Date.now(),
    activeMs: 0,
    activeRunningFrom: null,
    blocks: { scales:{}, adagio:{}, fuga:{}, improv:{} },
    notes: [],
    recordings: [],
    tempo: SETTINGS.tempoPerKey[keyTempoName(info.rootName, info.minor)] || 60,
    complete: false,
  };
}
function keyTempoName(tonic, minor){ return tonic + (minor?'m':'M'); }
function tempoHistoryFor(tonic, minor){
  const k = keyTempoName(tonic, minor);
  return (SETTINGS.tempoHistory && SETTINGS.tempoHistory[k]) || [];
}
function scaleTempoFor(tonic, minor){
  // Auto-suggested starting tempo:
  //  - first time: 60
  //  - thereafter: last session's ending tempo + small auto bump (when last session
  //    didn't end with a manual decrease)
  const hist = tempoHistoryFor(tonic, minor);
  if (!hist.length) return 60;
  const last = hist[hist.length-1];
  const lastTempo = last.endTempo || last.startTempo || 60;
  // Auto bump if last session ended at or above where it started; flat otherwise.
  const wentForward = (last.endTempo||0) >= (last.startTempo||0);
  const bump = wentForward ? 2 : 0;
  return Math.max(40, Math.min(180, lastTempo + bump));
}
function recordSessionTempo(tonic, minor, entry){
  const k = keyTempoName(tonic, minor);
  SETTINGS.tempoHistory = SETTINGS.tempoHistory || {};
  SETTINGS.tempoHistory[k] = SETTINGS.tempoHistory[k] || [];
  SETTINGS.tempoHistory[k].push(entry);
  // keep last 12 per key
  if (SETTINGS.tempoHistory[k].length > 12) SETTINGS.tempoHistory[k] = SETTINGS.tempoHistory[k].slice(-12);
  kvSet('settings', SETTINGS);
}
function activeTimeNow() {
  if (!SESSION) return 0;
  let ms = SESSION.activeMs;
  if (SESSION.activeRunningFrom) ms += (Date.now() - SESSION.activeRunningFrom);
  return ms;
}
function startActiveClock() { if (SESSION && !SESSION.activeRunningFrom) SESSION.activeRunningFrom = Date.now(); }
function pauseActiveClock() { if (SESSION && SESSION.activeRunningFrom) { SESSION.activeMs += (Date.now() - SESSION.activeRunningFrom); SESSION.activeRunningFrom = null; persistSession(); } }
function persistSession(){ if (SESSION) idbSet('sessions', null, SESSION); }

function fmtMs(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(s/60), ss = s%60;
  return m+':'+String(ss).padStart(2,'0');
}
function fmtSec(s){ s=Math.max(0,Math.floor(s)); const m=Math.floor(s/60); return m+':'+String(s%60).padStart(2,'0'); }

// ---------- Screens ----------
async function screenHome() {
  CURRENT_SCREEN = 'home';
  render(async (root) => {
    const sessions = await idbAll('sessions');
    const { cur } = computeStreak(sessions);
    const info = weekInfo();
    const dow = todayDow();
    const today = new Date();
    const dayFull = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
    const monthName = today.toLocaleString('en-US',{month:'long'});
    const dateLine = `${monthName} ${today.getDate()}, ${today.getFullYear()}`;
    const pendingImprov = await pendingImprovAnnotation();

    // Hero block — book title page
    const hero = el('div',{class:'home-hero'},[
      el('div',{class:'hero-week'}, `Week ${info.weekNum}`),
      el('h1',{class:'hero-day'}, dayFull),
      el('div',{class:'hero-date'}, dateLine),
      el('div',{class:'hero-rule'}),
    ]);
    root.appendChild(hero);

    // Sessions count + days-to-show countdown
    const todayMid = new Date(); todayMid.setHours(0,0,0,0);
    const perf = new Date(SETTINGS.performanceDate || '2026-05-17'); perf.setHours(0,0,0,0);
    const daysToShow = Math.max(0, Math.ceil((perf - todayMid) / 86400000));
    const sessLabel = `${SESSION_COUNT_CACHE} session${SESSION_COUNT_CACHE===1?'':'s'}`;
    const showLabel = daysToShow === 0 ? 'show day' : `${daysToShow} d to show`;
    root.appendChild(el('div',{class:'hero-meta'}, `${sessLabel} · ${showLabel}`));

    if (pendingImprov) {
      root.appendChild(el('div',{class:'banner', onclick: ()=>screenRecordings()}, 'Yesterday\'s improv needs 2 notes — tap to annotate'));
    }

    const scaleLabel = `${info.rootName} ${scaleFormName(dow, info.minor)}`;
    const pedalNote = droneNoteForToday(info, dow);
    const modeLabel = modalFocusLabel(info, dow);
    const improvLabel = isSystemDay(dow) ? 'System patch' : 'Acoustic';
    const longNote = isSundayLong(dow) ? ' · Long session' : '';

    const menu = el('div',{class:'menu'},[
      menuItem('Scale', scaleLabel, dayBowing(dow)),
      menuItem('Pedal tone', pedalNote, ''),
      menuItem('Mode', modeLabel, ''),
      menuItem('Improvisation', improvLabel + longNote, ''),
    ]);
    const body = el('div',{class:'body home-body'}, [menu]);
    root.appendChild(body);

    // Light day defaults to OFF every visit — session-only.
    if (window.__lightToggle === undefined) window.__lightToggle = false;
    const lightOn = !!window.__lightToggle;
    const lightRow = el('label',{class:'row light-toggle'},[
      (() => { const cb = el('input',{type:'checkbox'}); cb.checked = lightOn; cb.addEventListener('change', e=>{ window.__lightToggle = e.target.checked; logEvent('light_toggle', e.target.checked); }); return cb; })(),
      el('span',{}, 'Light day — halves each block')
    ]);
    body.appendChild(lightRow);

    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: startSession}, [el('span',{class:'inner'}, 'Begin session')]),
    ]));
    root.appendChild(el('div',{class:'row home-foot'},[
      el('span',{class:'streak-mark'}, `${cur} wk streak`),
      el('span',{class:'sep'}, '·'),
      el('button',{class:'ghost', onclick: screenSettings}, 'Settings'),
      el('button',{class:'ghost', onclick: screenRecordings}, 'Recordings'),
      el('button',{class:'ghost', onclick: screenStats}, 'History'),
    ]));
  });
}
function menuItem(eyebrow, primary, hint){
  return el('div',{class:'menu-item'},[
    el('div',{class:'menu-eyebrow'}, eyebrow),
    el('div',{class:'menu-primary'}, primary),
    hint ? el('div',{class:'menu-hint'}, hint) : null,
  ].filter(Boolean));
}
function droneNoteForToday(info, dow) {
  const offset = droneDegree(dow, info.minor);
  return NOTE_NAMES[(info.rootPc + offset) % 12];
}
function scaleFormLabel(dow, minor){
  if (!minor) return 'major, both directions';
  const f = dayScaleForm(dow, true);
  if (f==='harmonic') return 'harmonic minor, both directions';
  if (f==='melodic') return 'melodic minor, both directions';
  return 'melodic asc / natural desc';
}
function modalFocusLabel(info, dow){
  const m = dayModalFocus(dow, info.minor);
  const root = NOTE_NAMES[(info.rootPc + m.shift)%12];
  return `${root} ${m.mode}`;
}
async function pendingImprovAnnotation() {
  if (SETTINGS.lightDay) return false;
  const recs = await idbAll('recordings');
  const yesterday = isoDate(new Date(Date.now()-86400000));
  const imp = recs.filter(r => r.block==='improv' && r.date===yesterday && !r.light);
  if (!imp.length) return false;
  const needed = imp.some(r => (r.annotations||[]).length < (r.longSession?3:2));
  return needed;
}

// ---------- Session flow ----------
async function startSession() {
  await AUDIO.resume();
  const light = !!window.__lightToggle;
  SESSION = newSession(light);
  startActiveClock();
  await idbSet('sessions', null, SESSION);
  requestWakeLock();
  screenScalesTechnical();
}

// --- helpers for block sub-sequences ---
function stepRunner({stepDurationsMs, onStep, onComplete, onTick}) {
  let idx = 0;
  let stepStart = Date.now();
  let running = true;
  let pausedAt = null;
  let pausedMs = 0;
  let timerId = null;
  function cur() { return Date.now() - stepStart - pausedMs; }
  function left() { return stepDurationsMs[idx] - cur(); }
  function tick() {
    if (!running) return;
    const rem = left();
    onTick && onTick(idx, Math.max(0,rem), stepDurationsMs[idx]);
    if (rem <= 0) {
      AUDIO.chime();
      idx++;
      stepStart = Date.now(); pausedMs = 0;
      if (idx >= stepDurationsMs.length) {
        running = false;
        onComplete && onComplete();
        return;
      }
      onStep && onStep(idx);
    }
    timerId = setTimeout(tick, 120);
  }
  onStep && onStep(0);
  tick();
  return {
    extend(ms){ stepStart += ms; },
    skip(){ idx++; stepStart = Date.now(); pausedMs=0; if(idx>=stepDurationsMs.length){ running=false; onComplete&&onComplete(); } else onStep&&onStep(idx); },
    pause(){ if (!pausedAt) pausedAt = Date.now(); },
    resume(){ if (pausedAt){ pausedMs += Date.now()-pausedAt; pausedAt=null; } },
    stop(){ running=false; clearTimeout(timerId); },
    get index(){ return idx; }
  };
}

// ---------- Scales — Technical ----------
function scalesTechnicalSteps(info, dow, light) {
  const scaleForm = dayScaleForm(dow, info.minor);
  const T = info.rootPc;
  let ascInts, descInts;
  if (!info.minor) { ascInts = descInts = SCALE.major; }
  else if (scaleForm==='harmonic') { ascInts = descInts = SCALE.harmonic; }
  else if (scaleForm==='melodic')  { ascInts = descInts = SCALE.melodic;  }
  else { ascInts = SCALE.melodic; descInts = SCALE.natural; }
  const scale3oct = (()=>{
    const up = scaleNotesFromRoot(T, ascInts, 3, 3);
    const dnInts = descInts.slice().reverse().map(i=>i);
    const last = up[up.length-1];
    // descending: reuse tonic then back down
    const down = [];
    let curOct = last.octave;
    for (let o=0;o<3;o++){
      for (let i=descInts.length-1; i>=0; i--){
        const pc = (T+descInts[i])%12;
        const oct = last.octave - o - (descInts[i]===0?1:0) + (descInts[i]<descInts[descInts.length-1]?0:0);
        down.push({pc, octave: last.octave - o + (descInts[i]===12?0:0), name:NOTE_NAMES[pc]});
      }
    }
    return up.concat(down.slice(1));
  })();
  const thirds = (()=>{
    const ints = ascInts;
    const out = [];
    for (let o=0;o<2;o++){
      for (let i=0;i<ints.length;i++){
        out.push({pc:(T+ints[i])%12, octave: 3+o+Math.floor((T+ints[i])/12), name:NOTE_NAMES[(T+ints[i])%12]});
        out.push({pc:(T+ints[(i+2)%ints.length] + (i+2>=ints.length?12:0))%12, octave: 3+o+Math.floor((T+ints[(i+2)%ints.length]+(i+2>=ints.length?12:0))/12), name:NOTE_NAMES[(T+ints[(i+2)%ints.length])%12]});
      }
    }
    return out;
  })();
  const tonicArp = (()=>{
    const ints = info.minor ? [0,3,7] : [0,4,7];
    const out = [];
    for (let o=0;o<3;o++) ints.forEach(iv => out.push({pc:(T+iv)%12, octave:3+o+Math.floor((T+iv)/12), name:NOTE_NAMES[(T+iv)%12]}));
    out.push({pc:T, octave:6, name:NOTE_NAMES[T]}); // top tonic to turn around
    for (let o=2;o>=0;o--) ints.slice().reverse().forEach(iv => out.push({pc:(T+iv)%12, octave:3+o+Math.floor((T+iv)/12), name:NOTE_NAMES[(T+iv)%12]}));
    return out;
  })();
  const dom7Root = (T+7)%12;
  const dom7Arp = (()=>{
    const ints = [0,4,7,10];
    const out = [];
    for (let o=0;o<3;o++) ints.forEach(iv => out.push({pc:(dom7Root+iv)%12, octave:3+o+Math.floor((dom7Root+iv)/12), name:NOTE_NAMES[(dom7Root+iv)%12]}));
    out.push({pc:dom7Root, octave:6, name:NOTE_NAMES[dom7Root]});
    for (let o=2;o>=0;o--) ints.slice().reverse().forEach(iv => out.push({pc:(dom7Root+iv)%12, octave:3+o+Math.floor((dom7Root+iv)/12), name:NOTE_NAMES[(dom7Root+iv)%12]}));
    return out;
  })();
  const extraArpIsSubdominant = (info.weekNum % 2 === 1); // alternate
  const extraRoot = extraArpIsSubdominant ? (T+5)%12 : (T+11)%12;
  const extraInts = extraArpIsSubdominant
    ? (info.minor ? [0,3,7] : [0,4,7])
    : [0,3,6,9];
  const extraArp = (()=>{
    const out = [];
    for (let o=0;o<3;o++) extraInts.forEach(iv => out.push({pc:(extraRoot+iv)%12, octave:3+o+Math.floor((extraRoot+iv)/12), name:NOTE_NAMES[(extraRoot+iv)%12]}));
    out.push({pc:extraRoot, octave:6, name:NOTE_NAMES[extraRoot]});
    for (let o=2;o>=0;o--) extraInts.slice().reverse().forEach(iv => out.push({pc:(extraRoot+iv)%12, octave:3+o+Math.floor((extraRoot+iv)/12), name:NOTE_NAMES[(extraRoot+iv)%12]}));
    return out;
  })();
  const mul = light ? 0.5 : 1;
  // Suggested durations are guides only — the user advances manually.
  return [
    { title: `Scale`, kind:'3 oct', sub: `${info.rootName} ${scaleFormName(dow, info.minor)}`, notes: scale3oct, suggestSec: Math.round(120*mul) },
    { title: `Broken thirds`, kind:'2 oct', sub: `1-3, 2-4, …`, notes: thirds, suggestSec: Math.round(120*mul) },
    { title: `Tonic arpeggio`, kind:'3 oct', sub: `${info.rootName} ${info.minor?'minor':'major'}`, notes: tonicArp, suggestSec: Math.round(75*mul) },
    { title: `Dominant 7 arpeggio`, kind:'3 oct', sub: `${NOTE_NAMES[dom7Root]}7`, notes: dom7Arp, suggestSec: Math.round(75*mul) },
    { title: extraArpIsSubdominant ? `Subdominant arpeggio` : `Dim 7 on leading tone`, kind:'3 oct', sub: `${NOTE_NAMES[extraRoot]}`, notes: extraArp, suggestSec: Math.round(75*mul) },
  ];
}
function notesAsLine(notes){
  // Show unique-in-sequence ascending names: walks the array, adds note when name differs from previous,
  // stops when we return to a prior name (i.e. start of descent or repeated cycle).
  const seen = new Set();
  const out = [];
  for (const n of notes) {
    if (out.length && n.name === out[out.length-1]) continue;
    if (seen.has(n.name) && out.length) {
      // close on the tonic if it matches first note
      if (n.name === out[0]) { out.push(n.name); break; }
      else break;
    }
    out.push(n.name); seen.add(n.name);
  }
  return out.join('  ');
}
function scaleFormName(dow, minor){
  if (!minor) return 'major';
  const f = dayScaleForm(dow, true);
  if (f==='harmonic') return 'harmonic minor';
  if (f==='melodic') return 'melodic minor';
  return 'melodic ↑ / natural ↓';
}

function screenScalesTechnical() {
  CURRENT_SCREEN = 'scales_technical';
  render(async (root) => {
    const info = weekInfo();
    const dow = todayDow();
    const steps = scalesTechnicalSteps(info, dow, SESSION.light);
    // tempo: start at 60, +5 each recurrence of this key
    SESSION.tempo = scaleTempoFor(info.rootName, info.minor);
    const startTempo = SESSION.tempo;
    SESSION.tempoEvents = SESSION.tempoEvents || [];
    SESSION.tempoEvents.push({ t: Date.now(), to: startTempo, kind: 'start', key: keyTempoName(info.rootName, info.minor) });
    AUDIO.setBpm(SESSION.tempo);
    const dronePc = (info.rootPc + droneDegree(dow, info.minor))%12;
    let stepIdx = -1;
    let stepStart = 0;
    const stepTimes = []; // ms per step
    let stepTickT = null;
    let started = false;
    logEvent('scales_technical_open', { tonic: info.rootName, minor: info.minor, tempo: SESSION.tempo });

    const topEl = el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'},'Scales · Technical'),
        el('h1',{}, `${info.rootName} ${info.minor?'minor':'major'}`),
      ]),
      el('div',{class:'step-counter', id:'stepCounter'}, `– / ${steps.length}`),
    ]);
    root.appendChild(topEl);

    const body = el('div',{class:'body stack'}); root.appendChild(body);

    // Audio control panel — big, prominent
    const histPrev = tempoHistoryFor(info.rootName, info.minor);
    body.appendChild(buildAudioPanel({
      dronePc,
      droneLabel: NOTE_NAMES[dronePc],
      tonicPc: info.rootPc, // long-press picker shows degrees relative to the week's tonic, not the drone pitch
      compact: true, // fits on phone alongside bowing detail, step title, note line, clock
      onTempoChange: bpm => {
        SESSION.tempo = bpm;
        SESSION.tempoEvents.push({ t: Date.now(), to: bpm, kind: 'manual', stepIdx });
        logEvent('tempo_change', { bpm, stepIdx });
      },
    }));
    if (histPrev.length) {
      const last = histPrev[histPrev.length-1];
      body.appendChild(el('div',{class:'tempo-hint'},
        `Last time on ${NOTE_NAMES[info.rootPc]} ${info.minor?'minor':'major'}: ${last.startTempo}→${last.endTempo} bpm · ${histPrev.length} session${histPrev.length>1?'s':''} of history`
      ));
    }

    body.appendChild(el('div',{class:'bowing-line'}, `Bowing — ${dayBowing(dow)}`));
    const bowDetail = dayBowingDetail(dow);
    if (bowDetail) body.appendChild(el('div',{class:'bowing-detail'}, bowDetail));

    const stepTitle = el('h2',{id:'stepTitle', class:'step-title'}, 'Ready when you are');
    const stepSub = el('p',{id:'stepSub',class:'dim step-sub'}, 'Tap Start to begin the first scale.');
    body.appendChild(stepTitle); body.appendChild(stepSub);
    const noteLine = el('div',{class:'note-line', id:'noteLine'}, '');
    body.appendChild(noteLine);
    const stepClock = el('div',{class:'step-clock', id:'stepClock'}, '');
    body.appendChild(stepClock);

    const bottom = el('div',{class:'band-bottom'});
    root.appendChild(bottom);
    const backBtn = el('button',{class:'chip'}, 'Back');
    backBtn.style.visibility = 'hidden';
    backBtn.addEventListener('click', () => {
      if (stepIdx <= 0) return;
      stepTimes[stepIdx] = undefined;
      logEvent('scale_step_back', { from: stepIdx });
      AUDIO.chime();
      showStep(stepIdx - 1);
    });
    const startBtn = el('button',{class:'big primary', onclick: ()=>{ if (!started) begin(); else nextStep(); }}, [el('span',{class:'inner', id:'startInner'}, 'Start')]);
    const noteBtn  = el('button',{class:'chip', onclick: () => dropStepNote('scales-technical', { stepIdx, stepTitle: steps[stepIdx]?.title })}, '+ Note');
    const recBtn   = el('button',{class:'chip record-button', onclick: toggleRecord}, 'Record');
    bottom.appendChild(backBtn);
    bottom.appendChild(startBtn);
    bottom.appendChild(noteBtn);
    bottom.appendChild(recBtn);

    function fmtElapsed(ms){ return fmtSec(ms/1000); }
    function tick(){
      if (stepIdx<0) return;
      const elapsed = Date.now() - stepStart;
      const target = (steps[stepIdx].suggestSec||60)*1000;
      const over = elapsed >= target;
      stepClock.textContent = `${fmtElapsed(elapsed)}  ·  target ${fmtElapsed(target)}`;
      stepClock.classList.toggle('reached', over);
      stepTickT = setTimeout(tick, 250);
    }
    function showStep(i){
      stepIdx = i; stepStart = Date.now();
      const s = steps[i];
      $('#stepCounter').textContent = `${i+1} / ${steps.length}`;
      $('#stepTitle').textContent = `${s.title} · ${s.kind}`;
      $('#stepSub').textContent = s.sub;
      $('#noteLine').textContent = notesAsLine(s.notes);
      $('#startInner').textContent = (i === steps.length-1) ? 'Finish' : 'Next';
      backBtn.style.visibility = (i > 0) ? '' : 'hidden';
      logEvent('scale_step_start', { i, title: s.title });
      clearTimeout(stepTickT); tick();
    }
    function nextStep(){
      const ms = Date.now() - stepStart;
      stepTimes[stepIdx] = ms;
      logEvent('scale_step_done', { i: stepIdx, ms });
      if (stepIdx >= steps.length-1) { return finish(); }
      AUDIO.chime();
      showStep(stepIdx+1);
    }
    async function begin(){
      started = true;
      await AUDIO.resume();
      if (SETTINGS.drone_on) await AUDIO.startDrone(dronePc);
      if (SETTINGS.metro_on) AUDIO.startMetronome(SESSION.tempo);
      logEvent('scales_technical_begin', { tempo: SESSION.tempo, drone: NOTE_NAMES[dronePc] });
      showStep(0);
    }
    async function finish(){
      clearTimeout(stepTickT);
      AUDIO.stopMetronome();
      AUDIO.fadeDrone(500);
      const tk = keyTempoName(info.rootName, info.minor);
      const totalMs = stepTimes.reduce((a,b)=>a+(b||0),0);
      const entry = {
        date: isoDate(),
        startTempo,
        endTempo: SESSION.tempo,
        stepTimesMs: stepTimes.slice(),
        totalMs,
        tempoEvents: SESSION.tempoEvents.slice(),
      };
      recordSessionTempo(info.rootName, info.minor, entry);
      SETTINGS.tempoPerKey[tk] = Math.max(SESSION.tempo, SETTINGS.tempoPerKey[tk]||0);
      await kvSet('settings', SETTINGS);
      SESSION.blocks.scales.technical = { done:true, ...entry };
      persistSession();
      logEvent('scales_technical_complete', entry);
      await transition('Scales · Modal', screenScalesModal);
    }
  });
}

// Inline audio control panel — used in scales screens (full) and piece blocks
// (compact: drone + metro side-by-side, no inline volumes — those live in the
// drawer when needed).
//   tonicPc — used for the long-press scale-degree picker. Defaults to dronePc.
function buildAudioPanel({ dronePc, droneLabel, onTempoChange, compact = false, showTempo = true, tonicPc = null }) {
  const wrap = el('div',{class: 'audio-panel' + (compact ? ' compact' : '')});
  const pickerTonic = tonicPc != null ? tonicPc : dronePc;

  const droneToggle = el('button',{class:'ap-toggle big-toggle ' + (SETTINGS.drone_on?'on':'off')}, [
    el('div',{class:'ap-label'}, 'Drone'),
    el('div',{class:'ap-value', id:'apDroneVal'}, droneLabel || ''),
    el('div',{class:'ap-state', id:'apDroneState'}, SETTINGS.drone_on ? 'ON' : 'OFF'),
  ]);

  // Generic long-press wrapper. Adds .longpress-active for visual ring
  // animation; on hold-completion runs onLong(); on release before the timer
  // fires, the next click on the element is treated normally.
  function attachLongPress(node, onLong) {
    let timer = null;
    let fired = false;
    let lastFiredAt = 0;
    node.addEventListener('pointerdown', () => {
      fired = false;
      node.classList.add('longpress-active');
      timer = setTimeout(async () => {
        timer = null;
        fired = true;
        lastFiredAt = Date.now();
        node.classList.remove('longpress-active');
        await onLong();
      }, 500);
    });
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      node.classList.remove('longpress-active');
    };
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('pointercancel', cancel);
    return { wasLong: () => fired && (Date.now() - lastFiredAt < 600), reset: () => { fired = false; } };
  }

  const droneLP = attachLongPress(droneToggle, async () => {
    if (pickerTonic == null) return;
    const startPc = (AUDIO.currentDronePc != null) ? AUDIO.currentDronePc : (dronePc != null ? dronePc : pickerTonic);
    const picked = await openDronePicker(startPc, pickerTonic);
    if (picked == null) return;
    SETTINGS.drone_on = true;
    kvSet('settings', SETTINGS);
    droneToggle.classList.add('on'); droneToggle.classList.remove('off');
    $('#apDroneState').textContent = 'ON';
    $('#apDroneVal').textContent = NOTE_NAMES[picked];
    AUDIO.startDrone(picked);
    if (picked !== startPc) {
      const fromName = NOTE_NAMES[startPc], toName = NOTE_NAMES[picked];
      const at = SESSION ? fmtMs(activeTimeNow()) : '';
      if (SESSION) {
        SESSION.notes.push({ block:'drone', text:`Drone changed from ${fromName} to ${toName}${at?' at '+at:''}`, time: Date.now() });
        persistSession();
      }
      logEvent('drone_pitch_change', { from: startPc, to: picked, fromName, toName });
    }
  });

  droneToggle.addEventListener('click', () => {
    if (droneLP.wasLong()) { droneLP.reset(); return; }
    SETTINGS.drone_on = !SETTINGS.drone_on; kvSet('settings', SETTINGS);
    droneToggle.classList.toggle('on', SETTINGS.drone_on);
    droneToggle.classList.toggle('off', !SETTINGS.drone_on);
    $('#apDroneState').textContent = SETTINGS.drone_on?'ON':'OFF';
    if (SETTINGS.drone_on && dronePc!=null) AUDIO.startDrone(dronePc); else AUDIO.fadeDrone(300);
    logEvent('drone_toggle', SETTINGS.drone_on);
  });

  const metroToggle = el('button',{class:'ap-toggle big-toggle ' + (SETTINGS.metro_on?'on':'off')}, [
    el('div',{class:'ap-label'}, 'Metronome'),
    el('span',{class:'metro-blink-dot', id:'metroBlinkDot'}),
    el('div',{class:'ap-state', id:'apMetroState'}, SETTINGS.metro_on ? 'ON' : 'OFF'),
  ]);
  const metroLP = attachLongPress(metroToggle, async () => { await openMetroControl(); });
  metroToggle.addEventListener('click', () => {
    if (metroLP.wasLong()) { metroLP.reset(); return; }
    SETTINGS.metro_on = !SETTINGS.metro_on; kvSet('settings', SETTINGS);
    metroToggle.classList.toggle('on', SETTINGS.metro_on);
    metroToggle.classList.toggle('off', !SETTINGS.metro_on);
    $('#apMetroState').textContent = SETTINGS.metro_on?'ON':'OFF';
    if (SETTINGS.metro_on && SESSION) AUDIO.startMetronome(SESSION.tempo); else AUDIO.stopMetronome();
    logEvent('metro_toggle', SETTINGS.metro_on);
  });

  if (compact) {
    // Side-by-side; no inline volume sliders (use drawer for vol).
    wrap.appendChild(el('div',{class:'ap-row'},[droneToggle, metroToggle]));
  } else {
    const droneVol = el('input',{type:'range',min:0,max:1,step:0.01, class:'ap-vol', 'aria-label':'Drone volume'});
    droneVol.value = SETTINGS.volumes.drone;
    droneVol.addEventListener('input', e => AUDIO.setVolume('drone', parseFloat(e.target.value)));
    droneVol.addEventListener('change', e => logEvent('drone_volume', parseFloat(e.target.value)));
    const metroVol = el('input',{type:'range',min:0,max:1,step:0.01,class:'ap-vol','aria-label':'Metronome volume'});
    metroVol.value = SETTINGS.volumes.metro;
    metroVol.addEventListener('input', e => AUDIO.setVolume('metro', parseFloat(e.target.value)));
    metroVol.addEventListener('change', e => logEvent('metro_volume', parseFloat(e.target.value)));
    wrap.appendChild(el('div',{class:'ap-row drone-row'},[
      droneToggle, el('div',{class:'ap-vol-wrap'},[el('div',{class:'ap-vol-label'},'Vol'), droneVol])
    ]));
    wrap.appendChild(el('div',{class:'ap-row metro-row'},[
      metroToggle, el('div',{class:'ap-vol-wrap'},[el('div',{class:'ap-vol-label'},'Vol'), metroVol])
    ]));
  }

  if (showTempo) {
    const tempoMinus = el('button',{class:'tempo-btn'}, '−');
    const tempoPlus  = el('button',{class:'tempo-btn'}, '+');
    const tempoVal = el('div',{class:'tempo-display', id:'tempoDisplay'}, `${SESSION?SESSION.tempo:60}`);
    const tempoLbl = el('div',{class:'tempo-label'}, 'BPM');
    function changeTempo(delta){
      if (!SESSION) return;
      SESSION.tempo = Math.max(30, Math.min(220, SESSION.tempo + delta));
      AUDIO.setBpm(SESSION.tempo);
      $('#tempoDisplay').textContent = SESSION.tempo;
      onTempoChange && onTempoChange(SESSION.tempo);
    }
    tempoMinus.addEventListener('click', ()=>changeTempo(-2));
    tempoPlus.addEventListener('click', ()=>changeTempo(+2));
    wrap.appendChild(el('div',{class:'ap-row tempo-row'},[
      tempoMinus,
      el('div',{class:'tempo-stack'},[tempoVal, tempoLbl]),
      tempoPlus,
    ]));
  }

  return wrap;
}

function openDrawer() {
  const d = $('#drawer');
  d.classList.remove('hidden');
  d.innerHTML = '';
  d.appendChild(el('div',{class:'row',style:'justify-content:space-between;'},[
    el('h2',{}, 'Audio'),
    el('button',{class:'ghost', onclick: ()=>d.classList.add('hidden')}, '✕'),
  ]));
  d.appendChild(el('div',{class:'stack',style:'margin-top:12px;'},[
    volumeRow('Drone','drone'),
    toggleRow('Drone on', 'drone_on', async v => { if (v && SESSION) { const info=weekInfo(); const dow=todayDow(); AUDIO.startDrone((info.rootPc+droneDegree(dow,info.minor))%12); } else AUDIO.fadeDrone(300); }),
    volumeRow('Metronome','metro'),
    toggleRow('Metronome on', 'metro_on', v => { if (v && SESSION) AUDIO.startMetronome(SESSION.tempo); else AUDIO.stopMetronome(); }),
    volumeRow('App volume','app'),
    el('div',{class:'rule'}),
    pickerRow('Drone sound','droneSound', ['tanpura','shruti','pad','sine'], async () => { AUDIO.droneBuffers = {}; if (SESSION && AUDIO.currentDronePc!=null) AUDIO.startDrone(AUDIO.currentDronePc); }),
    pickerRow('Metronome sound','metronomeSound', ['wood','cowbell','clave','beep','side']),
  ]));
}
function volumeRow(label, kind) {
  const r = el('div',{class:'stack'});
  r.appendChild(el('label',{}, label));
  const inp = el('input',{type:'range',min:0,max:1,step:0.01});
  inp.value = SETTINGS.volumes[kind];
  inp.addEventListener('input', e => AUDIO.setVolume(kind, parseFloat(e.target.value)));
  r.appendChild(inp);
  return r;
}
function toggleRow(label, settingKey, cb) {
  const cb_ = el('input',{type:'checkbox'});
  cb_.checked = SETTINGS[settingKey];
  cb_.addEventListener('change', e => { SETTINGS[settingKey] = e.target.checked; kvSet('settings', SETTINGS); cb && cb(e.target.checked); });
  return el('label',{class:'row',style:'gap:10px;'},[cb_, el('span',{}, label)]);
}
function pickerRow(label, key, options, cb) {
  const sel = el('select',{});
  options.forEach(o => { const op = el('option',{value:o}, o); if (SETTINGS[key]===o) op.selected=true; sel.appendChild(op); });
  sel.addEventListener('change', e => { SETTINGS[key] = e.target.value; kvSet('settings', SETTINGS); cb && cb(); });
  return el('div',{class:'stack'},[el('label',{}, label), sel]);
}

async function transition(nextLabel, nextFn) {
  pauseActiveClock();
  let advanced = false;
  function go(){ if (advanced) return; advanced = true; clearTimeout(autoT); startActiveClock(); nextFn(); }
  let autoT = null;
  renderSameColor(root => {
    root.appendChild(el('div',{class:'band-top'},[el('div',{},[el('div',{class:'eyebrow'},'Complete'), el('h1',{}, nextLabel)])]));
    const body = el('div',{class:'body',style:'justify-content:center;align-items:center;'});
    root.appendChild(body);
    const sv = document.createElementNS('http://www.w3.org/2000/svg','svg');
    sv.setAttribute('viewBox','0 0 64 64'); sv.setAttribute('class','checkmark');
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d','M10 34 L26 50 L54 14');
    sv.appendChild(p);
    body.appendChild(sv);
    const noteBtn = el('button',{class:'chip'}, 'Add note');
    noteBtn.addEventListener('click', async () => {
      const ta = el('textarea',{placeholder:'A quick note about that block…',style:'min-height:120px;'});
      const wrap = el('div',{}); wrap.appendChild(ta);
      const v = await modal({title:'Add note', content: wrap, buttons:[{label:'Cancel',value:false},{label:'Save',value:true,primary:true}]});
      if (v && ta.value.trim()) { SESSION.notes.push({time:Date.now(), text: ta.value.trim(), block:'transition'}); persistSession(); toast('Saved'); }
    });
    root.appendChild(el('div',{class:'band-bottom'},[
      noteBtn,
      el('button',{class:'big primary', onclick: go}, [el('span',{class:'inner'}, 'Continue')]),
    ]));
    autoT = setTimeout(go, 2200);
  });
}

// ---------- Scales — Modal ----------
function modalStepsFor(info, dow, light) {
  const m = dayModalFocus(dow, info.minor);
  const rootPc = (info.rootPc + m.shift) % 12;
  const modeIntervals = SCALE[m.mode];
  const modeInfo = MODE_INFO[m.mode];
  const scale = scaleNotesFromRoot(rootPc, modeIntervals, 3, 3);
  const cellNotes = modeInfo.cell.map(iv => {
    const pc = (rootPc + iv + 12) % 12;
    const oct = 4 + Math.floor((rootPc+iv)/12);
    return {pc, octave:oct, name:NOTE_NAMES[pc]};
  });
  const tonicTriadInts = modeInfo.tonic==='I' ? [0,4,7,12] : modeInfo.tonic==='i' ? [0,3,7,12] : [0,3,6,12];
  const tonicArp = [];
  for (let o=0;o<2;o++) tonicTriadInts.forEach(iv => tonicArp.push({pc:(rootPc+iv)%12, octave:4+o+Math.floor((rootPc+iv)/12), name:NOTE_NAMES[(rootPc+iv)%12]}));
  const charArp = modeInfo.chIntv.map(iv => ({pc:(rootPc+iv)%12, octave:4+Math.floor((rootPc+iv)/12), name:NOTE_NAMES[(rootPc+iv)%12]}));
  const charDegPc = (rootPc + modeIntervals[modeInfo.charIdx>=0?modeInfo.charIdx:0])%12;
  const mul = light ? 0.5 : 1;
  return {
    modeName: `${NOTE_NAMES[rootPc]} ${m.mode}`,
    modeNotes: modeIntervals.map(iv => NOTE_NAMES[(rootPc+iv)%12]),
    charDegreeNote: NOTE_NAMES[charDegPc],
    charDegreeText: modeInfo.charDeg,
    cellNotes, scale, tonicArp, charArp,
    tonicTriadLabel: `${NOTE_NAMES[rootPc]} ${modeInfo.tonic}`,
    charChordLabel: modeInfo.chChord,
    dronePc: rootPc,
    steps: [
      { title:'Scale up/down', sub:`${NOTE_NAMES[rootPc]} ${m.mode}, 3 oct`, notes:scale, durMs: Math.round(60000*mul) },
      { title:'Characteristic degree + scaffold cell', sub:`${NOTE_NAMES[charDegPc]} (${modeInfo.charDeg})`, notes:cellNotes, durMs: Math.round(60000*mul) },
      { title:'Tonic arp ↔ characteristic arp', sub:`${NOTE_NAMES[rootPc]} tonic vs ${modeInfo.chChord}`, notes:tonicArp.concat(charArp), durMs: Math.round(60000*mul) },
      { title:'Free improvisation', sub:'Drone continues, metronome stops', notes:[], durMs: Math.round(60000*mul), freeImprov:true },
    ],
  };
}

function screenScalesModal() {
  CURRENT_SCREEN = 'scales_modal';
  render(async (root) => {
    const info = weekInfo();
    const rawDow = todayDow();
    const dow = (rawDow<1 || rawDow>5) ? 5 : rawDow;
    const data = modalStepsFor(info, dow, SESSION.light);
    const steps = data.steps;
    let stepIdx = -1;
    let stepStart = 0;
    const stepTimes = [];
    let stepTickT = null;
    let started = false;
    logEvent('scales_modal_open', { mode: data.modeName });

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'},'Scales · Modal'),
        el('h1',{}, data.modeName),
      ]),
      el('div',{class:'step-counter', id:'stepCounter'}, `– / ${steps.length}`),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);

    body.appendChild(buildAudioPanel({ dronePc: data.dronePc, droneLabel: NOTE_NAMES[data.dronePc], compact: true, onTempoChange: bpm => logEvent('tempo_change', bpm) }));

    // Retune drone to the mode tonic the moment this screen renders, not
    // waiting for the user to tap Start. Otherwise the panel reads "Drone · C"
    // while the technical block's pitch (e.g. F# on Tue minor) is still
    // sounding — a real intonation hazard called out in session-1 feedback.
    // Spec: modal drone is always on the mode's tonic.
    if (SETTINGS.drone_on && SESSION && AUDIO.ctx) {
      AUDIO.startDrone(data.dronePc);
    }

    body.appendChild(el('div',{class:'meta-row'},[
      el('div',{class:'meta-item'},[
        el('div',{class:'meta-label'}, 'Mode notes'),
        el('div',{class:'meta-value'}, data.modeNotes.join('  ')),
      ]),
      el('div',{class:'meta-item'},[
        el('div',{class:'meta-label'}, 'Characteristic'),
        el('div',{class:'meta-value'}, `${data.charDegreeNote} — ${data.charDegreeText}`),
      ]),
      el('div',{class:'meta-item'},[
        el('div',{class:'meta-label'}, 'Tonic / characteristic chord'),
        el('div',{class:'meta-value'}, `${data.tonicTriadLabel}  ·  ${data.charChordLabel}`),
      ]),
    ]));

    const stepTitle = el('h2',{id:'stepTitle', class:'step-title'}, 'Ready when you are');
    const stepSub = el('p',{id:'stepSub',class:'dim step-sub'}, 'Tap Start to begin.');
    body.appendChild(stepTitle); body.appendChild(stepSub);
    const noteLine = el('div',{class:'note-line', id:'noteLine'}, '');
    body.appendChild(noteLine);
    const stepClock = el('div',{class:'step-clock', id:'stepClock'}, '');
    body.appendChild(stepClock);

    const startBtn = el('button',{class:'big primary'}, [el('span',{class:'inner', id:'startInner'}, 'Start')]);
    startBtn.addEventListener('click', () => { if (!started) begin(); else nextStep(); });
    const noteBtn = el('button',{class:'chip', onclick: () => dropStepNote('scales-modal', { stepIdx, stepTitle: steps[stepIdx]?.title, mode: data.modeName })}, '+ Note');
    const recBtn = el('button',{class:'chip record-button', onclick: toggleRecord}, 'Record');
    root.appendChild(el('div',{class:'band-bottom'},[startBtn, noteBtn, recBtn]));

    function tick(){
      if (stepIdx<0) return;
      const elapsed = Date.now() - stepStart;
      const target = (steps[stepIdx].durMs||60000);
      const over = elapsed >= target;
      $('#stepClock').textContent = `${fmtSec(elapsed/1000)}  ·  target ${fmtSec(target/1000)}`;
      $('#stepClock').classList.toggle('reached', over);
      stepTickT = setTimeout(tick, 250);
    }
    function showStep(i){
      stepIdx = i; stepStart = Date.now();
      const s = steps[i];
      $('#stepCounter').textContent = `${i+1} / ${steps.length}`;
      $('#stepTitle').textContent = s.title;
      $('#stepSub').textContent = s.sub;
      if (s.freeImprov) {
        AUDIO.stopMetronome();
        $('#noteLine').textContent = 'Free improvisation — make the mode sound.';
      } else {
        $('#noteLine').textContent = notesAsLine(s.notes);
      }
      $('#startInner').textContent = (i === steps.length-1) ? 'Finish' : 'Next';
      logEvent('modal_step_start', { i, title: s.title });
      clearTimeout(stepTickT); tick();
    }
    function nextStep(){
      const ms = Date.now() - stepStart;
      stepTimes[stepIdx] = ms;
      logEvent('modal_step_done', { i: stepIdx, ms });
      if (stepIdx >= steps.length-1) return finish();
      AUDIO.chime();
      showStep(stepIdx+1);
    }
    async function begin(){
      started = true;
      await AUDIO.resume();
      if (SETTINGS.drone_on) await AUDIO.startDrone(data.dronePc);
      if (SETTINGS.metro_on) AUDIO.startMetronome(SESSION.tempo);
      logEvent('scales_modal_begin', { mode: data.modeName });
      showStep(0);
    }
    async function finish(){
      clearTimeout(stepTickT);
      AUDIO.stopMetronome();
      AUDIO.fadeDrone(500);
      SESSION.blocks.scales.modal = { done:true, mode: data.modeName, stepTimesMs: stepTimes };
      persistSession();
      logEvent('scales_modal_complete', { stepTimes });
      await transition('Scales · Chord-scale', screenScalesChordScale);
    }
  });
}

// ---------- Scales — Chord-scale ----------
function screenScalesChordScale() {
  CURRENT_SCREEN = 'scales_chordscale';
  render(async (root) => {
    const info = weekInfo();
    const rawDow = todayDow();
    const dow = (rawDow<1 || rawDow>5) ? 5 : rawDow;
    const prog = dayChordProgression(dow, info.minor, info.rootPc);
    const progKey = 'progBars_' + prog.label;
    let barsPerChord = SETTINGS[progKey] || 4;
    let loopTempo = SETTINGS.chordLoopTempo || 72;
    let chordIdx = 0;
    let elapsedSec = 0;
    let mainTimer = null;
    let chordTimer = null;
    let running = false, paused = false, finished = false;
    const isModal = prog.bars.length === 1;
    logEvent('chordscale_open', { prog: prog.label, modal: isModal });

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, 'Chord-scale'),
        el('h1',{}, prog.label),
      ]),
      el('div',{class:'step-counter', id:'csClock'}, '0:00'),
    ]));

    const body = el('div',{class:'body stack'}); root.appendChild(body);

    // State strip — replaces the wordy intro after Start. Loop counter +
    // current instruction (Listen on loop 1, Improvise after).
    const stateStrip = el('div',{class:'cs-state', id:'csState'}, [
      el('div',{class:'cs-state-loop', id:'csLoopLbl'}, isModal ? 'Modal vamp · sustained' : 'Functional · pulsed each bar'),
      el('div',{class:'cs-state-instr', id:'csInstr'}, 'Tap Start · 1 listen-loop, then improvise'),
    ]);
    body.appendChild(stateStrip);

    // Audio + tempo controls (chord-loop tempo, separate from session metronome)
    const ctrl = el('div',{class:'cs-controls'});
    const tempoBlock = el('div',{class:'tempo-stack cs-tempo'},[
      el('div',{class:'tempo-display', id:'csTempo'}, String(loopTempo)),
      el('div',{class:'tempo-label'}, 'BPM · loop'),
    ]);
    const tMinus = el('button',{class:'tempo-btn'}, '−');
    const tPlus  = el('button',{class:'tempo-btn'}, '+');
    tMinus.addEventListener('click', ()=>{ loopTempo = Math.max(40, loopTempo-2); SETTINGS.chordLoopTempo = loopTempo; kvSet('settings', SETTINGS); $('#csTempo').textContent = loopTempo; AUDIO.setBpm(loopTempo); });
    tPlus .addEventListener('click', ()=>{ loopTempo = Math.min(180, loopTempo+2); SETTINGS.chordLoopTempo = loopTempo; kvSet('settings', SETTINGS); $('#csTempo').textContent = loopTempo; AUDIO.setBpm(loopTempo); });
    ctrl.appendChild(el('div',{class:'cs-tempo-row'},[tMinus, tempoBlock, tPlus]));

    // Bars per chord — pacing of chord changes, not loop count. Hint clarifies
    // since session-1 feedback flagged the ambiguity.
    const bpcRow = el('div',{class:'cs-bpc'},[
      el('div',{class:'menu-eyebrow'}, 'Bars per chord — chord-change pacing'),
      el('div',{class:'row wrap', id:'bpcRow'},
        [1,2,4,8].map(n => {
          const b = el('button',{class:'chip ' + (n===barsPerChord?'primary':'')}, [el('span',{class:'inner'}, String(n))]);
          b.addEventListener('click', () => {
            barsPerChord = n; SETTINGS[progKey] = n; kvSet('settings', SETTINGS);
            Array.from($('#bpcRow').children).forEach(c=>c.classList.remove('primary'));
            b.classList.add('primary');
            logEvent('chordscale_bpc', n);
          });
          return b;
        })
      ),
    ]);
    ctrl.appendChild(bpcRow);
    body.appendChild(ctrl);

    // Now playing card — big
    const np = el('div',{class:'cs-now'}, [
      el('div',{class:'menu-eyebrow'}, 'Now playing'),
      el('div',{class:'cs-chord', id:'csChord'}, prog.bars[0].chord),
      el('div',{class:'cs-roman', id:'csRoman'}, prog.bars[0].roman || ''),
      el('div',{class:'cs-scale', id:'csScale'}, ''),
      el('div',{class:'note-line', id:'csNotes'}, ''),
    ]);
    body.appendChild(np);

    // Progression chart — chord + roman beneath each
    if (!isModal) {
      const chart = el('div',{class:'chord-chart pretty', id:'csChart'});
      prog.bars.forEach((bar,i) => {
        chart.appendChild(el('div',{class:'chord' + (i===0?' active':''), 'data-i':i},[
          el('div',{class:'chord-name'}, bar.chord),
          el('div',{class:'chord-roman'}, bar.roman || ''),
        ]));
      });
      body.appendChild(el('div',{class:'cs-chart-wrap'},[
        el('div',{class:'menu-eyebrow'}, 'Progression'),
        chart,
      ]));
    }

    // Bottom controls
    const startBtn = el('button',{class:'big primary'}, [el('span',{class:'inner', id:'csStartLbl'}, 'Start')]);
    const doneBtn  = el('button',{class:'chip'}, 'Done');
    const recBtn   = el('button',{class:'chip record-button', onclick: toggleRecord}, 'Record');
    startBtn.addEventListener('click', () => {
      if (finished) return;
      if (!running) begin();
      else togglePause();
    });
    doneBtn.addEventListener('click', async () => {
      if (finished) return;
      const ok = await askConfirm('Done with chord-scale?', 'Stop the loop and continue to the next block.', {okLabel:'Done', cancelLabel:'Keep going'});
      if (ok) finish();
    });
    root.appendChild(el('div',{class:'band-bottom'},[startBtn, doneBtn, recBtn]));

    function refreshChord(){
      const i = chordIdx % prog.bars.length;
      const bar = prog.bars[i];
      const chordEl = $('#csChord');
      chordEl.textContent = bar.chord;
      // Pulse the now-playing chord text on each change.
      chordEl.classList.remove('just-changed');
      void chordEl.offsetWidth; // force reflow so animation re-fires
      chordEl.classList.add('just-changed');
      const romanEl = $('#csRoman'); if (romanEl) romanEl.textContent = bar.roman || '';
      $('#csScale').textContent = bar.scale.name;
      $('#csNotes').textContent = bar.scale.notes.join('  ');
      const chartEl = $('#csChart');
      if (chartEl) {
        Array.from(chartEl.children).forEach((n, idx) => {
          n.classList.remove('active','next','just-changed');
          if (idx === i) n.classList.add('active');
          if (idx === (i+1) % prog.bars.length) n.classList.add('next');
        });
        const activeEl = chartEl.children[i];
        if (activeEl) {
          void activeEl.offsetWidth;
          activeEl.classList.add('just-changed');
        }
      }
    }
    refreshChord();
    function refreshLoopLabel(loopIdx){
      const lbl = $('#csLoopLbl'); const ins = $('#csInstr');
      if (lbl) lbl.textContent = `Loop ${loopIdx+1}${isModal?' · sustained vamp':' · pulsed comping'}`;
      if (ins) ins.textContent = loopIdx === 0 ? 'Listen — don\'t play. Hear where the changes fall.' : 'Improvise — clean scale switches across the bar lines.';
    }

    async function begin(){
      running = true; paused = false;
      await AUDIO.resume();
      AUDIO.fadeDrone(200);
      AUDIO.resetChordVoicing(); // start voice leading fresh
      AUDIO.startMetronome(loopTempo); // chord-scale block always wants a click
      $('#csStartLbl').textContent = 'Pause';
      logEvent('chordscale_begin', { tempo: loopTempo, bpc: barsPerChord });

      const secPerBar = 60/loopTempo * 4;
      const barsPerLoop = prog.bars.length * barsPerChord;
      let nextBarAt = AUDIO.ctx.currentTime + 0.25;
      let bar = 0;
      let lastLoopIdx = -1;
      refreshLoopLabel(0);
      function sched() {
        if (!running || paused || finished) return;
        while (nextBarAt < AUDIO.ctx.currentTime + 0.6) {
          const ci = Math.floor(bar / barsPerChord) % prog.bars.length;
          const chord = prog.bars[ci];
          // Functional progression: pulse the chord on every bar — feel the
          // harmonic rhythm. Modal vamp: schedule once per chord (which for
          // a 1-chord vamp = once per loop), let the new envelope sustain.
          if (isModal) {
            if (bar % barsPerChord === 0) {
              AUDIO.playChord(chord.root, chord.tones, nextBarAt, secPerBar * barsPerChord * 0.98, true);
            }
          } else {
            AUDIO.playChord(chord.root, chord.tones, nextBarAt, secPerBar * 0.92, false);
          }
          // Visual chord update synced to audio playback time, not the
          // pre-scheduling moment — otherwise the chart races ahead. Capture
          // the current bar/loop index in the closure so the callback uses
          // values from when the chord was scheduled, not from after `bar`
          // has advanced inside the while loop.
          const playAtMs = (nextBarAt - AUDIO.ctx.currentTime) * 1000;
          if (bar % barsPerChord === 0) {
            const loopIdxAtSched = Math.floor(bar / barsPerLoop);
            const ciAtSched = ci;
            setTimeout(() => {
              if (!running || paused || finished) return;
              chordIdx = ciAtSched;
              refreshChord();
              if (loopIdxAtSched !== lastLoopIdx) {
                lastLoopIdx = loopIdxAtSched;
                refreshLoopLabel(loopIdxAtSched);
              }
            }, Math.max(0, playAtMs));
          }
          nextBarAt += secPerBar;
          bar++;
        }
        chordTimer = setTimeout(sched, 80);
      }
      sched();
      mainTimer = setInterval(() => {
        if (paused || finished) return;
        elapsedSec += 1;
        $('#csClock').textContent = fmtSec(elapsedSec);
      }, 1000);
    }
    function togglePause(){
      paused = !paused;
      $('#csStartLbl').textContent = paused ? 'Resume' : 'Pause';
      if (paused) AUDIO.stopMetronome();
      else AUDIO.startMetronome(loopTempo);
      logEvent('chordscale_pause', paused);
    }
    function finish(){
      if (finished) return;
      finished = true;
      clearInterval(mainTimer); clearTimeout(chordTimer);
      AUDIO.fadeDrone(200);
      AUDIO.stopMetronome();
      SESSION.blocks.scales.chordscale = {done:true, progression: prog.label, secs: elapsedSec};
      persistSession();
      logEvent('chordscale_complete', { secs: elapsedSec });
      transition('Adagio', screenAdagio);
    }
  });
}

// ---------- Adagio / Fuga (piece blocks) ----------
function screenAdagio(){ screenPieceBlock('adagio', SETTINGS.piece1, 6*60, screenFuga); }
function screenFuga(){ screenPieceBlock('fuga', SETTINGS.piece2, 12*60, screenImprov); }

function currentChunkLabel(piece) {
  const a = piece.currentStart, b = Math.min(piece.totalMeasures, a + piece.chunkSize - 1);
  return `mm. ${a}–${b}`;
}
async function chunkNotes(pieceKey, label) {
  const id = pieceKey + ':' + label;
  const rec = await idbGet('chunks', id);
  return rec?.notes || [];
}
async function addChunkNote(pieceKey, label, note) {
  const id = pieceKey + ':' + label;
  const rec = (await idbGet('chunks', id)) || { id, pieceKey, label, notes:[] };
  rec.notes.push({...note, time: Date.now(), date: isoDate()});
  await idbSet('chunks', null, rec);
}
function advanceChunk(piece) {
  // +chunk-1 step (overlap 1)
  piece.currentStart = Math.min(piece.totalMeasures, piece.currentStart + piece.chunkSize - 1);
}

function screenPieceBlock(pieceKey, piece, durSec, nextFn) {
  CURRENT_SCREEN = pieceKey;
  durSec = SESSION.light ? durSec/2 : durSec;
  render(async (root) => {
    const chunkLabel = currentChunkLabel(piece);
    const prior = (await chunkNotes(pieceKey, chunkLabel)).slice(-3).reverse();
    const droneRoot = piece.referenceDrone;
    const dronePc = (droneRoot && NOTE_TO_PC[droneRoot]!=null) ? NOTE_TO_PC[droneRoot] : null;
    let remaining = durSec;
    let runTimer = null;
    let running = false;
    let finished = false;

    // Spec: Adagio/Fuga default to drone OFF, metro OFF. Sync the SETTINGS
    // toggles to the actual audio state on entry — otherwise the panel reads
    // "ON" while nothing is sounding (carry-over from the scales block where
    // fadeDrone silenced things).
    if (!AUDIO.droneNode && SETTINGS.drone_on) SETTINGS.drone_on = false;
    if (!AUDIO.metroPlaying && SETTINGS.metro_on) SETTINGS.metro_on = false;

    logEvent(pieceKey+'_open', { chunk: chunkLabel, durSec });

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, pieceKey.toUpperCase() + (pieceKey==='fuga' && piece.voices?` · ${piece.voices} voices`:'')),
        el('h1',{}, `${piece.name} · ${chunkLabel}`),
      ]),
      el('div',{class:'timer', id:'timer'}, fmtSec(remaining)),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);

    body.appendChild(buildAudioPanel({
      dronePc,
      droneLabel: droneRoot || '',
      onTempoChange: bpm => logEvent('tempo_change', { bpm, block: pieceKey }),
      compact: true,
    }));

    if (prior.length) {
      const list = el('ul',{class:'bare stack piece-notes'});
      prior.forEach(n => list.appendChild(el('li',{class:'row',style:'gap:8px;align-items:flex-start;'},[
        el('span',{class:'note-tag ' + (n.tag||'')}, (n.tag||'note').slice(0,8)),
        el('span',{class:'piece-note-text'}, `${n.date.slice(5)} — ${n.text}`)
      ])));
      body.appendChild(list);
      body.appendChild(el('button',{class:'chip', style:'align-self:flex-start;', onclick: async ()=>{
        const all = await chunkNotes(pieceKey, chunkLabel);
        const txt = all.map(n=>`${n.date} [${n.tag||'note'}]: ${n.text}`).join('\n\n') || 'No notes.';
        const pre = el('pre',{style:'white-space:pre-wrap;font:inherit;font-size:14px;max-height:50vh;overflow:auto;'}, txt);
        await modal({ title:'All notes', content: pre, buttons:[{label:'Close', value:true, primary:true}] });
      }}, 'Show all'));
    } else {
      body.appendChild(el('p',{class:'dim',style:'font-size:13px;'}, 'No prior notes on this chunk.'));
    }

    const startBtn = el('button',{class:'big primary'}, [el('span',{class:'inner'}, 'Start')]);
    const endBtn = el('button',{class:'chip'}, 'End early');
    startBtn.addEventListener('click', () => {
      if (finished) return;
      if (!running) { go(); }
      else { pauseToggle(); }
    });
    endBtn.addEventListener('click', async () => {
      if (finished) return;
      const ok = await askConfirm('End early?', 'Stop the timer and move to today\'s wrap-up.', {okLabel:'End', cancelLabel:'Keep going'});
      if (ok) { remaining = 0; tickOnce(); }
    });
    root.appendChild(el('div',{class:'band-bottom'},[startBtn, endBtn]));

    let paused = false;
    function pauseToggle(){
      paused = !paused;
      startBtn.querySelector('.inner').textContent = paused ? 'Resume' : 'Pause';
      logEvent(pieceKey+'_pause_toggle', paused);
    }
    function tickOnce(){
      if (finished) return;
      if (paused) return;
      remaining -= 1;
      $('#timer').textContent = fmtSec(remaining);
      if (remaining <= 0) { clearInterval(runTimer); runTimer = null; running = false; finish(); }
    }
    async function go() {
      if (running || finished) return; // hard guard against double-start
      running = true;
      startBtn.querySelector('.inner').textContent = 'Pause';
      logEvent(pieceKey+'_start', { remaining });
      runTimer = setInterval(tickOnce, 1000);
    }
    async function finish() {
      if (finished) return;
      finished = true;
      if (runTimer) { clearInterval(runTimer); runTimer = null; }
      AUDIO.fadeDrone(200); AUDIO.stopMetronome();
      logEvent(pieceKey+'_timer_done', { chunk: chunkLabel });
      // Hand off to a clean wrap-up screen — no popups.
      screenPieceWrapUp(pieceKey, piece, chunkLabel, nextFn);
    }
  });
}

// ---------- Piece wrap-up (replaces popups) ----------
function screenPieceWrapUp(pieceKey, piece, chunkLabel, nextFn){
  CURRENT_SCREEN = pieceKey + '_wrapup';
  let recorded = false;
  let recording = false;
  let recBlobMeta = null;
  render(root => {
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, pieceKey.toUpperCase() + ' · WRAP-UP'),
        el('h1',{}, `${piece.name} · ${chunkLabel}`),
      ]),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);

    // Record today's work
    body.appendChild(el('div',{class:'menu-eyebrow'}, 'Recording'));
    const recBtn = el('button',{class:'big-toggle ap-toggle off',style:'min-height:84px;width:100%;'},[
      el('div',{class:'ap-label'}, 'Record today\'s work'),
      el('div',{class:'ap-value', id:'recVal'}, 'Tap to start · ~30s'),
      el('div',{class:'ap-state', id:'recState'}, 'IDLE'),
    ]);
    recBtn.addEventListener('click', async () => {
      if (!recording && !recorded) {
        const ok = await startRecording({ block: pieceKey, chunk: chunkLabel, date: isoDate() });
        if (!ok) { toast('Mic denied'); return; }
        recording = true;
        recBtn.classList.remove('off'); recBtn.classList.add('on');
        $('#recState').textContent = 'REC';
        $('#recVal').textContent = 'Tap to stop';
        logEvent('piece_record_start', { pieceKey });
      } else if (recording) {
        const rec = await stopRecording();
        recording = false; recorded = true;
        recBlobMeta = rec;
        recBtn.classList.remove('on'); recBtn.classList.add('done');
        $('#recState').textContent = 'SAVED';
        $('#recVal').textContent = `Saved · ${fmtSec(rec?.durationSec||0)}`;
        logEvent('piece_record_stop', { pieceKey, dur: rec?.durationSec });
      }
    });
    body.appendChild(recBtn);

    // Notes
    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:8px;'}, 'Notes'));
    const ta = el('textarea',{placeholder:'What worked, what didn\'t, what to revisit…', style:'min-height:120px;'});
    body.appendChild(ta);

    // Tag
    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:8px;'}, 'Tag'));
    let tag = 'neutral';
    const tagRow = el('div',{class:'row wrap', style:'gap:10px;'});
    ['worked','didn\'t','neutral'].forEach(t => {
      const b = el('button',{class:'chip ' + (t===tag?'primary':'')}, [el('span',{class:'inner'}, t)]);
      b.addEventListener('click', ()=>{
        tag = t;
        Array.from(tagRow.children).forEach(c=>c.classList.remove('primary'));
        b.classList.add('primary');
      });
      tagRow.appendChild(b);
    });
    body.appendChild(tagRow);

    // Mastered toggle
    let mastered = false;
    const mastWrap = el('label',{class:'row',style:'gap:10px;margin-top:12px;'});
    const cb = el('input',{type:'checkbox', style:'width:22px;height:22px;min-height:0;padding:0;border-width:0;appearance:auto;-webkit-appearance:checkbox;'});
    cb.addEventListener('change', e => mastered = e.target.checked);
    mastWrap.appendChild(cb);
    mastWrap.appendChild(el('span',{}, 'Mastered this chunk — advance to next chunk'));
    body.appendChild(mastWrap);

    // Save button
    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: save}, [el('span',{class:'inner'}, `Save · continue to ${pieceKey==='adagio'?'Fuga':'Improv'}`)]),
    ]));

    async function save(){
      const note = ta.value.trim();
      if (!note) {
        await modal({title:'Notes required', message:'Add at least one short note before continuing.', buttons:[{label:'OK',value:true,primary:true}]});
        ta.focus();
        return;
      }
      // Stop any in-progress rec on save
      if (recording) { try { await stopRecording(); } catch(e){} recorded = true; }
      await addChunkNote(pieceKey, chunkLabel, { text: note, tag });
      if (mastered) { advanceChunk(piece); await kvSet('settings', SETTINGS); }
      SESSION.blocks[pieceKey] = { done:true, chunk: chunkLabel, mastered, recorded };
      persistSession();
      logEvent(pieceKey+'_wrapup_save', { mastered, recorded, tag });
      transition(pieceKey==='adagio'?'Fuga':'Improv', nextFn);
    }
  });
}

// ---------- Improv ----------
function isSundayLong(dow){ return dow === 0; }
function isSystemDay(dow) {
  if (dow === 4) return false; // Thu acoustic
  if (dow === 0) {
    // Sunday alternates
    const wk = weekInfo();
    return wk.weekNum % 2 === 1;
  }
  return true;
}
function screenImprov() {
  CURRENT_SCREEN = 'improv';
  render(async (root) => {
    const dow = todayDow();
    const system = isSystemDay(dow);
    const longSession = isSundayLong(dow);
    const info = weekInfo();
    let durSec = (longSession ? 30*60 : 15*60);
    if (SESSION.light) durSec /= 2;
    let remaining = durSec;
    let timerId = null;
    let started = false, paused = false, finished = false;

    let patches = await idbAll('patches');
    let patch = patches[patches.length-1];
    if (system && !patch) {
      const ta = el('textarea',{placeholder:'delay, feedback, modulations, signal flow…',style:'min-height:160px;'});
      const wrap = el('div',{}); wrap.appendChild(ta);
      const v = await modal({ title:'Describe your patch', message:'You can edit this any time.', content: wrap, buttons:[{label:'Skip', value:false},{label:'Save', value:true, primary:true}] });
      const text = (v && ta.value.trim()) || 'initial patch';
      patch = { version: 1, text, created: isoDate(), sessionsCount: 0 };
      await idbSet('patches', null, patch);
      patches = await idbAll('patches');
      patch = patches[patches.length-1];
    }
    const acousticConstraint = SETTINGS.acousticConstraints[SETTINGS.acousticIdx % SETTINGS.acousticConstraints.length];
    const modFoc = dayModalFocus(dow<1||dow>5?1:dow, info.minor);
    const ambient = `This week: ${info.rootName}${info.minor?' minor':' major'}, ${modFoc.mode} today`;

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, `Improv · ${system?'System':'Acoustic'}${longSession?' · Long session':''}`),
        el('h1',{}, system ? `Patch v${patch?.version||1}` : 'Acoustic'),
      ]),
      el('div',{class:'timer',id:'timer'}, fmtSec(remaining)),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    if (system) {
      body.appendChild(el('div',{class:'meta-item'},[
        el('div',{class:'meta-label'}, 'Patch'),
        el('div',{class:'meta-value', id:'patchText'}, patch?.text||''),
      ]));
      body.appendChild(el('p',{class:'dim'}, `Session ${(patch?.sessionsCount||0)+1} of this patch — transparent yet?`));
      body.appendChild(el('p',{class:'dim'}, 'Secondary constraint: ' + secondaryConstraint(dow, info.weekNum)));
      body.appendChild(el('button',{class:'chip', onclick: async ()=>{
        const ta = el('textarea',{style:'min-height:140px;'}); ta.value = patch.text;
        const wrap = el('div',{}); wrap.appendChild(ta);
        const v = await modal({title:'Edit patch', message:'Saves as a new version.', content: wrap, buttons:[{label:'Cancel',value:false},{label:'Save',value:true,primary:true}]});
        if (v && ta.value.trim()) { patch = { version: patches.length+1, text: ta.value.trim(), created: isoDate(), sessionsCount: 0 }; await idbSet('patches', null, patch); $('#patchText').textContent = patch.text; toast('Patch v'+patch.version+' saved'); }
      }}, 'Edit patch'));
    } else {
      body.appendChild(el('h2',{class:'step-title'}, acousticConstraint));
      body.appendChild(el('button',{class:'chip', onclick: ()=>{ SETTINGS.acousticIdx++; kvSet('settings',SETTINGS); screenImprov(); }}, 'Rotate constraint'));
    }
    body.appendChild(el('p',{class:'dim'}, ambient));

    const today = isoDate();
    let lastWrap = null;
    try {
      const sessions = (await idbAll('sessions')).filter(s => s && s.date && s.date < today && s.blocks?.improv?.done);
      sessions.sort((a,b)=>b.date.localeCompare(a.date));
      for (const s of sessions) {
        const w = (s.notes||[]).filter(n=>n.block==='improv_wrap').sort((a,b)=>(b.time||0)-(a.time||0))[0];
        if (w?.text) { lastWrap = { date: s.date, text: w.text, tag: w.tag, feeling: w.feeling, focus: w.focus }; break; }
      }
      if (!lastWrap) {
        const recs = (await idbAll('recordings')).filter(r => r.block==='improv' && r.date && r.date < today);
        recs.sort((a,b)=>(b.id||'').localeCompare(a.id||''));
        for (const r of recs) {
          const wrap = (r.annotations||[]).find(a => a && a.atSec==null && a.text);
          if (wrap) { lastWrap = { date: r.date, text: wrap.text, tag: wrap.tag, feeling: r.feeling, focus: r.focus }; break; }
        }
      }
    } catch {}
    if (lastWrap) {
      const meta = [`Last improv · ${lastWrap.date}`];
      if (lastWrap.tag) meta.push(lastWrap.tag);
      if (lastWrap.feeling) meta.push(`feel ${lastWrap.feeling}`);
      if (lastWrap.focus) meta.push(`focus ${lastWrap.focus}`);
      body.appendChild(el('div',{class:'meta-item'},[
        el('div',{class:'meta-label'}, meta.join(' · ')),
        el('div',{class:'meta-value', style:'white-space:pre-wrap; font-size:14px; line-height:1.5;'}, lastWrap.text),
      ]));
    }

    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:8px;'}, 'Notes captured'));
    const notesList = el('div',{class:'list', id:'notes'}); body.appendChild(notesList);

    const startBtn = el('button',{class:'big primary'}, [el('span',{class:'inner', id:'impStartLbl'}, 'Setup ready · Start')]);
    const noteBtn = el('button',{class:'chip', id:'noteBtn', disabled:true}, '+ Note');
    const recBtn  = el('button',{class:'chip', id:'impRecBtn'}, 'Record');
    const doneBtn = el('button',{class:'chip'}, 'Done');
    startBtn.addEventListener('click', () => {
      if (finished) return;
      if (!started) go();
      else { paused = !paused; $('#impStartLbl').textContent = paused?'Resume':'Pause'; logEvent('improv_pause', paused); }
    });
    noteBtn.addEventListener('click', dropNote);
    // Manual record toggle. Auto-recording was removed in response to
    // session-1 feedback: the user wants control over when capture starts —
    // setup time, false starts, and bow-noise warm-ups shouldn't end up in
    // the recording.
    recBtn.addEventListener('click', async () => {
      if (!started) { toast('Tap Setup ready · Start first.'); return; }
      if (RECORDER && RECORDER.state === 'recording') {
        const r = await stopRecording();
        recBtn.textContent = 'Record';
        recBtn.classList.remove('recording');
        toast('Saved ' + fmtSec(r?.durationSec || 0));
      } else {
        const ok = await startRecording({ block:'improv', system, patchVersion: patch?.version, date: isoDate(), longSession, constraint: system ? null : acousticConstraint });
        if (ok) {
          recBtn.textContent = 'Stop';
          recBtn.classList.add('recording');
          toast('Recording…');
        } else {
          toast('Mic denied');
        }
      }
    });
    doneBtn.addEventListener('click', async () => {
      if (finished) return;
      const ok = await askConfirm('End improv early?', 'Stop the timer and go to wrap-up.', {okLabel:'End',cancelLabel:'Keep going'});
      if (ok) { remaining = 0; if (timerId) clearInterval(timerId); finish(); }
    });
    root.appendChild(el('div',{class:'band-bottom'},[startBtn, noteBtn, recBtn, doneBtn]));

    async function go() {
      if (started) return;
      started = true;
      await AUDIO.resume();
      $('#noteBtn').disabled = false;
      $('#impStartLbl').textContent = 'Pause';
      logEvent('improv_start', { durSec, system, longSession });
      timerId = setInterval(() => {
        if (paused || finished) return;
        remaining -= 1;
        $('#timer').textContent = fmtSec(remaining);
        if (remaining <= 0) { clearInterval(timerId); finish(); }
      }, 1000);
    }
    async function dropNote() {
      const ta = el('textarea',{placeholder:'Quick note…', style:'min-height:90px;'});
      const wrap = el('div',{}); wrap.appendChild(ta);
      const tagRow = el('div',{class:'row wrap',style:'gap:8px;margin-top:8px;'});
      let tagSel = 'neutral';
      ['worked','didn\'t','neutral'].forEach(t => {
        const b = el('button',{class:'chip ' + (t===tagSel?'primary':'')}, [el('span',{class:'inner'}, t)]);
        b.addEventListener('click', () => { tagSel = t; Array.from(tagRow.children).forEach(c=>c.classList.remove('primary')); b.classList.add('primary'); });
        tagRow.appendChild(b);
      });
      wrap.appendChild(tagRow);
      const v = await modal({title:`Note at ${fmtSec(durSec-remaining)}`, content: wrap, buttons:[{label:'Cancel',value:false},{label:'Save',value:true,primary:true}]});
      if (!v) return;
      const text = ta.value.trim(); if (!text) return;
      const note = { atSec: durSec-remaining, text, tag: tagSel };
      SESSION.notes.push({block:'improv', ...note, time: Date.now()});
      notesList.appendChild(el('div',{class:'item'},[el('span',{}, `${fmtSec(note.atSec)} · ${tagSel}`), el('span',{},text)]));
      logEvent('improv_note', note);
    }
    async function finish() {
      if (finished) return;
      finished = true;
      const rec = (RECORDER && RECORDER.state === 'recording') ? await stopRecording() : null;
      logEvent('improv_timer_done', { rec: !!rec });
      screenImprovWrapUp({ rec, system, patch, longSession });
    }
  });
}

function screenImprovWrapUp({ rec, system, patch, longSession }){
  CURRENT_SCREEN = 'improv_wrapup';
  render(root => {
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[el('div',{class:'eyebrow'},'Improv · Wrap-up'), el('h1',{}, rec ? `Take · ${fmtSec(rec.durationSec||0)}` : 'No recording')]),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);

    body.appendChild(el('div',{class:'menu-eyebrow'}, 'Feeling'));
    let feeling = 3;
    body.appendChild(scaleRow(1,5, v => feeling = v, 3, 'feeling'));

    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:6px;'}, 'Focus'));
    let focus = 3;
    body.appendChild(scaleRow(1,5, v => focus = v, 3, 'focus'));

    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:6px;'}, 'Notes'));
    const ta = el('textarea',{placeholder:'What happened. What to chase next time.', style:'min-height:140px;'});
    body.appendChild(ta);

    body.appendChild(el('div',{class:'menu-eyebrow', style:'margin-top:6px;'}, 'Tag'));
    let tag = 'worked';
    const tagRow = el('div',{class:'row wrap', style:'gap:10px;'});
    ['worked','didn\'t','neutral'].forEach(t => {
      const b = el('button',{class:'chip ' + (t===tag?'primary':'')}, [el('span',{class:'inner'}, t)]);
      b.addEventListener('click', ()=>{ tag = t; Array.from(tagRow.children).forEach(c=>c.classList.remove('primary')); b.classList.add('primary'); });
      tagRow.appendChild(b);
    });
    body.appendChild(tagRow);

    if (rec) {
      body.appendChild(el('button',{class:'chip', style:'margin-top:8px;', onclick: ()=>listenBackUI(rec)}, 'Listen back'));
    }

    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: save}, [el('span',{class:'inner'}, 'Save · finish session')]),
    ]));

    async function save(){
      const note = ta.value.trim();
      if (!note) {
        await modal({title:'Notes required', message:'Add at least one short note before finishing.', buttons:[{label:'OK',value:true,primary:true}]});
        ta.focus(); return;
      }
      const annotations = (SESSION.notes||[]).filter(n=>n.block==='improv' && n.atSec!=null).map(n=>({atSec:n.atSec,text:n.text,tag:n.tag}));
      annotations.push({ atSec: null, text: note, tag });
      SESSION.notes.push({ block:'improv_wrap', text: note, tag, feeling, focus, time: Date.now() });
      if (rec) {
        rec.annotations = annotations; rec.feeling = feeling; rec.focus = focus; rec.longSession = longSession;
        await idbSet('recordings', null, rec);
      }
      if (system && patch) {
        patch.sessionsCount = (patch.sessionsCount||0)+1;
        await idbSet('patches', null, patch);
      }
      SESSION.blocks.improv = { done:true, system, patchVersion: patch?.version };
      persistSession();
      logEvent('improv_save', { feeling, focus, tag, recId: rec?.id, note });
      screenClose();
    }
  });
}
function scaleRow(min, max, onChange, initial=3, key='scale'){
  const wrap = el('div',{class:'scale-row'});
  let value = initial;
  for (let i=min; i<=max; i++){
    const b = el('button',{class:'scale-pip ' + (i===initial?'on':'')}, String(i));
    b.addEventListener('click', () => {
      value = i; onChange && onChange(i);
      Array.from(wrap.children).forEach(c=>c.classList.remove('on'));
      b.classList.add('on');
      logEvent(key+'_set', i);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function secondaryConstraint(dow, weekNum){
  const list = [
    'One pitch — explore what the system does with it',
    'Rhythmic — articulate only on downbeats',
    'Dynamic-only variation — same material, vary amplitude',
    'Register-only — same rhythm/dynamic, shift pitch register',
    'Modulate slowly — semitone drift across 2 min',
  ];
  return list[(dow + weekNum) % list.length];
}

// ---------- Recording ----------
let RECORDER = null;
let RECORD_CHUNKS = [];
let RECORD_META = null;
let RECORD_STARTED_AT = 0;
async function startRecording(meta) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
    let mime = 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
    else if (!MediaRecorder.isTypeSupported(mime)) mime = '';
    RECORDER = new MediaRecorder(stream, mime ? {mimeType: mime, audioBitsPerSecond: 64000} : {audioBitsPerSecond:64000});
    RECORD_CHUNKS = [];
    RECORD_META = meta;
    RECORD_STARTED_AT = Date.now();
    RECORDER.ondataavailable = e => { if (e.data.size) RECORD_CHUNKS.push(e.data); };
    RECORDER.onstop = () => { stream.getTracks().forEach(t=>t.stop()); };
    RECORDER.start();
    return true;
  } catch (e) { toast('Mic denied'); return false; }
}
function stopRecording() {
  return new Promise(res => {
    if (!RECORDER || RECORDER.state==='inactive') { res(null); return; }
    RECORDER.addEventListener('stop', async () => {
      const blob = new Blob(RECORD_CHUNKS, { type: RECORDER.mimeType || 'audio/webm' });
      const rec = {
        id: 'rec_'+Date.now(),
        ...RECORD_META,
        durationSec: (Date.now()-RECORD_STARTED_AT)/1000,
        blob,
        mime: RECORDER.mimeType || 'audio/webm',
        starred: false,
        annotations: [],
      };
      await idbSet('recordings', null, rec);
      if (SESSION) { SESSION.recordings.push(rec.id); persistSession(); }
      res(rec);
    }, { once: true });
    RECORDER.stop();
  });
}
async function toggleRecord() {
  if (RECORDER && RECORDER.state === 'recording') {
    const rec = await stopRecording();
    toast('Saved ' + fmtSec(rec?.durationSec||0));
  } else {
    const ok = await startRecording({ block: currentBlockKey(), date: isoDate(), key: SESSION?.tonic, minor: SESSION?.minor });
    if (ok) toast('Recording…');
  }
  refreshRecordButtons();
}
// Sync any chip-style record buttons (class .record-button) to the live
// recording state — text + pulse class.
function refreshRecordButtons() {
  const isRec = !!(RECORDER && RECORDER.state === 'recording');
  document.querySelectorAll('.record-button').forEach(b => {
    b.classList.toggle('recording', isRec);
    b.textContent = isRec ? 'Stop' : 'Record';
  });
}
async function quickRecord(seconds, meta) {
  const ok = await startRecording(meta);
  if (!ok) return;
  await new Promise(r => setTimeout(r, seconds*1000));
  await stopRecording();
}
function currentBlockKey() {
  // Best-effort: inspect eyebrow text
  const e = $('.eyebrow')?.textContent || '';
  if (/scales/i.test(e)) return 'scales';
  if (/adagio/i.test(e)) return 'adagio';
  if (/fuga/i.test(e)) return 'fuga';
  if (/improv/i.test(e)) return 'improv';
  return 'other';
}

// Tracks the active playback so we can hard-stop a previous recording when a
// new one starts, when the drawer is dismissed, or when the user navigates
// away. Without this, playing recording A then opening recording B left A
// running because Done only hid the drawer; tapping Stop only paused the
// current audio reference, not the orphaned previous one.
let CURRENT_PLAYBACK = null;
function stopCurrentPlayback() {
  if (!CURRENT_PLAYBACK) return;
  try { CURRENT_PLAYBACK.audio.pause(); } catch(e){}
  try { URL.revokeObjectURL(CURRENT_PLAYBACK.url); } catch(e){}
  CURRENT_PLAYBACK = null;
}

async function listenBackUI(rec) {
  stopCurrentPlayback();
  return new Promise(res => {
    const d = $('#drawer'); d.classList.remove('hidden'); d.innerHTML='';
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    CURRENT_PLAYBACK = { audio, url };
    const wf = el('div',{class:'waveform'});
    const cur = el('div',{class:'cursor'}); wf.appendChild(cur);
    (rec.annotations||[]).forEach(a => {
      if (a.atSec==null) return;
      const m = el('div',{class:'marker'}); m.style.left = (a.atSec/rec.durationSec*100)+'%'; wf.appendChild(m);
    });
    let playing = false;
    const playBtn = el('button',{class:'chip', onclick: ()=>{ if (playing){ audio.pause(); playBtn.textContent='Play'; } else { audio.play(); playBtn.textContent='Pause'; } playing=!playing; }}, 'Play');
    audio.addEventListener('timeupdate', () => cur.style.left = (audio.currentTime/rec.durationSec*100)+'%');
    audio.addEventListener('ended', ()=>{ playing=false; playBtn.textContent='Play'; if (CURRENT_PLAYBACK?.audio === audio) CURRENT_PLAYBACK = null; });
    wf.addEventListener('click', async e => {
      audio.pause(); playing=false; playBtn.textContent='Play';
      const pct = (e.offsetX / wf.clientWidth);
      const t = pct * rec.durationSec;
      const ta = el('textarea',{placeholder:'note…', style:'min-height:90px;'});
      const wrap2 = el('div',{}); wrap2.appendChild(ta);
      const tagRow = el('div',{class:'row wrap', style:'gap:8px;margin-top:8px;'});
      let tagSel = 'neutral';
      ['worked','didn\'t','neutral'].forEach(tg => {
        const b = el('button',{class:'chip ' + (tg===tagSel?'primary':'')}, [el('span',{class:'inner'}, tg)]);
        b.addEventListener('click', () => { tagSel = tg; Array.from(tagRow.children).forEach(c=>c.classList.remove('primary')); b.classList.add('primary'); });
        tagRow.appendChild(b);
      });
      wrap2.appendChild(tagRow);
      const v = await modal({title:`Note at ${fmtSec(t)}`, content: wrap2, buttons:[{label:'Cancel',value:false},{label:'Save',value:true,primary:true}]});
      if (!v) return;
      const text = ta.value.trim(); if (!text) return;
      rec.annotations = rec.annotations || [];
      rec.annotations.push({ atSec: t, text, tag: tagSel });
      await idbSet('recordings', null, rec);
      const m = el('div',{class:'marker'}); m.style.left = (t/rec.durationSec*100)+'%'; wf.appendChild(m);
    });
    d.appendChild(el('h2',{}, 'Listen back'));
    d.appendChild(wf);
    d.appendChild(el('div',{class:'row wrap', style:'margin-top:12px;'},[
      playBtn,
      el('button',{class:'chip', onclick: async ()=>{
        try { audio.pause(); } catch(e){}
        d.classList.add('hidden');
        if (CURRENT_PLAYBACK?.audio === audio) CURRENT_PLAYBACK = null;
        URL.revokeObjectURL(url);
        res();
      }}, 'Done'),
    ]));
  });
}

// ---------- Session close ----------
async function screenClose() {
  pauseActiveClock();
  SESSION.complete = true;
  SESSION.activeMsFinal = SESSION.activeMs;
  render(async (root) => {
      root.appendChild(el('div',{class:'band-top'},[el('div',{},[el('div',{class:'eyebrow'},'Today'), el('h1',{}, 'Session complete')])]));
      const body = el('div',{class:'body stack'}); root.appendChild(body);
      const sessions = (await idbAll('sessions')).concat([SESSION]);
      const { cur, best } = computeStreak(sessions);
      body.appendChild(el('p',{}, `🔥 Streak ${cur} · Best ${best}`));
      body.appendChild(el('p',{class:'dim'}, `Active time: ${fmtMs(SESSION.activeMsFinal)}`));
      const blk = SESSION.blocks;
      body.appendChild(el('p',{class:'dim'}, `Blocks: Scales ${blk.scales?.technical?.done?'✓':'—'} · Adagio ${blk.adagio?.done?'✓':'—'} · Fuga ${blk.fuga?.done?'✓':'—'} · Improv ${blk.improv?.done?'✓':'—'}`));
      body.appendChild(el('p',{class:'dim'}, `Recordings captured: ${(SESSION.recordings||[]).length}`));
      body.appendChild(el('label',{}, 'How did today feel? (1–5)'));
      const slider = el('input',{type:'range',min:1,max:5,step:1,value:3});
      const valLbl = el('span',{class:'mono',style:'font-size:24px;'}, '3');
      slider.addEventListener('input', e => valLbl.textContent = e.target.value);
      body.appendChild(el('div',{class:'row'},[slider, valLbl]));
      body.appendChild(el('label',{}, 'Freeform note — what happened today?'));
      const ta = el('textarea',{placeholder:'one to three sentences…'});
      body.appendChild(ta);
      root.appendChild(el('div',{class:'band-bottom'},[
        el('button',{class:'big primary', onclick: async ()=>{
          SESSION.feeling = parseInt(slider.value,10);
          SESSION.finalNote = ta.value;
          await idbSet('sessions', null, SESSION);
          await refreshSessionCount();
          releaseWakeLock();
          SESSION = null;
          screenHome();
        }}, [el('span',{class:'inner'}, 'Save and close')]),
      ]));
      // preview tomorrow
      const tomorrowDow = (todayDow()+1)%7;
      const nextInfo = weekInfo(SESSION_COUNT_CACHE+1);
      body.appendChild(el('p',{class:'dim'}, `Tomorrow: ${DAYS[tomorrowDow]} · ${nextInfo.rootName} ${nextInfo.minor?'minor':'major'}`));
  });
}

// ---------- Settings & recordings library ----------
function screenSettings() {
  render(root => {
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[el('div',{class:'eyebrow'},'Settings'), el('h1',{}, 'Practice')]),
      el('button',{class:'icon', onclick: screenHome}, '←'),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    const mkInput = (label, val, onchange, type='text') => {
      const i = el('input',{type, value: val});
      i.addEventListener('change', e => onchange(type==='number'?parseFloat(e.target.value):e.target.value));
      return el('div',{class:'stack'},[el('label',{},label), i]);
    };
    body.appendChild(mkInput('Start date (YYYY-MM-DD)', SETTINGS.startDate, v => { SETTINGS.startDate = v; kvSet('settings',SETTINGS); }));
    body.appendChild(mkInput('Reference pitch (Hz)', SETTINGS.referencePitch, v => { SETTINGS.referencePitch = v; kvSet('settings',SETTINGS); AUDIO.droneBuffers={}; }, 'number'));
    body.appendChild(pickerRow('Temperament','temperament',['ji','et']));
    body.appendChild(pickerRow('Drone sound','droneSound',['tanpura','shruti','pad','sine'], ()=>{ AUDIO.droneBuffers={}; }));
    body.appendChild(pickerRow('Metronome sound','metronomeSound',['wood','cowbell','clave','beep','side']));
    body.appendChild(el('div',{class:'rule'}));
    body.appendChild(el('h2',{}, 'Piece 1'));
    body.appendChild(mkInput('Name', SETTINGS.piece1.name, v=>{SETTINGS.piece1.name=v;kvSet('settings',SETTINGS);}));
    body.appendChild(mkInput('Total measures', SETTINGS.piece1.totalMeasures, v=>{SETTINGS.piece1.totalMeasures=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Chunk size', SETTINGS.piece1.chunkSize, v=>{SETTINGS.piece1.chunkSize=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Current start measure', SETTINGS.piece1.currentStart, v=>{SETTINGS.piece1.currentStart=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Reference drone pitch (e.g. G)', SETTINGS.piece1.referenceDrone||'', v=>{SETTINGS.piece1.referenceDrone=v;kvSet('settings',SETTINGS);}));
    body.appendChild(el('h2',{}, 'Piece 2'));
    body.appendChild(mkInput('Name', SETTINGS.piece2.name, v=>{SETTINGS.piece2.name=v;kvSet('settings',SETTINGS);}));
    body.appendChild(mkInput('Total measures', SETTINGS.piece2.totalMeasures, v=>{SETTINGS.piece2.totalMeasures=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Chunk size', SETTINGS.piece2.chunkSize, v=>{SETTINGS.piece2.chunkSize=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Voices (2-4)', SETTINGS.piece2.voices||3, v=>{SETTINGS.piece2.voices=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Current start measure', SETTINGS.piece2.currentStart, v=>{SETTINGS.piece2.currentStart=v;kvSet('settings',SETTINGS);}, 'number'));
    body.appendChild(mkInput('Reference drone', SETTINGS.piece2.referenceDrone||'', v=>{SETTINGS.piece2.referenceDrone=v;kvSet('settings',SETTINGS);}));
    body.appendChild(el('div',{class:'rule'}));
    body.appendChild(el('button',{class:'chip', onclick: async ()=>{
      await flushLogs();
      const logs = (await kvGet('logs'))||[];
      const text = logs.map(l => `${l.iso}  [${l.screen}]  ${l.action}` + (l.data!=null?`  ${typeof l.data==='object'?JSON.stringify(l.data):l.data}`:'')).join('\n');
      const blob = new Blob([text||'(no logs)'], {type:'text/plain'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `practice-log-${isoDate()}.txt`; a.click();
    }}, 'Download logs'));
    body.appendChild(el('button',{class:'chip', onclick: async ()=>{ if (await askConfirm('Clear logs?', 'Local action log will be erased.', {okLabel:'Clear',danger:true})){ await kvSet('logs',[]); toast('Logs cleared'); } }}, 'Clear logs'));
    body.appendChild(el('button',{class:'chip', onclick: exportAll}, 'Export to repo'));
    body.appendChild(el('button',{class:'chip', onclick: importAll}, 'Import JSON'));
    if ('showDirectoryPicker' in window) {
      body.appendChild(el('button',{class:'chip', onclick: relinkRepoDir}, 'Re-link repo folder'));
    }
    body.appendChild(el('button',{class:'chip', onclick: async ()=>{ if (await askConfirm('Wipe all local data?', 'This deletes settings, sessions, recordings, chunks, patches and logs. Cannot be undone.', {okLabel:'Wipe everything', danger:true})) { indexedDB.deleteDatabase(DB_NAME); localStorage.clear(); location.reload(); } }}, 'Wipe all data'));
    body.appendChild(el('p',{class:'dim',style:'margin-top:16px;'}, `v1 · ${SESSION_COUNT_CACHE} sessions completed.`));
  });
}

// ---------- Export / import ----------
// Export bundles everything in IDB except recording audio blobs. Recording metadata
// (annotations, durations, tags) is included; the audio itself stays on the device.
async function buildExportPayload() {
  await flushLogs();
  return {
    exportedAt: new Date().toISOString(),
    settings: SETTINGS,
    sessions: await idbAll('sessions'),
    chunks: await idbAll('chunks'),
    patches: await idbAll('patches'),
    recordings: (await idbAll('recordings')).map(r => ({...r, blob: undefined})),
    logs: (await kvGet('logs')) || [],
  };
}

// Persistent FileSystemDirectoryHandle for the repo root. First-time grant via
// showDirectoryPicker; survives reloads in IDB. iOS Safari etc. don't have this
// API, so we fall back to download.
async function getRepoDirHandle() {
  const stored = await kvGet('repoDirHandle');
  if (!stored || !stored.queryPermission) return null;
  const opts = { mode: 'readwrite' };
  if (await stored.queryPermission(opts) === 'granted') return stored;
  if (await stored.requestPermission(opts) === 'granted') return stored;
  return null;
}

async function pickRepoDir() {
  if (!('showDirectoryPicker' in window)) return null;
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'violin-practice-repo' });
    await kvSet('repoDirHandle', h);
    return h;
  } catch (e) {
    return null; // user cancelled
  }
}

async function writeJsonToRepo(filename, json) {
  let dir = await getRepoDirHandle();
  if (!dir) dir = await pickRepoDir();
  if (!dir) return false;
  const sub = await dir.getDirectoryHandle('practice-log', { create: true });
  const file = await sub.getFileHandle(filename, { create: true });
  const w = await file.createWritable();
  await w.write(json);
  await w.close();
  return true;
}

async function exportAll() {
  const data = await buildExportPayload();
  const json = JSON.stringify(data, null, 2);
  // Try direct write to repo first (Chromium desktop). Falls back to download.
  if ('showDirectoryPicker' in window) {
    try {
      if (await writeJsonToRepo('practice-log.json', json)) {
        toast('Saved to practice-log/practice-log.json — commit when ready.');
        return;
      }
    } catch (e) {
      console.warn('FS Access write failed, falling back to download:', e);
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'practice-log.json';
  a.click();
  toast('Downloaded — drop in practice-log/ and commit.');
}

async function relinkRepoDir() {
  await idbDel('kv', 'repoDirHandle');
  const h = await pickRepoDir();
  toast(h ? 'Repo folder linked.' : 'No folder picked.');
}

function importAll() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const text = await f.text();
    try {
      const data = JSON.parse(text);
      if (data.settings) { SETTINGS = {...defaultSettings, ...data.settings}; await kvSet('settings', SETTINGS); }
      if (data.sessions) for (const s of data.sessions) await idbSet('sessions', null, s);
      if (data.chunks) for (const c of data.chunks) await idbSet('chunks', null, c);
      if (data.patches) for (const p of data.patches) await idbSet('patches', null, p);
      if (data.recordings) for (const r of data.recordings) await idbSet('recordings', null, r);
      if (data.logs) await kvSet('logs', data.logs);
      toast('Imported');
      await refreshSessionCount();
    } catch (e) { alert('Import failed: '+e.message); }
  };
  inp.click();
}

function screenRecordings() {
  render(async (root) => {
    const recs = (await idbAll('recordings')).sort((a,b)=>b.id.localeCompare(a.id));
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[el('div',{class:'eyebrow'},'Recordings'), el('h1',{}, `${recs.length} takes`)]),
      el('button',{class:'icon', onclick: screenHome}, '←'),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    if (!recs.length) body.appendChild(el('p',{class:'dim'}, 'No recordings yet.'));
    recs.forEach(r => {
      const row = el('div',{class:'item'});
      row.appendChild(el('div',{class:'stack',style:'gap:2px;'},[
        el('div',{style:'font-weight:700;'}, `${r.block} · ${r.key||''} · ${r.date}`),
        el('div',{class:'dim',style:'font-size:12px;'}, `${fmtSec(r.durationSec||0)} · ${(r.annotations||[]).length} notes${r.starred?' ★':''}`),
      ]));
      row.appendChild(el('div',{class:'row'},[
        el('button',{class:'chip', onclick: ()=>listenBackUI(r)}, 'Play'),
        el('button',{class:'chip', onclick: async ()=>{ r.starred=!r.starred; await idbSet('recordings',null,r); screenRecordings(); }}, r.starred?'Unstar':'Star'),
        el('button',{class:'chip', onclick: async ()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(r.blob); a.download=`${r.id}.${(r.mime||'').includes('mp4')?'m4a':'webm'}`; a.click(); }}, '↓'),
        el('button',{class:'chip', onclick: async ()=>{ if (await askConfirm('Delete recording?', `${r.block} · ${r.date}`, {okLabel:'Delete', danger:true})) { await idbDel('recordings', r.id); screenRecordings(); } }}, '✕'),
      ]));
      body.appendChild(row);
    });
  });
}

function screenStats() {
  render(async (root) => {
    const sessions = (await idbAll('sessions')).filter(s=>s.complete).sort((a,b)=>a.date.localeCompare(b.date));
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[el('div',{class:'eyebrow'},'History'), el('h1',{}, `${sessions.length} sessions`)]),
      el('button',{class:'icon', onclick: screenHome}, '←'),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    const { cur, best } = computeStreak(sessions);
    body.appendChild(el('p',{}, `Current streak: ${cur} weeks · Best: ${best}`));
    // feeling sparkline last 7
    const last7 = sessions.slice(-7);
    const spark = el('div',{class:'sparkline'});
    last7.forEach(s => { const h = Math.max(2,(s.feeling||3)*5); const b = el('span',{}); b.style.height = h+'px'; spark.appendChild(b); });
    body.appendChild(el('div',{class:'stack'},[el('label',{},'Feeling · last 7'), spark]));
    const list = el('div',{class:'list'});
    sessions.slice().reverse().slice(0,40).forEach(s => {
      const noteCount = (s.notes||[]).length + (s.finalNote ? 1 : 0);
      const row = el('div',{class:'item', style:'cursor:pointer;', onclick: ()=>screenSessionDetail(s.id)},[
        el('div',{}, `${s.date} · ${s.tonic}${s.minor?'m':'M'}${s.light?' · light':''}`),
        el('div',{class:'dim'}, `feel ${s.feeling||'—'} · ${noteCount} note${noteCount===1?'':'s'} ›`),
      ]);
      list.appendChild(row);
    });
    body.appendChild(list);
  });
}

async function screenSessionDetail(sessionId) {
  CURRENT_SCREEN = 'session_detail';
  render(async (root) => {
    const s = await idbGet('sessions', sessionId);
    if (!s) {
      root.appendChild(el('div',{class:'band-top'},[
        el('div',{},[el('div',{class:'eyebrow'},'Session'), el('h1',{}, 'Not found')]),
        el('button',{class:'icon', onclick: screenStats}, '←'),
      ]));
      return;
    }
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][s.dow ?? new Date(s.date).getDay()];
    const keyName = `${s.tonic}${s.minor?' minor':' major'}`;
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, `${dayName} · ${s.date}`),
        el('h1',{}, `Week ${s.week} · ${keyName}${s.light?' · light':''}`),
      ]),
      el('button',{class:'icon', onclick: screenStats}, '←'),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);

    // Session-level summary
    body.appendChild(el('p',{class:'dim'},
      `Active ${fmtMs(s.activeMsFinal||s.activeMs||0)} · Feeling ${s.feeling||'—'} · Tempo ${s.tempo||'—'}`));

    // Blocks
    const blk = s.blocks || {};
    const blockLines = [];
    if (blk.scales) {
      const t = blk.scales.technical, m = blk.scales.modal, c = blk.scales.chordscale;
      const parts = [];
      if (t?.done) parts.push(`technical${t.tempoEnd?` (${t.tempoEnd} bpm)`:''}`);
      if (m?.done) parts.push(`modal${m.mode?` · ${m.mode}`:''}`);
      if (c?.done) parts.push(`chord-scale${c.progression?` · ${c.progression}`:''}`);
      if (parts.length) blockLines.push(`Scales — ${parts.join(', ')}`);
    }
    if (blk.adagio?.done) blockLines.push(`Adagio — ${blk.adagio.chunk||''}${blk.adagio.mastered?' ✓ mastered':''}${blk.adagio.recorded?' · rec':''}`);
    if (blk.fuga?.done)   blockLines.push(`Fuga — ${blk.fuga.chunk||''}${blk.fuga.mastered?' ✓ mastered':''}${blk.fuga.recorded?' · rec':''}`);
    if (blk.improv?.done) blockLines.push(`Improv — ${blk.improv.system?'system':'acoustic'}${blk.improv.patchVersion?` · patch v${blk.improv.patchVersion}`:''}`);
    if (blockLines.length) {
      body.appendChild(el('div',{class:'rule'}));
      body.appendChild(el('h2',{}, 'Blocks'));
      blockLines.forEach(l => body.appendChild(el('p',{class:'dim',style:'margin:2px 0;'}, l)));
    }

    // End-of-day freeform
    if (s.finalNote && s.finalNote.trim()) {
      body.appendChild(el('div',{class:'rule'}));
      body.appendChild(el('h2',{}, 'How today felt'));
      body.appendChild(el('p',{style:'white-space:pre-wrap;'}, s.finalNote));
    }

    // In-session notes (improv timestamped, transitions, etc.)
    const notes = (s.notes||[]).slice().sort((a,b)=>(a.time||0)-(b.time||0));
    if (notes.length) {
      body.appendChild(el('div',{class:'rule'}));
      body.appendChild(el('h2',{}, `Notes (${notes.length})`));
      notes.forEach(n => {
        const stamp = n.atSec!=null ? `+${fmtSec(n.atSec)}` : (n.time ? new Date(n.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '');
        const tag = n.tag ? ` · ${n.tag}` : '';
        body.appendChild(el('div',{class:'item'},[
          el('div',{class:'dim',style:'font-size:12px;'}, `${(n.block||'').toUpperCase()}${tag} · ${stamp}`),
          el('div',{style:'white-space:pre-wrap;'}, n.text||''),
        ]));
      });
    }

    // Adagio/Fuga chunk notes written on this session's date
    const chunks = await idbAll('chunks');
    const sessionDate = s.date;
    const chunkNotesToday = [];
    chunks.forEach(c => (c.notes||[]).forEach(n => { if (n.date === sessionDate) chunkNotesToday.push({...n, pieceKey:c.pieceKey, label:c.label}); }));
    if (chunkNotesToday.length) {
      body.appendChild(el('div',{class:'rule'}));
      body.appendChild(el('h2',{}, `Chunk notes today (${chunkNotesToday.length})`));
      chunkNotesToday.sort((a,b)=>(a.time||0)-(b.time||0)).forEach(n => {
        const tag = n.tag ? ` · ${n.tag}` : '';
        body.appendChild(el('div',{class:'item'},[
          el('div',{class:'dim',style:'font-size:12px;'}, `${(n.pieceKey||'').toUpperCase()} · ${n.label||''}${tag}`),
          el('div',{style:'white-space:pre-wrap;'}, n.text||''),
        ]));
      });
    }

    // Recordings linked to this session
    const recs = (await idbAll('recordings')).filter(r => r.sessionId === s.id || r.date === s.date);
    if (recs.length) {
      body.appendChild(el('div',{class:'rule'}));
      body.appendChild(el('h2',{}, `Recordings (${recs.length})`));
      recs.forEach(r => {
        body.appendChild(el('div',{class:'item'},[
          el('div',{}, `${r.block||''}${r.key?` · ${r.key}`:''} · ${fmtSec(r.durationSec||0)}`),
          el('div',{class:'dim',style:'font-size:12px;'}, `${(r.annotations||[]).length} annotation${(r.annotations||[]).length===1?'':'s'}${r.starred?' · ★':''}`),
        ]));
      });
    }
  });
}

// ---------- Onboarding ----------
function screenOnboarding() {
  render(async (root) => {
    let step = 0;
    const steps = [
      {
        title:'Welcome',
        render: body => {
          body.appendChild(el('h2',{}, 'Daily violin practice — 45 minutes.'));
          body.appendChild(el('p',{}, 'Scales · Adagio · Fuga · Improv. Drone intonation. Record, listen back. The app handles the rotation; you play.'));
        },
      },
      {
        title:'Start date',
        render: body => {
          body.appendChild(el('label',{}, 'When does your cycle start?'));
          const i = el('input',{type:'date', value: SETTINGS.startDate});
          i.addEventListener('change', e => SETTINGS.startDate = e.target.value);
          body.appendChild(i);
        }
      },
      {
        title:'Audio',
        render: body => {
          body.appendChild(el('label',{}, 'Reference pitch (Hz)'));
          const p = el('input',{type:'number', value:SETTINGS.referencePitch});
          p.addEventListener('change', e => SETTINGS.referencePitch = parseFloat(e.target.value));
          body.appendChild(p);
          body.appendChild(pickerRow('Temperament','temperament',['ji','et']));
          body.appendChild(pickerRow('Drone sound','droneSound',['tanpura','shruti','pad','sine']));
          body.appendChild(pickerRow('Metronome sound','metronomeSound',['wood','cowbell','clave','beep','side']));
        }
      },
      {
        title:'Piece 1 (Adagio by default)',
        render: body => {
          ['name','totalMeasures','chunkSize','referenceDrone'].forEach(k=>{
            const lbl = {name:'Name',totalMeasures:'Total measures',chunkSize:'Chunk size',referenceDrone:'Reference drone (optional, e.g. G)'}[k];
            const i = el('input',{type: k==='name'||k==='referenceDrone'?'text':'number', value: SETTINGS.piece1[k]||''});
            i.addEventListener('change', e => SETTINGS.piece1[k] = (typeof SETTINGS.piece1[k]==='number' ? parseFloat(e.target.value) : e.target.value));
            body.appendChild(el('div',{class:'stack'},[el('label',{},lbl),i]));
          });
        }
      },
      {
        title:'Piece 2 (Fuga by default)',
        render: body => {
          ['name','totalMeasures','chunkSize','voices','referenceDrone'].forEach(k=>{
            const lbl = {name:'Name',totalMeasures:'Total measures',chunkSize:'Chunk size',voices:'Voices',referenceDrone:'Reference drone'}[k];
            const i = el('input',{type: (k==='name'||k==='referenceDrone')?'text':'number', value: SETTINGS.piece2[k]||''});
            i.addEventListener('change', e => SETTINGS.piece2[k] = (typeof SETTINGS.piece2[k]==='number' ? parseFloat(e.target.value) : e.target.value));
            body.appendChild(el('div',{class:'stack'},[el('label',{},lbl),i]));
          });
        }
      },
      {
        title:'Current system patch',
        render: body => {
          body.appendChild(el('label',{}, 'Describe your current patch (skip if acoustic-only)'));
          const ta = el('textarea',{placeholder:'delay, feedback, modulations, signal flow…'});
          ta.addEventListener('change', e => ONB_PATCH = e.target.value);
          body.appendChild(ta);
        }
      },
    ];
    let ONB_PATCH = '';
    const top = el('div',{class:'band-top'},[el('div',{},[el('div',{class:'eyebrow'},'Setup'), el('h1',{id:'ot'}, '')])]);
    root.appendChild(top);
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    const bot = el('div',{class:'band-bottom'}); root.appendChild(bot);
    function show() {
      $('#ot').textContent = steps[step].title;
      body.innerHTML = '';
      steps[step].render(body);
      bot.innerHTML = '';
      if (step>0) bot.appendChild(el('button',{class:'chip', onclick: ()=>{ step--; show(); }}, 'Back'));
      bot.appendChild(el('button',{class:'big primary', onclick: async ()=>{
        if (step === steps.length-1) {
          if (ONB_PATCH.trim()) await idbSet('patches', null, { version:1, text: ONB_PATCH.trim(), created: isoDate(), sessionsCount:0 });
          SETTINGS.onboarded = true;
          await kvSet('settings', SETTINGS);
          screenHome();
        } else { step++; show(); }
      }}, [el('span',{class:'inner'}, step===steps.length-1?'Done':'Next')]));
    }
    show();
  });
}

// ---------- Boot ----------
async function boot() {
  try {
    const s = await kvGet('settings');
    if (s) SETTINGS = {...defaultSettings, ...s};
  } catch(e){}
  // Single-user app — onboarding is permanently skipped. Seed sensible defaults.
  SETTINGS.onboarded = true;
  if (!SETTINGS.startDate || SETTINGS.startDate === isoDate(new Date())) {
    // Anchor cycle start to Monday 2026-04-27 unless the user already practiced.
    SETTINGS.startDate = '2026-04-27';
  }
  await kvSet('settings', SETTINGS);
  try {
    if (!localStorage.getItem('mig_improv_wrap_2026_04_29')) {
      const noteText = "So I did take a recording on my laptop, which is probably worth listening back to. It just kind of diffuses and loses focus, which might be the nature of the patch itself. I think I need to listen to more things or just let it sit a little longer, maybe just try with a lot more space. I think after about 10 minutes it gets quite boring. If I try to bring in too many new textures, it starts to lose focus entirely. It's very hard to find that in between where it's focused and yet diverse enough to be of interest.\n\nFinding more nuance, I guess, within these things, thinking about how they overlap a lot, is left to chance, which just leaves it a bit open-ended for me in terms of the loop length. Maybe there can be a little more craft in determining the lengths of the loop. I think there's a little sound design stuff: the reverb and the pitch-shift sounds kind of bad and could be improved. I didn't even touch the distortion this time so maybe that should be replaced by something else or taken out entirely. Maybe it just needs some backing tracks and some kind of clear structure before I'll give it a couple more days to play with and see what happens.";
      const target = (await idbAll('sessions')).filter(s => s && s.date === '2026-04-29' && s.blocks?.improv?.done).sort((a,b)=>(b.id||'').localeCompare(a.id||''))[0];
      if (target) {
        target.notes = target.notes || [];
        if (!target.notes.some(n => n.block === 'improv_wrap')) {
          target.notes.push({ block: 'improv_wrap', text: noteText, tag: 'neutral', feeling: 3, focus: 2, time: 1777464292772 });
          await idbSet('sessions', null, target);
        }
      }
      localStorage.setItem('mig_improv_wrap_2026_04_29', 'done');
    }
  } catch(e) {}
  AUDIO = new AudioEngine();
  await refreshSessionCount();
  setupSessionClock();
  screenHome();
}

// Floating session-clock overlay — shows activeTimeNow on every screen while a
// session is in progress, hidden otherwise. One element, one interval.
function setupSessionClock() {
  if (document.getElementById('sessionClock')) return;
  const clock = document.createElement('div');
  clock.id = 'sessionClock';
  clock.style.display = 'none';
  document.body.appendChild(clock);
  setInterval(() => {
    if (SESSION) {
      clock.textContent = fmtMs(activeTimeNow());
      clock.style.display = '';
    } else {
      clock.style.display = 'none';
    }
  }, 1000);
}
boot().catch(e => {
  document.body.innerHTML = '<pre style="color:#f4f1ea;padding:20px;">Boot error: '+e.message+'</pre>';
});

// Tap anywhere to resume audio (iOS unlock)
document.addEventListener('touchstart', ()=>{ AUDIO && AUDIO.resume(); }, { once:false, passive:true });
document.addEventListener('click', ()=>{ AUDIO && AUDIO.resume(); }, { once:false });
