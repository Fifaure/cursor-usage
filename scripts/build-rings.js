const fs = require('fs');
const path = require('path');
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const WOFF_PATH = path.join(ROOT, 'media', 'usage-rings.woff');

const CX = 512;
const CY = 512;
const R = 448;
// Same width for empty track and fill (~2px at 16px status-bar size).
const INNER = 320;
const TRACK_CP = 0xe100;
const FILL_CP = (p) => 0xe100 + p;
const RING_CP = (p) => 0xe000 + p;
const FOREGROUND = 0xffff;
const TRACK_BGRA = [0x5a, 0x5a, 0x5a, 0xff];

function pt(deg, rad) {
  const a = (deg * Math.PI) / 180;
  return [CX + rad * Math.cos(a), CY + rad * Math.sin(a)];
}

function fullAnnulus(outer, inner) {
  return [
    `M ${CX} ${CY + outer}`,
    `A ${outer} ${outer} 0 1 0 ${CX} ${CY - outer}`,
    `A ${outer} ${outer} 0 1 0 ${CX} ${CY + outer} Z`,
    `M ${CX} ${CY + inner}`,
    `A ${inner} ${inner} 0 1 1 ${CX} ${CY - inner}`,
    `A ${inner} ${inner} 0 1 1 ${CX} ${CY + inner} Z`,
  ].join(' ');
}

function fillArc(percent) {
  const f = (n) => n.toFixed(2);
  if (percent >= 100) {
    return fullAnnulus(R, INNER);
  }
  const startDeg = 90;
  const sweepDeg = 360 * (percent / 100);
  const endDeg = startDeg - sweepDeg;
  const large = sweepDeg > 180 ? 1 : 0;
  const [x0, y0] = pt(startDeg, R);
  const [x1, y1] = pt(endDeg, R);
  const [ix1, iy1] = pt(endDeg, INNER);
  const [ix0, iy0] = pt(startDeg, INNER);
  return [
    `M ${f(x0)} ${f(y0)}`,
    `A ${R} ${R} 0 ${large} 0 ${f(x1)} ${f(y1)}`,
    `L ${f(ix1)} ${f(iy1)}`,
    `A ${INNER} ${INNER} 0 ${large} 1 ${f(ix0)} ${f(iy0)} Z`,
  ].join(' ');
}

// svg2ttf merges identical outlines; a 1-unit square keeps each glyph distinct.
function dust(id) {
  const x = 4 + (id % 40);
  const y = 4 + Math.floor(id / 40);
  return `M ${x} ${y} L ${x + 1} ${y} L ${x + 1} ${y + 1} L ${x} ${y + 1} Z`;
}

function glyph(cp, name, d, id) {
  const hex = cp.toString(16);
  return `<glyph unicode="&#x${hex};" glyph-name="${name}" horiz-adv-x="1024" d="${d} ${dust(id)}"/>`;
}

function svgFont() {
  const glyphs = [glyph(TRACK_CP, 'usage-track', fullAnnulus(R, INNER), 400)];
  for (let p = 1; p <= 100; p++) {
    glyphs.push(glyph(FILL_CP(p), `usage-fill-${p}`, fillArc(p), 500 + p));
  }
  for (let p = 0; p <= 100; p++) {
    const d = p <= 0 ? fullAnnulus(R, INNER) : fillArc(p);
    glyphs.push(glyph(RING_CP(p), `usage-ring-${p}`, d, p));
  }
  return `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg">
<defs>
<font id="usage-rings" horiz-adv-x="1024">
<font-face font-family="usage-rings" units-per-em="1024" ascent="1024" descent="0"/>
<missing-glyph horiz-adv-x="1024"/>
${glyphs.join('\n')}
</font>
</defs>
</svg>
`;
}

function readSfnt(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString('ascii', off, off + 4);
    const offset = buf.readUInt32BE(off + 8);
    const length = buf.readUInt32BE(off + 12);
    tables[tag] = buf.subarray(offset, offset + length);
  }
  return { flavor: buf.readUInt32BE(0), tables };
}

