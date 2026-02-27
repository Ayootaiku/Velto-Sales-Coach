const fs = require('fs');
const path = require('path');

function createPNG(size) {
  const canvas = size;
  const r = Math.floor(size * 0.4);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);

  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      if (dist <= r) {
        const t = dist / r;
        const g = Math.round(255 * (1 - t * 0.3));
        pixels[idx] = Math.round(212 * (1 - t * 0.2));     // R
        pixels[idx + 1] = g;                                 // G
        pixels[idx + 2] = Math.round(50 * (1 - t * 0.5));   // B
        pixels[idx + 3] = 255;                               // A
      } else if (dist <= r + 2) {
        pixels[idx] = 39;
        pixels[idx + 1] = 39;
        pixels[idx + 2] = 46;
        pixels[idx + 3] = 200;
      } else {
        pixels[idx + 3] = 0;
      }
    }
  }

  return encodePNG(pixels, size, size);
}

function encodePNG(pixels, width, height) {
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function makeChunk(type, data) {
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData), 0);
    return Buffer.concat([len, typeData, crc]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }
  const raw = Buffer.from(rawData);

  const blockSize = 65535;
  const blocks = [];
  for (let i = 0; i < raw.length; i += blockSize) {
    const end = Math.min(i + blockSize, raw.length);
    const isLast = end >= raw.length;
    const block = raw.slice(i, end);
    const header = Buffer.alloc(5);
    header[0] = isLast ? 1 : 0;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(~block.length & 0xFFFF, 3);
    blocks.push(header, block);
  }
  const deflated = Buffer.concat(blocks);

  const zlibHeader = Buffer.from([0x78, 0x01]);
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(raw), 0);
  const compressedData = Buffer.concat([zlibHeader, deflated, adler]);

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressedData),
    makeChunk('IEND', iend),
  ]);
}

const iconsDir = path.resolve(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  fs.writeFileSync(path.resolve(iconsDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
}
