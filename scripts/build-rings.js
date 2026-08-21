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
const RI = 320;

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

function ringPath(percent) {
  const f = (n) => n.toFixed(2);
  const track = fullAnnulus(R, 400);
  if (percent <= 0) {
    return track;
  }
  if (percent >= 100) {
    return fullAnnulus(R, RI);
  }
  const startDeg = 90;
  const sweepDeg = 360 * (percent / 100);
  const endDeg = startDeg - sweepDeg;
  const large = sweepDeg > 180 ? 1 : 0;
  const [x0, y0] = pt(startDeg, R);
  const [x1, y1] = pt(endDeg, R);
  const [ix1, iy1] = pt(endDeg, RI);
  const [ix0, iy0] = pt(startDeg, RI);
  const fill = [
    `M ${f(x0)} ${f(y0)}`,
    `A ${R} ${R} 0 ${large} 0 ${f(x1)} ${f(y1)}`,
    `L ${f(ix1)} ${f(iy1)}`,
    `A ${RI} ${RI} 0 ${large} 1 ${f(ix0)} ${f(iy0)} Z`,
  ].join(' ');
  return `${track} ${fill}`;
}

function svgFont() {
  const glyphs = [];
  for (let p = 0; p <= 100; p++) {
    const d = ringPath(p);
    const hex = (0xe000 + p).toString(16);
    glyphs.push(
      `<glyph unicode="&#x${hex};" glyph-name="usage-ring-${p}" horiz-adv-x="1024" d="${d}"/>`
    );
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

function main() {
  fs.mkdirSync(path.dirname(WOFF_PATH), { recursive: true });
  const ttf = svg2ttf(svgFont(), {});
  const woff = ttf2woff(new Uint8Array(ttf.buffer));
  fs.writeFileSync(WOFF_PATH, Buffer.from(woff.buffer));

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const icons = {};
  for (let p = 0; p <= 100; p++) {
    icons[`usage-ring-${p}`] = {
      description: `Usage ring ${p}%`,
      default: {
        fontPath: 'media/usage-rings.woff',
        fontCharacter: `\\${(0xe000 + p).toString(16)}`,
      },
    };
  }
  pkg.contributes = { icons };
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`wrote ${WOFF_PATH} (${woff.buffer.byteLength} bytes)`);
}

main();
