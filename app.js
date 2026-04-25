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
      {chord:`${NOTE_NAMES[(T+9)%12]}m7♭5`, root:(T+9)%12, tones:[0,3,6,10], scale:mkScale((T+9)%12,'locrian','locrian')},
      {chord:`${NOTE_NAMES[(T+2)%12]}7 (phryg-dom)`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'phrygDom','phrygian dominant')},
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian')},
    ]};
    if (dow===2) return {label:'Extended functional', bars:[
      {chord:`${NOTE_NAMES[(T+5)%12]}m7`, root:(T+5)%12, tones:[0,3,7,10], scale:mkScale((T+5)%12,'dorian','dorian')},
      {chord:`${NOTE_NAMES[(T+9)%12]}m7♭5`, root:(T+9)%12, tones:[0,3,6,10], scale:mkScale((T+9)%12,'locrian','locrian')},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'phrygDom','phrygian dominant')},
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian')},
    ]};
    if (dow===3) return {label:'Modal vamp — Gm7 (dorian)', bars:[
      {chord:`${NOTE_NAMES[T]}m7`, root:T, tones:[0,3,7,10], scale:mkScale(T,'dorian','dorian')},
    ]};
    if (dow===4) return {label:'Modal vamp — Gm7♭9 (phrygian)', bars:[
      {chord:`${NOTE_NAMES[T]}m7♭9`, root:T, tones:[0,3,7,10,13], scale:mkScale(T,'phrygian','phrygian')},
    ]};
    if (dow===5) return {label:'Modal vamp — Gmaj7#11 (lydian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7#11`, root:T, tones:[0,4,7,11,6], scale:mkScale(T,'lydian','lydian')},
    ]};
  } else {
    if (dow===1) return {label:'ii-V-I (functional)', bars:[
      {chord:`${NOTE_NAMES[(T+9)%12]}m7`, root:(T+9)%12, tones:[0,3,7,10], scale:mkScale((T+9)%12,'dorian','dorian')},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'mixolydian','mixolydian')},
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian')},
    ]};
    if (dow===2) return {label:'Extended functional', bars:[
      {chord:`${NOTE_NAMES[(T+4)%12]}m7`, root:(T+4)%12, tones:[0,3,7,10], scale:mkScale((T+4)%12,'phrygian','phrygian')},
      {chord:`${NOTE_NAMES[(T+9)%12]}m7`, root:(T+9)%12, tones:[0,3,7,10], scale:mkScale((T+9)%12,'aeolian','aeolian')},
      {chord:`${NOTE_NAMES[(T+2)%12]}7`, root:(T+2)%12, tones:[0,4,7,10], scale:mkScale((T+2)%12,'mixolydian','mixolydian')},
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian')},
    ]};
    if (dow===3) return {label:'Modal vamp — maj7 (ionian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7`, root:T, tones:[0,4,7,11], scale:mkScale(T,'ionian','ionian')},
    ]};
    if (dow===4) return {label:'Modal vamp — maj7#11 (lydian)', bars:[
      {chord:`${NOTE_NAMES[T]}maj7#11`, root:T, tones:[0,4,7,11,6], scale:mkScale(T,'lydian','lydian')},
    ]};
    if (dow===5) return {label:'Modal vamp — 7 (mixolydian)', bars:[
      {chord:`${NOTE_NAMES[T]}7`, root:T, tones:[0,4,7,10], scale:mkScale(T,'mixolydian','mixolydian')},
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
  drone_on: true, metro_on: true,
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
    bodies.forEach((b, bi) => {
      const [freq, g0] = b;
      const bus = off.createGain(); bus.gain.value = g0*0.4; bus.connect(masterGain);
      ji.forEach((r, i) => {
        const osc = off.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * r;
        const og = off.createGain();
        og.gain.value = amps[i]*0.5;
        osc.connect(og).connect(bus);
        osc.start(); osc.stop(seconds);
      });
      // amplitude pulse for pluck feel
      const lfoGain = off.createGain(); lfoGain.gain.value = 0.4;
      bus.gain.setValueAtTime(0.0001, 0);
      const step = 2.0;
      const start = (bi * 0.5) % 2.0;
      for (let t = start; t < seconds; t += step) {
        bus.gain.setTargetAtTime(g0*0.5, t, 0.02);
        bus.gain.setTargetAtTime(g0*0.15, t+0.6, 0.8);
      }
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
    const buf = await this.getDroneBuffer(pc);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(this.droneGain);
    src.start();
    this.droneNode = src;
    this.currentDronePc = pc;
  }
  stopDrone() {
    if (this.droneNode) { try { this.droneNode.stop(); } catch(e){} this.droneNode.disconnect(); this.droneNode = null; }
  }
  fadeDrone(ms=800) {
    if (!this.droneGain) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.cancelScheduledValues(now);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, now);
    this.droneGain.gain.linearRampToValueAtTime(0.0001, now + ms/1000);
    setTimeout(()=>{ this.stopDrone(); this.droneGain.gain.value = SETTINGS.volumes.drone; }, ms+20);
  }

  // --- Metronome
  startMetronome(bpm, accentEvery=0) {
    this.metroBpm = bpm;
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
  setBpm(b){ this.metroBpm = b; }

  // --- Chord playback for chord-scale block
  playChord(rootPc, tones, when, durSec, modal=false) {
    if (!this.ctx) return;
    const base = this.pcToFreq(rootPc, 4);
    tones.forEach((semi, i) => {
      const f = base * Math.pow(2, semi/12);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = modal ? 'sine' : 'triangle';
      o.frequency.value = f;
      const peak = modal ? 0.12 : 0.18;
      const atk = modal ? 0.25 : 0.01;
      const dec = modal ? 0.4 : 0.2;
      const sus = modal ? 0.18 : 0.06;
      const rel = modal ? 0.6 : 0.3;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when+atk);
      g.gain.linearRampToValueAtTime(sus, when+atk+dec);
      g.gain.linearRampToValueAtTime(0.0001, when+durSec+rel);
      o.connect(g).connect(this.chordGain);
      o.start(when); o.stop(when+durSec+rel+0.05);
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
  app.style.background = next;
  app.style.color = pickInk(next);
  app.style.setProperty('--bg', next);
  document.querySelector('meta[name=theme-color]').setAttribute('content', next);
}
function pickInk(hex){
  const r=parseInt(hex.substr(1,2),16), g=parseInt(hex.substr(3,2),16), b=parseInt(hex.substr(5,2),16);
  const lum = (0.299*r + 0.587*g + 0.114*b)/255;
  return lum > 0.55 ? '#0a0a0a' : '#f4f1ea';
}

function render(screenFn) {
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
function scaleTempoFor(tonic, minor){
  // start at 60, +5 each time this key recurs (per completed scale block)
  const k = keyTempoName(tonic, minor);
  const n = (SETTINGS.scaleRecurrence && SETTINGS.scaleRecurrence[k]) || 0;
  return 60 + 5*n;
}
function bumpScaleRecurrence(tonic, minor){
  const k = keyTempoName(tonic, minor);
  SETTINGS.scaleRecurrence = SETTINGS.scaleRecurrence || {};
  SETTINGS.scaleRecurrence[k] = (SETTINGS.scaleRecurrence[k]||0) + 1;
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
      menuItem('Pedal tone', pedalNote, 'drone underneath'),
      menuItem('Mode', modeLabel, ''),
      menuItem('Improvisation', improvLabel + longNote, ''),
    ]);
    const body = el('div',{class:'body home-body'}, [menu]);
    root.appendChild(body);

    const lightOn = (localStorage.getItem('lightToggle')==='1');
    const lightRow = el('label',{class:'row light-toggle'},[
      (() => { const cb = el('input',{type:'checkbox'}); cb.checked = lightOn; cb.addEventListener('change', e=>{ localStorage.setItem('lightToggle', e.target.checked?'1':'0'); logEvent('light_toggle', e.target.checked); }); return cb; })(),
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
  const light = (localStorage.getItem('lightToggle')==='1');
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
    const ints = info.minor ? [0,3,7,12] : [0,4,7,12];
    const out = [];
    for (let o=0;o<3;o++) ints.forEach(iv => out.push({pc:(T+iv)%12, octave:3+o+Math.floor((T+iv)/12), name:NOTE_NAMES[(T+iv)%12]}));
    for (let o=2;o>=0;o--) ints.slice().reverse().forEach(iv => out.push({pc:(T+iv)%12, octave:3+o+Math.floor((T+iv)/12), name:NOTE_NAMES[(T+iv)%12]}));
    return out;
  })();
  const dom7Root = (T+7)%12;
  const dom7Arp = (()=>{
    const ints = [0,4,7,10,12];
    const out = [];
    for (let o=0;o<3;o++) ints.forEach(iv => out.push({pc:(dom7Root+iv)%12, octave:3+o+Math.floor((dom7Root+iv)/12), name:NOTE_NAMES[(dom7Root+iv)%12]}));
    for (let o=2;o>=0;o--) ints.slice().reverse().forEach(iv => out.push({pc:(dom7Root+iv)%12, octave:3+o+Math.floor((dom7Root+iv)/12), name:NOTE_NAMES[(dom7Root+iv)%12]}));
    return out;
  })();
  const extraArpIsSubdominant = (info.weekNum % 2 === 1); // alternate
  const extraRoot = extraArpIsSubdominant ? (T+5)%12 : (T+11)%12;
  const extraInts = extraArpIsSubdominant
    ? (info.minor ? [0,3,7,12] : [0,4,7,12])
    : [0,3,6,9,12];
  const extraArp = (()=>{
    const out = [];
    for (let o=0;o<3;o++) extraInts.forEach(iv => out.push({pc:(extraRoot+iv)%12, octave:3+o+Math.floor((extraRoot+iv)/12), name:NOTE_NAMES[(extraRoot+iv)%12]}));
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
    body.appendChild(buildAudioPanel({ dronePc, droneLabel: NOTE_NAMES[dronePc], onTempoChange: bpm => { SESSION.tempo = bpm; logEvent('tempo_change', bpm); } }));

    body.appendChild(el('div',{class:'bowing-line'}, `Bowing — ${dayBowing(dow)}`));

    const stepTitle = el('h2',{id:'stepTitle', class:'step-title'}, 'Ready when you are');
    const stepSub = el('p',{id:'stepSub',class:'dim step-sub'}, 'Tap Start to begin the first scale.');
    body.appendChild(stepTitle); body.appendChild(stepSub);
    const noteLine = el('div',{class:'note-line', id:'noteLine'}, '');
    body.appendChild(noteLine);
    const stepClock = el('div',{class:'step-clock', id:'stepClock'}, '');
    body.appendChild(stepClock);

    const bottom = el('div',{class:'band-bottom'});
    root.appendChild(bottom);
    const startBtn = el('button',{class:'big primary', onclick: ()=>{ if (!started) begin(); else nextStep(); }}, [el('span',{class:'inner', id:'startInner'}, 'Start')]);
    const recBtn   = el('button',{class:'chip', onclick: toggleRecord}, 'Record');
    bottom.appendChild(startBtn);
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
      if (SETTINGS.drone_on) AUDIO.startDrone(dronePc);
      if (SETTINGS.metro_on) AUDIO.startMetronome(SESSION.tempo);
      logEvent('scales_technical_begin', { tempo: SESSION.tempo, drone: NOTE_NAMES[dronePc] });
      showStep(0);
    }
    async function finish(){
      clearTimeout(stepTickT);
      AUDIO.stopMetronome();
      AUDIO.fadeDrone(500);
      bumpScaleRecurrence(info.rootName, info.minor);
      const tk = keyTempoName(info.rootName, info.minor);
      SETTINGS.tempoPerKey[tk] = Math.max(SESSION.tempo, SETTINGS.tempoPerKey[tk]||0);
      await kvSet('settings', SETTINGS);
      SESSION.blocks.scales.technical = { done:true, tempo: SESSION.tempo, stepTimesMs: stepTimes };
      persistSession();
      logEvent('scales_technical_complete', { stepTimes, tempo: SESSION.tempo });
      await transition('Scales · Modal', screenScalesModal);
    }
  });
}

// Inline audio control panel — used in scales screens.
function buildAudioPanel({ dronePc, droneLabel, onTempoChange }) {
  const wrap = el('div',{class:'audio-panel'});

  // Drone row
  const droneRow = el('div',{class:'ap-row drone-row'});
  const droneToggle = el('button',{class:'ap-toggle big-toggle ' + (SETTINGS.drone_on?'on':'off')}, [
    el('div',{class:'ap-label'}, 'Drone'),
    el('div',{class:'ap-value', id:'apDroneVal'}, droneLabel || ''),
    el('div',{class:'ap-state', id:'apDroneState'}, SETTINGS.drone_on ? 'ON' : 'OFF'),
  ]);
  droneToggle.addEventListener('click', () => {
    SETTINGS.drone_on = !SETTINGS.drone_on; kvSet('settings', SETTINGS);
    droneToggle.classList.toggle('on', SETTINGS.drone_on);
    droneToggle.classList.toggle('off', !SETTINGS.drone_on);
    $('#apDroneState').textContent = SETTINGS.drone_on?'ON':'OFF';
    if (SETTINGS.drone_on && dronePc!=null) AUDIO.startDrone(dronePc); else AUDIO.fadeDrone(300);
    logEvent('drone_toggle', SETTINGS.drone_on);
  });
  const droneVol = el('input',{type:'range',min:0,max:1,step:0.01, class:'ap-vol', 'aria-label':'Drone volume'});
  droneVol.value = SETTINGS.volumes.drone;
  droneVol.addEventListener('input', e => { AUDIO.setVolume('drone', parseFloat(e.target.value)); });
  droneVol.addEventListener('change', e => logEvent('drone_volume', parseFloat(e.target.value)));
  droneRow.appendChild(droneToggle);
  droneRow.appendChild(el('div',{class:'ap-vol-wrap'},[el('div',{class:'ap-vol-label'},'Vol'), droneVol]));
  wrap.appendChild(droneRow);

  // Metronome row
  const metroRow = el('div',{class:'ap-row metro-row'});
  const metroToggle = el('button',{class:'ap-toggle big-toggle ' + (SETTINGS.metro_on?'on':'off')}, [
    el('div',{class:'ap-label'}, 'Metronome'),
    el('div',{class:'ap-value', id:'apMetroVal'}, `${SESSION?SESSION.tempo:60} bpm`),
    el('div',{class:'ap-state', id:'apMetroState'}, SETTINGS.metro_on ? 'ON' : 'OFF'),
  ]);
  metroToggle.addEventListener('click', () => {
    SETTINGS.metro_on = !SETTINGS.metro_on; kvSet('settings', SETTINGS);
    metroToggle.classList.toggle('on', SETTINGS.metro_on);
    metroToggle.classList.toggle('off', !SETTINGS.metro_on);
    $('#apMetroState').textContent = SETTINGS.metro_on?'ON':'OFF';
    if (SETTINGS.metro_on && SESSION) AUDIO.startMetronome(SESSION.tempo); else AUDIO.stopMetronome();
    logEvent('metro_toggle', SETTINGS.metro_on);
  });
  const metroVol = el('input',{type:'range',min:0,max:1,step:0.01,class:'ap-vol','aria-label':'Metronome volume'});
  metroVol.value = SETTINGS.volumes.metro;
  metroVol.addEventListener('input', e => AUDIO.setVolume('metro', parseFloat(e.target.value)));
  metroVol.addEventListener('change', e => logEvent('metro_volume', parseFloat(e.target.value)));
  metroRow.appendChild(metroToggle);
  metroRow.appendChild(el('div',{class:'ap-vol-wrap'},[el('div',{class:'ap-vol-label'},'Vol'), metroVol]));
  wrap.appendChild(metroRow);

  // Tempo row
  const tempoRow = el('div',{class:'ap-row tempo-row'});
  const tempoMinus = el('button',{class:'tempo-btn'}, '−');
  const tempoPlus  = el('button',{class:'tempo-btn'}, '+');
  const tempoVal = el('div',{class:'tempo-display', id:'tempoDisplay'}, `${SESSION?SESSION.tempo:60}`);
  const tempoLbl = el('div',{class:'tempo-label'}, 'BPM');
  function changeTempo(delta){
    if (!SESSION) return;
    SESSION.tempo = Math.max(30, Math.min(220, SESSION.tempo + delta));
    AUDIO.setBpm(SESSION.tempo);
    $('#tempoDisplay').textContent = SESSION.tempo;
    const mv = $('#apMetroVal'); if (mv) mv.textContent = `${SESSION.tempo} bpm`;
    onTempoChange && onTempoChange(SESSION.tempo);
  }
  tempoMinus.addEventListener('click', ()=>changeTempo(-2));
  tempoPlus.addEventListener('click', ()=>changeTempo(+2));
  tempoRow.appendChild(tempoMinus);
  tempoRow.appendChild(el('div',{class:'tempo-stack'},[tempoVal, tempoLbl]));
  tempoRow.appendChild(tempoPlus);
  wrap.appendChild(tempoRow);

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
    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'chip', onclick: async ()=>{ const note = prompt('Add a quick note (optional):'); if (note){ SESSION.notes.push({time:Date.now(), text:note, block: 'transition'}); persistSession(); }}}, 'Add note'),
      el('button',{class:'big primary', onclick: ()=>{ startActiveClock(); nextFn(); }}, [el('span',{class:'inner'}, 'Continue')]),
    ]));
    setTimeout(()=>{ startActiveClock(); nextFn(); }, 2000);
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
  render(async (root) => {
    const info = weekInfo();
    const rawDow = todayDow();
    const dow = (rawDow<1 || rawDow>5) ? 5 : rawDow; // weekends use Friday's modal focus instead of skipping
    const data = modalStepsFor(info, dow, SESSION.light);
    let runner = null;
    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'},'Scales · Modal · —/4'),
        el('h1',{}, data.modeName),
      ]),
      el('div',{class:'timer', id:'timer'}, '—'),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    body.appendChild(el('p',{}, data.modeNotes.join(' ')));
    body.appendChild(el('p',{class:'dim'}, `Characteristic degree: ${data.charDegreeNote} — ${data.charDegreeText}`));
    body.appendChild(el('p',{class:'dim'}, `Tonic triad: ${data.tonicTriadLabel}  ·  Characteristic chord: ${data.charChordLabel}`));
    const stepTitle = el('h2',{id:'stepTitle'}, 'Ready');
    const stepSub = el('p',{id:'stepSub',class:'dim'}, '');
    body.appendChild(stepTitle); body.appendChild(stepSub);
    const notation = el('div',{class:'notation',id:'notation'}); body.appendChild(notation);
    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: go}, [el('span',{class:'inner'}, 'Start')]),
      el('button',{class:'chip', onclick: ()=>{ runner && runner.extend(30000); toast('+30s'); }}, 'Hold +30s'),
      el('button',{class:'chip', onclick: openDrawer}, 'Audio'),
      el('button',{class:'chip', onclick: toggleRecord}, 'Record'),
    ]));
    async function go() {
      if (SETTINGS.drone_on) AUDIO.startDrone(data.dronePc);
      if (SETTINGS.metro_on) AUDIO.startMetronome(SESSION.tempo);
      runner = stepRunner({
        stepDurationsMs: data.steps.map(s=>s.durMs),
        onStep: i => {
          const s = data.steps[i];
          $('.eyebrow', root).textContent = `Scales · Modal · ${i+1}/4`;
          $('#stepTitle').textContent = s.title;
          $('#stepSub').textContent = s.sub;
          if (s.freeImprov) { AUDIO.stopMetronome(); notation.innerHTML='<div style="padding:18px;color:#111;">Free improvisation — make the mode sound.</div>'; }
          else renderNotation(notation, s.notes);
        },
        onTick: (i, rem) => $('#timer').textContent = fmtSec(rem/1000),
        onComplete: async ()=>{
          AUDIO.stopMetronome(); AUDIO.fadeDrone(500);
          SESSION.blocks.scales.modal = { done:true, mode: data.modeName };
          persistSession();
          transition('Scales · Chord-scale', screenScalesChordScale);
        }
      });
    }
  });
}