function tableChecksum(data) {
  const padded = Buffer.alloc((data.length + 3) & ~3);
  data.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + padded.readUInt32BE(i)) >>> 0;
  }
  return sum;
}

function buildSfnt(flavor, tables) {
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector += 1;
  }
  const headerSize = 12 + numTables * 16;
  const paddedBodies = [];
  let bodySize = 0;
  for (const tag of tags) {
    const data = Buffer.from(tables[tag]);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    paddedBodies.push({ tag, data, padded, length: data.length });
    bodySize += padded.length;
  }
  const out = Buffer.alloc(headerSize + bodySize);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange * 16, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange * 16, 10);
  let offset = headerSize;
  paddedBodies.forEach((body, i) => {
    const rec = 12 + i * 16;
    out.write(body.tag, rec, 4, 'ascii');
    out.writeUInt32BE(tableChecksum(body.padded), rec + 4);
    out.writeUInt32BE(offset, rec + 8);
    out.writeUInt32BE(body.length, rec + 12);
    body.padded.copy(out, offset);
    offset += body.padded.length;
  });
  const head = paddedBodies.find((b) => b.tag === 'head');
  if (!head) {
    throw new Error('missing head table');
  }
  const headOff = out.readUInt32BE(12 + paddedBodies.indexOf(head) * 16 + 8);
  out.writeUInt32BE(0, headOff + 8);
  let fontSum = 0;
  for (let i = 0; i < out.length; i += 4) {
    const slice = out.length - i >= 4 ? out.readUInt32BE(i) : 0;
    fontSum = (fontSum + slice) >>> 0;
  }
  out.writeUInt32BE((0xb1b0afba - fontSum) >>> 0, headOff + 8);
  return out;
}

function parseCmap(cmap) {
  const numTables = cmap.readUInt16BE(2);
  let subOff;
  for (let i = 0; i < numTables; i++) {
    const plat = cmap.readUInt16BE(4 + i * 8);
    const enc = cmap.readUInt16BE(4 + i * 8 + 2);
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (plat === 3 && (enc === 1 || enc === 10)) {
      subOff = offset;
      break;
    }
    if (subOff === undefined && plat === 0) {
      subOff = offset;
    }
  }
  if (subOff === undefined) {
    throw new Error('no cmap subtable');
  }
  const format = cmap.readUInt16BE(subOff);
  const map = new Map();
  if (format === 4) {
    const segCount = cmap.readUInt16BE(subOff + 6) / 2;
    let p = subOff + 14;
    const endCode = [];
    for (let i = 0; i < segCount; i++, p += 2) {
      endCode.push(cmap.readUInt16BE(p));
    }
    p += 2;
    const startCode = [];
    for (let i = 0; i < segCount; i++, p += 2) {
      startCode.push(cmap.readUInt16BE(p));
    }
    const idDelta = [];
    for (let i = 0; i < segCount; i++, p += 2) {
      idDelta.push(cmap.readInt16BE(p));
    }
    const idRangeOffsetPos = p;
    const idRangeOffset = [];
    for (let i = 0; i < segCount; i++, p += 2) {
      idRangeOffset.push(cmap.readUInt16BE(p));
    }
    for (let i = 0; i < segCount; i++) {
      for (let c = startCode[i]; c <= endCode[i]; c++) {
        let gid = 0;
        if (idRangeOffset[i] === 0) {
          gid = (c + idDelta[i]) & 0xffff;
        } else {
          const addr = idRangeOffsetPos + i * 2 + idRangeOffset[i] + (c - startCode[i]) * 2;
          gid = cmap.readUInt16BE(addr);
          if (gid !== 0) {
            gid = (gid + idDelta[i]) & 0xffff;
          }
        }
        if (gid) {
          map.set(c, gid);
        }
      }
    }
    return map;
  }
  if (format === 12) {
    const nGroups = cmap.readUInt32BE(subOff + 12);
    let p = subOff + 16;
    for (let i = 0; i < nGroups; i++, p += 12) {
      const start = cmap.readUInt32BE(p);
      const end = cmap.readUInt32BE(p + 4);
      let gid = cmap.readUInt32BE(p + 8);
      for (let c = start; c <= end; c++, gid++) {
        map.set(c, gid);
      }
    }
    return map;
  }
  throw new Error(`unsupported cmap format ${format}`);
}

