// Sharing progress on X: a post's text and a trainer-card image. X's compose link can't carry an
// image, so the card goes to the clipboard and the user pastes it into the post.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { BADGES, trainerLevel, liveStreak, liveWeek, levelOf, nameOf, STREAK_NEED } from "./game.js";

const KANTO = BADGES.filter((b) => !b.rank);
export const SITE = "https://github.com/anthonymq/pokedex-agents-server";

export function shareText(g, caught) {
  const badges = KANTO.filter((b) => g.badges.includes(b.id)).length;
  const shiny = g.shiny.length ? ` (${g.shiny.length} shiny ✦)` : "";
  const streak = liveStreak(g);
  return [
    `My coding agents' Pokedex: ${caught.length}/151 caught${shiny}`,
    `Trainer Lv ${trainerLevel(g)} · ${badges}/8 badges · ${g.tasks} tasks${streak ? ` · ${streak}-day streak` : ""}`,
    "",
    `Gotta catch 'em all while my agents code. #PokedexAgents ${SITE}`,
  ].join("\n");
}

export const intentUrl = (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

// Where the sprites are: the caller's folder, else pokemon-rex's, else pokemon-herdr's.
export function spriteDir(given) {
  const home = os.homedir();
  return [given, path.join(home, ".config/rex/pokedex/assets/pokemon"), path.join(home, ".config/herdr-app/mods/pokedex-agents/pokemon")]
    .find((d) => d && fs.existsSync(path.join(d, "1.png"))) ?? null;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Any non-interlaced 8-bit-or-less PNG (sprites are 4-bit palette) as RGBA.
export function decodePng(buf) {
  let pos = 8, width = 0, height = 0, depth = 8, type = 6, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") [width, height, depth, type] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9]];
    else if (kind === "PLTE") plte = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (depth > 8) throw new Error("16-bit PNGs are not supported");
  const ch = CHANNELS[type], bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((width * ch * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  let row = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const sample = (x) => {
    const bit = x * depth;
    return depth === 8 ? row[x] : (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1), f = raw[at];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = raw[at + 1 + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const k = sample(x);
        out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2];
        out[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (type === 0 || type === 4) {
        const v = type === 0 ? sample(x) * (255 / ((1 << depth) - 1)) : row[x * 2];
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = type === 4 ? row[x * 2 + 1] : 255;
      } else {
        for (let k = 0; k < 3; k++) out[o + k] = row[x * ch + k];
        out[o + 3] = type === 6 ? row[x * 4 + 3] : 255;
      }
    }
    [row, prev] = [prev, row];
  }
  return { width, height, data: out };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(kind, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const C = { screen: hex("#17251f"), panel: hex("#244438"), border: hex("#67866c"), lcd: hex("#d9e8bc"), cream: hex("#f7eed7"), muted: hex("#b6c6b8"), red: hex("#9b293a"), gold: hex("#e8c35a"), shiny: hex("#3d3a1c") };

// 5x7 pixel font, enough for the header.
const FONT = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110", E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001", I: "01110001000010000100001000010001110",
  K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111", M: "10001110111010110101100011000110001",
  N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110", P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101", "-": "00000000000000011111000000000000000",
  R: "11110100011000111110101001001010001", S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100", W: "10001100011000110101101011101110001",
  X: "10001100010101000100010101000110001", Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111",
  0: "01110100011001110101110011000101110", 1: "00100011000010000100001000010001110", 2: "01110100010000100010001000100011111",
  3: "11111000100010000010000011000101110", 4: "00010001100101010010111110001000010", 5: "11111100001111000001000011000101110",
  6: "00110010001000011110100011000101110", 7: "11111000010001000100010000100001000", 8: "01110100011000101110100011000101110",
  9: "01110100011000101111000010001001100", "/": "00001000010001000100010001000010000", ".": "00000000000000000000000000110001100",
  "'": "00100001000100000000000000000000000", "#": "01010010101111101010111110101001010", " ": "00000000000000000000000000000000000",
};

function canvas(width, height, [r, g, b]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  const px = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4, k = a / 255;
    data[o] = Math.round(r * k + data[o] * (1 - k));
    data[o + 1] = Math.round(g * k + data[o + 1] * (1 - k));
    data[o + 2] = Math.round(b * k + data[o + 2] * (1 - k));
  };
  const rect = (x, y, w, h, color) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, color); };
  const text = (x, y, s, color, scale = 3) => {
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] ?? FONT[" "];
      for (let i = 0; i < 35; i++) if (g[i] === "1") rect(x + (i % 5) * scale, y + Math.floor(i / 5) * scale, scale, scale, color);
      x += 6 * scale;
    }
    return x;
  };
  const disc = (cx, cy, r, color) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) px(cx + i, cy + j, color); };
  // Art scaled into a size x size box, cropped to its opaque pixels so it fills the box.
  const art = (img, x, y, size, alpha = 1) => {
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
      if (img.data[(j * img.width + i) * 4 + 3] <= 16) continue;
      x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i); y1 = Math.max(y1, j);
    }
    if (x1 < 0) return;
    const side = Math.max(x1 - x0, y1 - y0) + 1;
    const ox = x0 - Math.floor((side - (x1 - x0 + 1)) / 2), oy = y0 - (side - (y1 - y0 + 1));
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const sx = ox + Math.floor((i * side) / size), sy = oy + Math.floor((j * side) / size);
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const o = (sy * img.width + sx) * 4, a = img.data[o + 3];
      if (a > 16) px(x + i, y + j, [img.data[o], img.data[o + 1], img.data[o + 2]], a * alpha);
    }
  };
  return { width, height, data, rect, text, disc, art };
}