// ---------- Scales — Chord-scale ----------
function screenScalesChordScale() {
  render(async (root) => {
    const info = weekInfo();
    const rawDow = todayDow();
    const dow = (rawDow<1 || rawDow>5) ? 5 : rawDow;
    const prog = dayChordProgression(dow, info.minor, info.rootPc);
    const progKey = 'progBars_' + prog.label;
    const barsPerChord = SETTINGS[progKey] || 8;
    let currentBar = 0;
    let totalSec = (SESSION.light?90:180);
    let remainingSec = totalSec;
    let mainTimer = null;
    let chordTimer = null;
    let loopTempo = 72;
    let schedAhead = 0;
    const modal = prog.bars.length === 1;

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'},'Scales · Chord-scale'),
        el('h1',{}, prog.label),
      ]),
      el('div',{class:'timer',id:'timer'}, fmtSec(remainingSec)),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    body.appendChild(el('div',{class:'row wrap'},[
      el('span',{class:'pill',id:'bpmPill'}, `${loopTempo} bpm`),
      ...[8,4,2,1].map(n => {
        const b = el('button',{class:'chip', onclick:()=>{ SETTINGS[progKey]=n; kvSet('settings',SETTINGS); toast(`${n} bars/chord`); $('#bpb'+n).classList.add('active'); }}, `${n} bar`);
        b.id = 'bpb'+n;
        if (n===barsPerChord) b.style.background = 'currentColor';
        return b;
      })
    ]));
    const chart = el('div',{class:'chord-chart', id:'chart'});
    prog.bars.forEach((bar,i) => {
      chart.appendChild(el('div',{class:'chord' + (i===0?' active':''), 'data-i':i}, bar.chord));
    });
    body.appendChild(chart);
    const scaleLabel = el('h2',{id:'scaleLbl'}, '');
    const scaleNotes = el('p',{id:'scaleNotes',class:'dim'}, '');
    body.appendChild(scaleLabel); body.appendChild(scaleNotes);
    const notation = el('div',{class:'notation',id:'notation'}); body.appendChild(notation);
    const phase = el('p',{id:'phase',class:'dim'}, 'Press start.');
    body.appendChild(phase);
    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: go}, [el('span',{class:'inner'}, 'Start')]),
      el('button',{class:'chip', onclick: openDrawer}, 'Audio'),
      el('button',{class:'chip', onclick: toggleRecord}, 'Record'),
      el('button',{class:'chip', onclick: endNow}, 'Done'),
    ]));
    function refreshChord(){
      const i = currentBar % prog.bars.length;
      $$('.chord', chart).forEach((n, idx) => {
        n.classList.remove('active','next');
        if (idx === i) n.classList.add('active');
        if (idx === (i+1) % prog.bars.length) n.classList.add('next');
      });
      const bar = prog.bars[i];
      scaleLabel.textContent = bar.scale.name + ' — ' + bar.scale.notes.join(' ');
      scaleNotes.textContent = `Chord tones: ${bar.tones.length}  ·  ${bar.chord}`;
      const notes = scaleNotesFromRoot(bar.scale.rootPc, SCALE[bar.scale.type], 1, 4);
      renderNotation(notation, notes);
    }
    async function go() {
      await AUDIO.resume();
      AUDIO.fadeDrone(200);
      // chord loop
      const secPerBar = 60/loopTempo * 4;
      let nextBarAt = AUDIO.ctx.currentTime + 0.25;
      let bar = 0;
      function sched() {
        if (remainingSec <= 0) { finish(); return; }
        while (nextBarAt < AUDIO.ctx.currentTime + 0.6) {
          const ci = Math.floor(bar / barsPerChord) % prog.bars.length;
          if (bar % barsPerChord === 0) {
            const chord = prog.bars[ci];
            AUDIO.playChord(chord.root, chord.tones, nextBarAt, secPerBar * barsPerChord * 0.95, modal);
            currentBar = ci;
            requestAnimationFrame(refreshChord);
          }
          nextBarAt += secPerBar;
          bar++;
        }
        chordTimer = setTimeout(sched, 80);
      }
      sched();
      refreshChord();
      mainTimer = setInterval(() => {
        remainingSec -= 1;
        $('#timer').textContent = fmtSec(remainingSec);
        if (remainingSec === (totalSec-30)) phase.textContent = 'Play clean switches.';
        else if (remainingSec <= 30) phase.textContent = 'Phrase.';
        else if (remainingSec > totalSec - 30) phase.textContent = 'Listen. Don\'t play.';
      }, 1000);
    }
    function finish(){
      clearInterval(mainTimer); clearTimeout(chordTimer);
      AUDIO.fadeDrone(200);
      SESSION.blocks.scales.chordscale = {done:true, progression: prog.label};
      persistSession();
      transition('Adagio', screenAdagio);
    }
    function endNow(){ remainingSec = 0; finish(); }
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
    let remaining = durSec;
    let runTimer = null;
    let running = false;
    let finished = false;
    let droneOn = false, metroOn = false;
    logEvent(pieceKey+'_open', { chunk: chunkLabel, durSec });

    root.appendChild(el('div',{class:'band-top'},[
      el('div',{},[
        el('div',{class:'eyebrow'}, pieceKey.toUpperCase() + (pieceKey==='fuga' && piece.voices?` · ${piece.voices} voices`:'')),
        el('h1',{}, `${piece.name} · ${chunkLabel}`),
      ]),
      el('div',{class:'timer', id:'timer'}, fmtSec(remaining)),
    ]));
    const body = el('div',{class:'body stack'}); root.appendChild(body);
    if (prior.length) {
      body.appendChild(el('h2',{style:'font-size:15px;letter-spacing:.06em;text-transform:uppercase;'}, 'Recent notes'));
      const list = el('ul',{class:'bare stack'});
      prior.forEach(n => list.appendChild(el('li',{class:'row',style:'gap:8px;align-items:flex-start;'},[
        el('span',{class:'note-tag ' + (n.tag||'')}, (n.tag||'note').slice(0,8)),
        el('span',{}, `${n.date} — ${n.text}`)
      ])));
      body.appendChild(list);
      body.appendChild(el('button',{class:'chip', onclick: async ()=>{
        const all = await chunkNotes(pieceKey, chunkLabel);
        const txt = all.map(n=>`${n.date} [${n.tag||'note'}]: ${n.text}`).join('\n\n') || 'No notes.';
        const pre = el('pre',{style:'white-space:pre-wrap;font:inherit;font-size:14px;max-height:50vh;overflow:auto;'}, txt);
        await modal({ title:'All notes', content: pre, buttons:[{label:'Close', value:true, primary:true}] });
      }}, 'Show all'));
    } else {
      body.appendChild(el('p',{class:'dim'}, 'No prior notes on this chunk.'));
    }
    body.appendChild(el('div',{class:'row wrap'},[
      (() => { const b = el('button',{class:'chip'}, `Drone ${droneRoot}: off`);
        b.addEventListener('click', ()=>{
          droneOn = !droneOn; b.textContent = `Drone ${droneRoot}: ${droneOn?'on':'off'}`;
          if (droneOn) AUDIO.startDrone(NOTE_TO_PC[droneRoot]||0);
          else AUDIO.fadeDrone(300);
          logEvent('piece_drone_toggle', { pieceKey, on: droneOn });
        }); return b; })(),
      (() => { const b = el('button',{class:'chip'}, `Metronome: off`);
        b.addEventListener('click', ()=>{
          metroOn = !metroOn; b.textContent = `Metronome: ${metroOn?'on':'off'}`;
          if (metroOn) AUDIO.startMetronome(60); else AUDIO.stopMetronome();
          logEvent('piece_metro_toggle', { pieceKey, on: metroOn });
        }); return b; })(),
      el('button',{class:'chip', onclick: openDrawer}, 'Audio'),
    ]));
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
  render(async (root) => {
    const dow = todayDow();
    const system = isSystemDay(dow);
    const longSession = isSundayLong(dow);
    const info = weekInfo();
    let durSec = (longSession ? 30*60 : 15*60);
    if (SESSION.light) durSec /= 2;
    let remaining = durSec;
    let timerId = null;
    let currentRec = null;

    let patches = await idbAll('patches');
    let patch = patches[patches.length-1];
    if (system && !patch) {
      const text = prompt('Describe your current patch (delay, feedback, modulations, signal flow):', '') || 'initial patch';
      patch = { id: undefined, version: 1, text, created: isoDate(), sessionsCount: 0 };
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
      body.appendChild(el('p',{}, patch?.text||''));
      body.appendChild(el('p',{class:'dim'}, `Session ${(patch?.sessionsCount||0)+1} of this patch — transparent yet?`));
      body.appendChild(el('p',{class:'dim'}, 'Secondary constraint: ' + secondaryConstraint(dow, info.weekNum)));
      body.appendChild(el('button',{class:'chip', onclick: async ()=>{
        const t = prompt('Edit patch description (saves as new version):', patch.text);
        if (t && t.trim()) { patch = { version: patches.length+1, text: t.trim(), created: isoDate(), sessionsCount: 0 }; await idbSet('patches', null, patch); toast('Patch v'+patch.version+' saved'); }
      }}, 'Edit patch'));
    } else {
      body.appendChild(el('h2',{}, acousticConstraint));
      body.appendChild(el('button',{class:'chip', onclick: ()=>{ SETTINGS.acousticIdx++; kvSet('settings',SETTINGS); screenImprov(); }}, 'Rotate constraint'));
    }
    body.appendChild(el('p',{class:'dim'}, ambient));
    const notesList = el('div',{class:'list', id:'notes'});
    body.appendChild(notesList);

    root.appendChild(el('div',{class:'band-bottom'},[
      el('button',{class:'big primary', onclick: go}, [el('span',{class:'inner'}, 'Setup ready? Start')]),
      el('button',{class:'chip', id:'noteBtn', onclick: dropNote, disabled:true}, '+ Note'),
      el('button',{class:'chip', onclick: endEarly}, 'Done'),
    ]));
    async function go() {
      await AUDIO.resume();
      await startRecording({ block: 'improv', system, patchVersion: patch?.version, date: isoDate(), longSession, constraint: system? null : acousticConstraint });
      $('#noteBtn').disabled = false;
      timerId = setInterval(() => {
        remaining -= 1;
        $('#timer').textContent = fmtSec(remaining);
        if (remaining <= 0) { clearInterval(timerId); finish(); }
      }, 1000);
    }
    async function endEarly(){ remaining = 0; clearInterval(timerId); finish(); }
    async function dropNote() {
      const text = prompt('Note at ' + fmtSec(durSec-remaining) + ':');
      if (!text) return;
      const tag = (prompt('Tag (worked/didn\'t/neutral):', 'neutral')||'neutral');
      const note = { atSec: durSec-remaining, text, tag };
      SESSION.notes.push({block:'improv', ...note, time: Date.now()});
      notesList.appendChild(el('div',{class:'item'},[el('span',{}, `${fmtSec(note.atSec)} [${tag}]`), el('span',{},text)]));
    }
    async function finish() {
      const rec = await stopRecording();
      let feeling = parseInt(prompt('Feeling (1–5):','3')||'3',10);
      let focus = parseInt(prompt('Focus (1–5):','3')||'3',10);
      let note = '';
      while (!note) { note = prompt('Notes (required, 1+):')||''; if (!note) toast('need a note'); }
      const tag = prompt('Tag (worked/didn\'t):','worked') || 'worked';
      const annotations = (SESSION.notes||[]).filter(n=>n.block==='improv' && n.atSec!=null).map(n=>({atSec:n.atSec,text:n.text,tag:n.tag}));
      annotations.push({atSec: null, text: note, tag});
      if (rec) {
        rec.annotations = annotations;
        rec.feeling = feeling; rec.focus = focus;
        rec.longSession = longSession;
        await idbSet('recordings', null, rec);
      }
      if (system && patch) {
        patch.sessionsCount = (patch.sessionsCount||0)+1;
        await idbSet('patches', null, patch);
      }
      const later = !confirm('Listen back now? OK = now, Cancel = later');
      if (!later && rec) await listenBackUI(rec);
      SESSION.blocks.improv = { done:true, system, patchVersion: patch?.version };
      persistSession();
      screenClose();
    }
  });
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