function buildCPAL() {
  const buf = Buffer.alloc(18);
  buf.writeUInt16BE(0, 0);
  buf.writeUInt16BE(1, 2);
  buf.writeUInt16BE(1, 4);
  buf.writeUInt16BE(1, 6);
  buf.writeUInt32BE(14, 8);
  buf.writeUInt16BE(0, 12);
  buf[14] = TRACK_BGRA[0];
  buf[15] = TRACK_BGRA[1];
  buf[16] = TRACK_BGRA[2];
  buf[17] = TRACK_BGRA[3];
  return buf;
}

function buildCOLR(cmap) {
  const trackGid = cmap.get(TRACK_CP);
  if (!trackGid) {
    throw new Error('missing track glyph');
  }
  const bases = [];
  const layers = [];
  for (let p = 0; p <= 100; p++) {
    const gid = cmap.get(RING_CP(p));
    if (!gid) {
      throw new Error(`missing ring glyph ${p}`);
    }
    const first = layers.length;
    if (p < 100) {
      layers.push({ gid: trackGid, palette: 0 });
    }
    if (p > 0) {
      const fillGid = cmap.get(FILL_CP(p));
      if (!fillGid) {
        throw new Error(`missing fill glyph ${p}`);
      }
      if (fillGid === trackGid || fillGid === gid) {
        throw new Error(`fill glyph ${p} was merged with another outline`);
      }
      layers.push({ gid: fillGid, palette: FOREGROUND });
    }
    bases.push({ gid, first, count: layers.length - first });
  }
  const seen = new Set();
  for (const b of bases) {
    if (seen.has(b.gid)) {
      throw new Error(`duplicate base glyph id ${b.gid}`);
    }
    seen.add(b.gid);
  }
  bases.sort((a, b) => a.gid - b.gid);
  const header = 14;
  const buf = Buffer.alloc(header + bases.length * 6 + layers.length * 4);
  buf.writeUInt16BE(0, 0);
  buf.writeUInt16BE(bases.length, 2);
  buf.writeUInt32BE(header, 4);
  buf.writeUInt32BE(header + bases.length * 6, 8);
  buf.writeUInt16BE(layers.length, 12);
  bases.forEach((b, i) => {
    const off = header + i * 6;
    buf.writeUInt16BE(b.gid, off);
    buf.writeUInt16BE(b.first, off + 2);
    buf.writeUInt16BE(b.count, off + 4);
  });
  const layerOff = header + bases.length * 6;
  layers.forEach((layer, i) => {
    const off = layerOff + i * 4;
    buf.writeUInt16BE(layer.gid, off);
    buf.writeUInt16BE(layer.palette, off + 2);
  });
  return buf;
}

function main() {
  fs.mkdirSync(path.dirname(WOFF_PATH), { recursive: true });
  const ttf = Buffer.from(svg2ttf(svgFont(), {}).buffer);
  const sfnt = readSfnt(ttf);
  const cmap = parseCmap(Buffer.from(sfnt.tables.cmap));
  sfnt.tables.COLR = buildCOLR(cmap);
  sfnt.tables.CPAL = buildCPAL();
  const colored = buildSfnt(sfnt.flavor, sfnt.tables);
  const woff = ttf2woff(new Uint8Array(colored));
  fs.writeFileSync(WOFF_PATH, Buffer.from(woff.buffer));

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const icons = {};
  for (let p = 0; p <= 100; p++) {
    icons[`usage-ring-${p}`] = {
      description: `Usage ring ${p}%`,
      default: {
        fontPath: 'media/usage-rings.woff',
        fontCharacter: `\\${RING_CP(p).toString(16)}`,
      },
    };
  }
  pkg.contributes = { icons };
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`wrote ${WOFF_PATH} (${woff.buffer.byteLength} bytes)`);
}

main();
