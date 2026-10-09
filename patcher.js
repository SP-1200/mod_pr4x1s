// mod_pr4x1s web patcher: builds sp1200eefw.bin from the user's own copy of
// Rossum's Main FW 1.04, in the browser. Mirrors build_file() in
// softboot/build_softboot.py; the pieces that need z80asm and the loader
// assembler come precomputed in recipe.js (softboot/export_web.py).
// The result is checked against the MD5 of the Python build.

export const EE_UPDATER_MD5 = 'f0dea30c970529885f33f0fdb23b4ca3';  // Rossum's sp1200eefw.bin

// ---- MD5 (RFC 1321). WebCrypto has no MD5. ----

const K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export function md5(data) {
  const n = data.length;
  const len = ((n + 8) >>> 6 << 6) + 64;
  const buf = new Uint8Array(len);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(len - 8, n * 8 >>> 0, true);
  dv.setUint32(len - 4, Math.floor(n / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const s = S[(i >> 4) * 4 + (i & 3)];
      const t = (a + f + K[i] + M[g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((w, i) => out.setInt32(i * 4, w, true));
  return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---- LZSS packer: a port of softboot/lzss.py pack(), byte for byte. ----
// Same candidate order (ascending position) and strict '<' ties, so the same
// parse. Candidates beyond MAX_DIST are skipped by a per-prefix start pointer
// instead of one by one, which gives the same result.

const MIN_LEN = 2, MAX_LEN = 15 + MIN_LEN, MAX_DIST = 4096;

export function pack(data) {
  const n = data.length;
  const where = new Map();
  const first = new Map();   // prefix -> index of the first candidate within MAX_DIST
  const cost = new Float64Array(n + 1).fill(Infinity);
  cost[0] = 0;
  const stepI = new Int32Array(n + 1), stepL = new Int32Array(n + 1), stepD = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    if (cost[i] + 9 < cost[i + 1]) {
      cost[i + 1] = cost[i] + 9; stepI[i + 1] = i; stepL[i + 1] = 0; stepD[i + 1] = 0;
    }
    if (i >= n - 1) continue;
    const key = data[i] << 8 | data[i + 1];
    let lst = where.get(key);
    if (!lst) { lst = []; where.set(key, lst); first.set(key, 0); }
    let k = first.get(key);
    while (k < lst.length && i - lst[k] > MAX_DIST) k++;
    first.set(key, k);
    for (; k < lst.length; k++) {
      const j = lst[k], d = i - j;
      let ln = 0;
      while (ln < MAX_LEN && i + ln < n && data[j + ln] === data[i + ln]) ln++;
      const c = cost[i] + 17;
      for (let L = MIN_LEN; L <= ln; L++) {
        if (c < cost[i + L]) { cost[i + L] = c; stepI[i + L] = i; stepL[i + L] = L; stepD[i + L] = d; }
      }
    }
    lst.push(i);
  }
  const items = [];
  for (let k = n; k; k = stepI[k]) items.push(k);
  items.reverse();
  const out = [];
  for (let g = 0; g < items.length; g += 8) {
    const group = items.slice(g, g + 8);
    out.push(group.reduce((f, k, b) => stepL[k] === 0 ? f | 1 << b : f, 0));
    for (const k of group) {
      if (stepL[k] === 0) out.push(data[stepI[k]]);
      else {
        const d = stepD[k] - 1;
        out.push(d & 0xff, (d >> 8) << 4 | (stepL[k] - MIN_LEN));
      }
    }
  }
  return Uint8Array.from(out);
}

// ---- Building the loader ----

const sum16 = (u8, from = 0, to = u8.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += u8[i];
  return s & 0xffff;
};

const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export class PatchError extends Error {}

// Check fw (Uint8Array) is the firmware the recipe was built for. Returns its MD5.
export function checkFirmware(fw, recipe) {
  const sum = md5(fw);
  if (sum === recipe.stockMd5) return sum;
  if (sum === EE_UPDATER_MD5)
    throw new PatchError('This is Rossum\'s EEPROM updater (sp1200eefw.bin), not the main firmware. Use sp1200fw.bin.');
  if (fw.length !== recipe.stockLen)
    throw new PatchError(`This isn't ${recipe.stockName}: it is ${fw.length.toLocaleString()} bytes, expected ${recipe.stockLen.toLocaleString()}.`);
  throw new PatchError(`This isn't an unmodified ${recipe.stockName}: its MD5 is ${sum}, expected ${recipe.stockMd5}.`);
}

// Returns the loader file (Uint8Array, recipe.fileLen bytes).
export function buildLoader(fw, recipe) {
  checkFirmware(fw, recipe);
  const resident = unb64(recipe.resident);
  const image = new Uint8Array(recipe.resBase + resident.length);
  image.set(fw.subarray(0, recipe.osLen));
  for (const [addr, b64] of recipe.patches) image.set(unb64(b64), addr);
  image.set(resident, recipe.resBase);

  const packed = pack(image);
  if (packed.length !== recipe.packedLen)
    throw new PatchError(`Internal error: packed image is ${packed.length} bytes, expected ${recipe.packedLen}.`);
  const head = unb64(recipe.loaderHead);
  const body = new Uint8Array(head.length + packed.length);
  body.set(head);
  body.set(packed, head.length);

  // A 2-byte hole at eeSumAt for the card CPU's EE-image word, padding, then the sum16.
  const at = recipe.eeSumAt;
  const out = new Uint8Array(recipe.fileLen);
  out.set(body.subarray(0, at));
  out.set(body.subarray(at), at + 2);
  const seal = sum16(out, recipe.eeSumFrom, at);
  out[at] = seal & 0xff; out[at + 1] = seal >> 8;
  const s = sum16(out, 0, out.length - 2);
  out[out.length - 2] = s & 0xff; out[out.length - 1] = s >> 8;

  const sum = md5(out);
  if (sum !== recipe.outMd5)
    throw new PatchError(`Internal error: the result's MD5 is ${sum}, expected ${recipe.outMd5}. Please report this.`);
  return out;
}

// ---- Reading the user's file: a .bin, or Rossum's .zip download ----

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Files in a zip, as [{name, data()}], from its central directory.
function zipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new PatchError('This .zip file looks damaged (no central directory).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let e = 0; e < count; e++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new PatchError('This .zip file looks damaged.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    entries.push({
      name,
      async data() {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const raw = u8.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new PatchError(`${name} in the .zip uses an unsupported compression method.`);
      },
    });
  }
  return entries;
}

// The firmware bytes from a dropped file (File or {name, bytes}). Returns {name, data}.
export async function readFirmware(name, bytes) {
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  if (!isZip) return { name, data: bytes };
  const files = zipEntries(bytes).filter(e =>
    !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && !e.name.split('/').pop().startsWith('._'));
  const pick = files.find(e => e.name.split('/').pop().toLowerCase() === 'sp1200fw.bin')
    ?? (files.length === 1 ? files[0] : null);
  if (!pick) throw new PatchError(`No sp1200fw.bin found in ${name}.`);
  return { name: `${name} → ${pick.name}`, data: await pick.data() };
}

// ---- Writing the download zip (stored, no compression) ----

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(u8) {
  let c = 0xffffffff;
  for (const b of u8) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name, data: Uint8Array}], names ASCII. date: the files' timestamp (local time).
export function makeZip(files, date = new Date()) {
  const time = date.getHours() << 11 | date.getMinutes() << 5 | date.getSeconds() >> 1;
  const day = (date.getFullYear() - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nm = new TextEncoder().encode(name);
    const crc = crc32(data);
    const head = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra + nm.length));
      h.setUint32(0, sig, true);
      return h;
    };
    const lh = head(0x04034b50, 30);
    lh.setUint16(4, 20, true);                     // version needed
    lh.setUint16(10, time, true); lh.setUint16(12, day, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nm.length, true);
    new Uint8Array(lh.buffer).set(nm, 30);
    const ch = head(0x02014b50, 46);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(12, time, true); ch.setUint16(14, day, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    new Uint8Array(ch.buffer).set(nm, 46);
    locals.push(new Uint8Array(lh.buffer), data);
    centrals.push(new Uint8Array(ch.buffer));
    offset += lh.byteLength + data.length;
  }
  const cdLen = centrals.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdLen, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
