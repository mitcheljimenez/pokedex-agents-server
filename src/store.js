// The save and the news, as game.js expects them from Herdr's `herdr` module (tsconfig maps
// "herdr" here): shared()/setShared() over one JSON file, notify(), playSound(), settings().
// Only this server writes them.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_HOME = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
export const STATE_DIR = process.env.POKEDEX_STATE ?? path.join(STATE_HOME, "pokedex-agents-server");
export const ROOT = path.resolve(import.meta.dir, "..");
const FILE = path.join(STATE_DIR, "shared.json");
const LOCK = path.join(STATE_DIR, "shared.lock");
export const NOTES_FILE = path.join(STATE_DIR, "notes.json");
export const sharedFile = FILE;

fs.mkdirSync(STATE_DIR, { recursive: true });

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
// Written whole to a temp file and renamed, so a reader never sees half a file.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

// The save used to live with pokemon-rex's daemon; the first start here brings it over (a copy).
const LEGACY = path.join(STATE_HOME, "rex-pokedex", "shared.json");
if (!process.env.POKEDEX_STATE && !fs.existsSync(FILE) && fs.existsSync(LEGACY)) fs.copyFileSync(LEGACY, FILE);

let cache = null;
let cacheStamp = "";
function load() {
  let stamp = "";
  try {
    const st = fs.statSync(FILE);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return {};
  }
  if (stamp !== cacheStamp || !cache) {
    cache = readJson(FILE, {});
    cacheStamp = stamp;
  }
  return cache;
}

// Kept on this machine only, in local.json, never in the save: the readable names of projects (see
// game.js: PROJECTS, KEYS, LABELS). The apps get them with the state; exports and merges don't.
export const LOCAL_FILE = path.join(STATE_DIR, "local.json");
const LOCAL_KEYS = new Set(["pokedex.projects", "pokedex.keys", "pokedex.labels"]);
const local = () => readJson(LOCAL_FILE, {});

export const shared = (key) => (LOCAL_KEYS.has(key) ? local()[key] : load()[key]);
export const allShared = () => ({ ...load(), ...local() });
// Takes `key` out of the save file (used once, to move the old project map to local.json).
export function takeFromSave(key) {
  const all = load();
  if (!(key in all)) return undefined;
  const { [key]: value, ...rest } = all;
  writeJson(FILE, rest);
  cache = rest;
  cacheStamp = "";
  return value;
}
export function setShared(key, value) {
  if (LOCAL_KEYS.has(key)) {
    writeJson(LOCAL_FILE, { ...local(), [key]: structuredClone(value) });
    return;
  }
  const all = { ...load(), [key]: structuredClone(value) };
  writeJson(FILE, all);
  cache = all;
  cacheStamp = "";
}

// One step of the rules at a time, even if a second process (a one-off script) touches the save.
let held = 0;
export function locked(fn) {
  if (held) return fn();
  const until = Date.now() + 2000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      break;
    } catch {
      try {
        // A lock older than 5 s belongs to a process that died holding it.
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 5000) fs.rmdirSync(LOCK);
      } catch {}
      if (Date.now() > until) break;
      Bun.sleepSync(5);
    }
  }
  held++;
  try {
    cacheStamp = "";
    return fn();
  } finally {
    held--;
    try { fs.rmdirSync(LOCK); } catch {}
  }
}

// { sounds: { enabled } }, from config.json in the state folder.
export const settings = () => {
  const c = readJson(path.join(STATE_DIR, "config.json"), {});
  return { ...c, sounds: { enabled: c.sounds?.enabled !== false } };
};

// --- News. The rules call notify(); each note is kept for a day (30 at most) and sent to every
// client with the state. `origin` is who made the call that caused it ("herdr", "rex", plus the
// Rex session as `session`): that app shows it, the others only list it.
let caller = { origin: null, session: null };
export function asCaller(who, fn) {
  const before = caller;
  caller = { origin: who?.origin ?? null, session: who?.session ?? null };
  try { return fn(); } finally { caller = before; }
}
export const notes = () => readJson(NOTES_FILE, []);
export function notify(note) {
  const icon = note.icon ?? null;
  const entry = {
    at: Date.now(), title: note.title, body: note.body ?? "", level: note.level ?? "info",
    // `quiet`: small news (level-ups, items, quests) that clients list but don't pop up.
    id: Number(/(\d+)\.png$/.exec(icon ?? "")?.[1]) || null, encounter: !!note.action, quiet: !!note.quiet,
    icon, action: note.action ?? null, timeout: note.timeout ?? null, origin: caller.origin, session: caller.session,
    // Local fix: a jingle for the app to play, where this server can't (see playSound).
    ...(note.sound ? { sound: note.sound } : {}),
  };
  writeJson(NOTES_FILE, [...notes().filter((n) => Date.now() - n.at < 86400000), entry].slice(-30));
  return "note";
}

// The two jingles (evolution, badge) play on this machine, for whichever app caused them.
const SOUNDS = new Set(["evolve.mp3", "badge.mp3"]);
export function playSound(file) {
  const name = path.basename(String(file ?? ""));
  if (!SOUNDS.has(name) || !settings().sounds.enabled) return null;
  // Local fix: afplay is macOS only. Elsewhere the app that caused it plays it (a quiet note).
  if (process.platform !== "darwin") { notify({ title: "", quiet: true, sound: name }); return null; }
  try {
    Bun.spawn(["afplay", path.join(ROOT, "assets", "sounds", name)], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
  } catch {}
  return null;
}