const load = (dir, name) => {
  const file = dir && path.join(dir, `${name}.png`);
  try { return file && fs.existsSync(file) ? decodePng(fs.readFileSync(file)) : null; } catch { return null; }
};

// Badge art sits beside the sprites in pokemon-rex (assets/badges), in pokedex-trainer for Herdr.
export function badgeDir(sprites) {
  const home = os.homedir();
  return [sprites && path.join(sprites, "..", "badges"), path.join(home, ".config/rex/pokedex/assets/badges"), path.join(home, ".config/herdr-app/mods/pokedex-trainer/badges")]
    .find((d) => d && fs.existsSync(path.join(d, "boulder.png"))) ?? null;
}

// The card as PNG bytes, 1200x675 (what X previews whole): the top partner big, the totals,
// the eight badges and the rest of the team. Projects are never named, only their Pokemon.
export function renderCard(g, caught, partners, sprites) {
  const W = 1200, H = 675, X0 = 496, RW = W - 56 - X0;
  const c = canvas(W, H, C.red);
  c.rect(20, 20, W - 40, H - 40, C.border);
  c.rect(24, 24, W - 48, H - 48, C.screen);
  c.disc(78, 72, 26, C.cream);
  c.disc(78, 72, 20, hex("#71d5df"));
  c.disc(72, 66, 6, C.cream);
  c.text(124, 54, "TRAINER CARD", C.cream, 6);
  c.text(W - 56 - 14 * 12, 64, "POKEDEX AGENTS", C.muted, 2);

  // The party, lead first.
  const team = (g.party ?? []).map((id) => [id, g.pokemon?.[id] ?? 0]);

  c.rect(56, 120, 400, 420, C.lcd);
  if (team.length) {
    const [id, xp] = team[0];
    const img = load(sprites, id);
    if (img) c.art(img, 76, 140, 360);
    const lv = `LV ${levelOf(xp)}`;
    c.text(56, 562, nameOf(id), g.shiny.includes(id) ? C.gold : C.cream, 4);
    c.text(456 - lv.length * 24, 562, lv, C.gold, 4);
  } else c.text(92, 320, "NO PARTNER YET", C.panel, 3);

  c.text(X0, 128, `POKEDEX${g.shiny.length ? `  ${g.shiny.length} SHINY` : ""}`, C.muted, 2);
  c.text(X0, 152, `${caught.length}/151`, C.gold, 5);
  c.rect(X0, 200, RW, 16, C.panel);
  c.rect(X0, 200, Math.round((RW * caught.length) / 151), 16, hex("#71d5df"));

  const streak = liveStreak(g);
  // A streak shows its days; until one starts, the week's active days toward it.
  const third = streak ? ["STREAK", `${streak} DAY${streak > 1 ? "S" : ""}`] : ["THIS WEEK", `${liveWeek(g)}/${STREAK_NEED}`];
  const stats = [["TRAINER LV", trainerLevel(g)], ["TASKS", g.tasks], third];
  const sw = Math.floor((RW - 24) / 3);
  stats.forEach(([label, value], i) => {
    const x = X0 + i * (sw + 12);
    c.rect(x, 236, sw, 84, C.panel);
    c.text(x + 14, 250, label, C.muted, 2);
    c.text(x + 14, 278, value, C.cream, 4);
  });

  c.text(X0, 340, `BADGES  ${KANTO.filter((b) => g.badges.includes(b.id)).length}/8`, C.muted, 2);
  const badges = badgeDir(sprites);
  KANTO.forEach((b, i) => {
    const x = X0 + i * 78, got = g.badges.includes(b.id), img = load(badges, b.id);
    if (img) c.art(img, x, 366, 64, got ? 1 : 0.15);
    else c.disc(x + 32, 398, 28, got ? hex(b.color) : C.panel);
  });

  c.text(X0, 452, "TEAM", C.muted, 2);
  team.slice(1, 7).forEach(([id, xp], i) => {
    const x = X0 + i * 110, img = load(sprites, id);
    c.rect(x, 476, 96, 96, g.shiny.includes(id) ? C.shiny : C.panel);
    if (img) c.art(img, x + 8, 484, 80);
    c.text(x, 582, `LV ${levelOf(xp)}`, C.cream, 2);
  });

  c.text(56, 622, "#POKEDEXAGENTS", hex("#71d5df"), 2);
  const site = SITE.replace("https://", "").toUpperCase();
  c.text(W - 56 - site.length * 12, 622, site, C.border, 2);
  return encodePng(c);
}