async function listenBackUI(rec) {
  return new Promise(res => {
    const d = $('#drawer'); d.classList.remove('hidden'); d.innerHTML='';
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    const wf = el('div',{class:'waveform'});
    const cur = el('div',{class:'cursor'}); wf.appendChild(cur);
    (rec.annotations||[]).forEach(a => {
      if (a.atSec==null) return;
      const m = el('div',{class:'marker'}); m.style.left = (a.atSec/rec.durationSec*100)+'%'; wf.appendChild(m);
    });
    let playing = false;
    const playBtn = el('button',{class:'chip', onclick: ()=>{ if (playing){ audio.pause(); playBtn.textContent='Play'; } else { audio.play(); playBtn.textContent='Pause'; } playing=!playing; }}, 'Play');
    audio.addEventListener('timeupdate', () => cur.style.left = (audio.currentTime/rec.durationSec*100)+'%');
    audio.addEventListener('ended', ()=>{ playing=false; playBtn.textContent='Play'; });
    wf.addEventListener('click', async e => {
      audio.pause(); playing=false; playBtn.textContent='Play';
      const pct = (e.offsetX / wf.clientWidth);
      const t = pct * rec.durationSec;
      const text = prompt(`Note at ${fmtSec(t)}:`);
      if (!text) return;
      const tag = prompt('Tag (worked/didn\'t/neutral):','neutral')||'neutral';
      rec.annotations = rec.annotations || [];
      rec.annotations.push({ atSec: t, text, tag });
      await idbSet('recordings', null, rec);
      const m = el('div',{class:'marker'}); m.style.left = (t/rec.durationSec*100)+'%'; wf.appendChild(m);
    });
    d.appendChild(el('h2',{}, 'Listen back'));
    d.appendChild(wf);
    d.appendChild(el('div',{class:'row wrap', style:'margin-top:12px;'},[
      playBtn,
      el('button',{class:'chip', onclick: async ()=>{ d.classList.add('hidden'); URL.revokeObjectURL(url); res(); }}, 'Done'),
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
    body.appendChild(el('button',{class:'chip', onclick: async ()=>{ if (confirm('Clear logs?')){ await kvSet('logs',[]); toast('Logs cleared'); } }}, 'Clear logs'));
    body.appendChild(el('button',{class:'chip', onclick: exportAll}, 'Export JSON'));
    body.appendChild(el('button',{class:'chip', onclick: importAll}, 'Import JSON'));
    body.appendChild(el('button',{class:'chip', onclick: async ()=>{ if (confirm('Wipe all local data?')) { indexedDB.deleteDatabase(DB_NAME); localStorage.clear(); location.reload(); } }}, 'Wipe all data'));
    body.appendChild(el('p',{class:'dim',style:'margin-top:16px;'}, `v1 · ${SESSION_COUNT_CACHE} sessions completed.`));
  });
}

async function exportAll() {
  const data = {
    settings: SETTINGS,
    sessions: await idbAll('sessions'),
    chunks: await idbAll('chunks'),
    patches: await idbAll('patches'),
    recordings: (await idbAll('recordings')).map(r => ({...r, blob: undefined})),
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `practice-export-${isoDate()}.json`;
  a.click();
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
        el('button',{class:'chip', onclick: async ()=>{ if (confirm('Delete?')) { await idbDel('recordings', r.id); screenRecordings(); } }}, '✕'),
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
      list.appendChild(el('div',{class:'item'},[
        el('div',{}, `${s.date} · ${s.tonic}${s.minor?'m':'M'}${s.light?' · light':''}`),
        el('div',{class:'dim'}, `feel ${s.feeling||'—'}`),
      ]));
    });
    body.appendChild(list);
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
  AUDIO = new AudioEngine();
  await refreshSessionCount();
  if (!SETTINGS.onboarded) screenOnboarding();
  else screenHome();
}
boot().catch(e => {
  document.body.innerHTML = '<pre style="color:#f4f1ea;padding:20px;">Boot error: '+e.message+'</pre>';
});

// Tap anywhere to resume audio (iOS unlock)
document.addEventListener('touchstart', ()=>{ AUDIO && AUDIO.resume(); }, { once:false, passive:true });
document.addEventListener('click', ()=>{ AUDIO && AUDIO.resume(); }, { once:false });
