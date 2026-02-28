#!/usr/bin/env node
/**
 * Generates a simple 48×48 PNG icon for the Subly Chrome extension.
 * Uses only Node.js built-ins (zlib + fs). Run: node scripts/generate-icon.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function generatePng(size, label) {
  const width = size;
  const height = size;

  // Build raw RGBA pixel data row by row (filter byte 0 = None, then RGB)
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const cx = width / 2;
      const cy = height / 2;
      const radius = width / 2 - 1;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      let r, g, b;
      if (dist <= radius) {
        // Gradient from purple (#7c3aed) to blue (#3b82f6) based on position
        const t = (x / width + y / height) / 2;
        r = Math.round(0x7c + (0x3b - 0x7c) * t);
        g = Math.round(0x3a + (0x82 - 0x3a) * t);
        b = Math.round(0xed + (0xf6 - 0xed) * t);

        // Draw "S" letter in white for larger sizes
        if (size >= 48) {
          const sx = x - cx;
          const sy = y - cy;
          const sFrac = size / 48;
          // Simple pixel "S": top bar, middle bar, bottom bar + curves
          const thick = Math.round(3 * sFrac);
          const hw = Math.round(9 * sFrac);
          const hh = Math.round(12 * sFrac);
          // top horizontal
          if (sy >= -hh && sy <= -hh + thick && sx >= -hw && sx <= hw) { r = g = b = 255; }
          // middle horizontal
          if (sy >= -thick / 2 && sy <= thick / 2 && sx >= -hw && sx <= hw) { r = g = b = 255; }
          // bottom horizontal
          if (sy >= hh - thick && sy <= hh && sx >= -hw && sx <= hw) { r = g = b = 255; }
          // left side top
          if (sx >= -hw && sx <= -hw + thick && sy >= -hh && sy <= 0) { r = g = b = 255; }
          // right side bottom
          if (sx >= hw - thick && sx <= hw && sy >= 0 && sy <= hh) { r = g = b = 255; }
        }
      } else {
        // Dark background
        r = 10; g = 10; b = 15;
      }

      row[1 + x * 3] = r;
      row[1 + x * 3 + 1] = g;
      row[1 + x * 3 + 2] = b;
    }
    rows.push(row);
  }

  const rawData = Buffer.concat(rows);
  const compressedData = zlib.deflateSync(rawData, { level: 9 });

  // PNG helpers
  function uint32be(val) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(val >>> 0, 0);
    return buf;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBytes, data]);
    return Buffer.concat([uint32be(data.length), typeBytes, data, uint32be(crc32(crcInput))]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressedData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'extension', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = generatePng(size, 'S');
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`✓ Generated icon${size}.png`);
}

console.log('\nIcons saved to extension/public/icons/');