// Puts a PNG file on the macOS clipboard. Elsewhere (or when it fails) the card stays a file.
export async function copyImage(file) {
  if (process.env.POKEDEX_NO_CLIPBOARD) return false;
  // Local fix: Linux. WSL puts it on the Windows clipboard; else wl-copy (Wayland) or xclip (X11).
  if (process.platform === "linux") {
    const run = async (argv, input) => {
      try {
        const proc = Bun.spawn(argv, { stdin: input ? Bun.file(input) : "ignore", stdout: "pipe", stderr: "ignore" });
        const out = await new Response(proc.stdout).text();
        return (await proc.exited) === 0 ? out : null;
      } catch { return null; }
    };
    const win = (await run(["wslpath", "-w", file]))?.trim();
    if (win) {
      const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $i = [System.Drawing.Image]::FromFile('${win.replace(/'/g, "''")}'); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose()`;
      if ((await run(["powershell.exe", "-NoProfile", "-STA", "-Command", ps])) !== null) return true;
    }
    if (process.env.WAYLAND_DISPLAY && (await run(["wl-copy", "--type", "image/png"], file)) !== null) return true;
    if (process.env.DISPLAY && (await run(["xclip", "-selection", "clipboard", "-t", "image/png", "-i", file])) !== null) return true;
    return false;
  }
  if (process.platform !== "darwin") return false;
  const proc = Bun.spawn(["osascript", "-e", `set the clipboard to (read (POSIX file ${JSON.stringify(file)}) as «class PNGf»)`], { stdout: "ignore", stderr: "pipe" });
  return (await proc.exited) === 0;
}
