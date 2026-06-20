import { describe, it, expect, beforeAll } from 'vitest';
import piexifLib from 'piexifjs';
import {
  isPng,
  parsePngChunks,
  readPngDimensions,
  listStrippableChunks,
  stripPngMetadata,
  pngTrailingByteCount,
  PngError,
} from '../src/exif/png.js';

let jpeg;

beforeAll(async () => {
  // Browser loads piexif as a global <script>; mirror that for tests.
  globalThis.piexif = piexifLib;
  jpeg = await import('../src/exif/jpeg.js');
});

// 2×2 JPEG carrying GPS (40.4461, -79.9822), Make "TestCam", Orientation 6.
const JPEG_WITH_EXIF_B64 =
  '/9j/4QCkRXhpZgAATU0AKgAAAAgAAwEPAAIAAAAIAAAAMgESAAMAAAABAAYAAIglAAQAAAABAAAAOgAAAABUZXN0Q2FtAAAEAAEAAgAAAAJOAAAAAAIABQAAAAMAAABsAAMAAgAAAAJXAAAAAAQABQAAAAMAAACEAAAAKAAAAAEAAAAaAAAAAQAAEgQAAABkAAAATwAAAAEAAAA6AAAAAQAAFccAAABk/+AAEEpGSUYAAQEAAAEAAQAA/9sAQwAICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI/8AACwgAAgACAQERAP/aAAgBAQAAPwAA/9k=';

// 2×2 RGBA PNG with a tRNS (transparency) chunk and a tEXt metadata chunk.
const PNG_WITH_TEXT_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAnRSTlMA/1uRIrUAAAAcdEVYdENvbW1lbnQAc2VjcmV0IGxvY2F0aW9uIGRhdGFU6E9UAAAABUlEQVQAAQIDBNv0fRgAAAAASUVORK5CYII=';

function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('JPEG EXIF strip', () => {
  it('reads the SOF dimensions', () => {
    expect(jpeg.readJpegDimensions(b64ToBytes(JPEG_WITH_EXIF_B64))).toEqual({ width: 2, height: 2 });
  });

  it('detects GPS, make and orientation before stripping', () => {
    const s = jpeg.readExifSummary(b64ToBytes(JPEG_WITH_EXIF_B64));
    expect(s.gps).toMatch(/^40\.4461/);
    expect(s.make).toBe('TestCam');
    expect(s.orientation).toBe(6);
  });

  it('removes GPS and camera but preserves Orientation', () => {
    const cleaned = jpeg.stripJpegMetadata(b64ToBytes(JPEG_WITH_EXIF_B64));
    const after = jpeg.readExifSummary(cleaned);
    expect(after.gps).toBeNull();
    expect(after.make).toBeNull();
    expect(after.orientation).toBe(6);
  });

  it('keeps the image dimensions intact after stripping', () => {
    const cleaned = jpeg.stripJpegMetadata(b64ToBytes(JPEG_WITH_EXIF_B64));
    expect(jpeg.readJpegDimensions(cleaned)).toEqual({ width: 2, height: 2 });
  });

  it('filterExifKeepOrientation keeps only the orientation tag', () => {
    const filtered = jpeg.filterExifKeepOrientation({ '0th': { 274: 8, 271: 'Cam' }, GPS: { 2: 'x' } });
    expect(filtered['0th'][274]).toBe(8);
    expect(filtered['0th'][271]).toBeUndefined();
    expect(Object.keys(filtered.GPS).length).toBe(0);
  });
});

describe('PNG metadata strip', () => {
  it('recognizes a PNG signature', () => {
    expect(isPng(b64ToBytes(PNG_WITH_TEXT_B64))).toBe(true);
    expect(isPng(b64ToBytes(JPEG_WITH_EXIF_B64))).toBe(false);
  });

  it('reads IHDR dimensions', () => {
    expect(readPngDimensions(b64ToBytes(PNG_WITH_TEXT_B64))).toEqual({ width: 2, height: 2 });
  });

  it('flags the tEXt chunk as strippable', () => {
    expect(listStrippableChunks(b64ToBytes(PNG_WITH_TEXT_B64))).toContain('tEXt');
  });

  it('strips tEXt but keeps render-critical chunks including tRNS', () => {
    const cleaned = stripPngMetadata(b64ToBytes(PNG_WITH_TEXT_B64));
    const types = parsePngChunks(cleaned).map((c) => c.type);
    expect(types).toContain('IHDR');
    expect(types).toContain('IDAT');
    expect(types).toContain('IEND');
    expect(types).toContain('tRNS'); // transparency preserved
    expect(types).not.toContain('tEXt');
  });

  it('preserves dimensions after stripping', () => {
    const cleaned = stripPngMetadata(b64ToBytes(PNG_WITH_TEXT_B64));
    expect(readPngDimensions(cleaned)).toEqual({ width: 2, height: 2 });
  });

  it('rejects non-PNG input', () => {
    expect(() => parsePngChunks(b64ToBytes(JPEG_WITH_EXIF_B64))).toThrow(PngError);
  });
});

// ---- Hardened stripping: XMP / IPTC / ICC / trailing (JPEG), eXIf / AI text /
// trailing (PNG). These guard against the "removed EXIF but leaked the rest" class
// of bug. Fixtures are built in-test by injecting metadata containers. ----

const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
function concatBytes(arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
function jpegSegment(marker, dataStr) {
  const data = latin1(dataStr);
  const len = data.length + 2;
  return concatBytes([Uint8Array.of(0xff, marker, (len >> 8) & 0xff, len & 0xff), data]);
}
// Inject XMP (APP1) + IPTC (APP13) right after SOI, plus trailing data after EOI.
function jpegWithExtraMetadata() {
  const base = b64ToBytes(JPEG_WITH_EXIF_B64);
  const xmp = jpegSegment(0xe1,
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><dc:creator>SECRET_NAME</dc:creator>' +
    '<exif:GPSLatitude>40,26.766N</exif:GPSLatitude></x:xmpmeta>');
  const iptc = jpegSegment(0xed, 'Photoshop 3.0\x008BIM\x04\x04\x00\x00\x00\x0aIPTC_SECRET');
  return concatBytes([base.subarray(0, 2), xmp, iptc, base.subarray(2), latin1('TRAILING_JPEG_SECRET')]);
}

function pngChunk(type, dataBytes) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, dataBytes.length, false);
  return concatBytes([len, latin1(type), dataBytes, Uint8Array.of(0, 0, 0, 0)]); // CRC faked (parser ignores)
}
function pngWithExtraMetadata() {
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 2, false); dv.setUint32(4, 2, false); ihdr[8] = 8; ihdr[9] = 6;
  return concatBytes([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', latin1('parameters\0prompt: SECRET_PROMPT, seed: 12345')), // A1111 / ComfyUI style
    pngChunk('iTXt', latin1('XML:com.adobe.xmp\0\0\0\0\0SECRET_XMP')),
    pngChunk('eXIf', latin1('II*\0SECRET_PNG_EXIF')), // PNG-can-carry-EXIF (2017+)
    pngChunk('tIME', Uint8Array.of(7, 0xe8, 1, 1, 0, 0, 0)),
    pngChunk('tRNS', Uint8Array.of(0, 255)),
    pngChunk('IDAT', Uint8Array.of(0x78, 0x9c, 0x62, 0, 0, 0, 0, 0xff, 0xff)),
    pngChunk('IEND', new Uint8Array(0)),
    latin1('TRAILING_PNG_SECRET'),
  ]);
}
const asLatin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('JPEG hardened strip (XMP / IPTC / trailing)', () => {
  it('detects XMP, IPTC and trailing data before stripping', () => {
    const found = jpeg.scanJpegMetadata(jpegWithExtraMetadata());
    expect(found.xmp).toBe(true);
    expect(found.iptc).toBe(true);
    expect(found.exif).toBe(true);
    expect(found.trailing).toBe(true);
  });

  it('removes XMP, IPTC and trailing data', () => {
    const out = asLatin1(jpeg.stripJpegMetadata(jpegWithExtraMetadata()));
    expect(out.includes('ns.adobe.com/xap')).toBe(false); // XMP gone
    expect(out.includes('SECRET_NAME')).toBe(false);      // XMP creator gone
    expect(out.includes('Photoshop 3.0')).toBe(false);    // IPTC gone
    expect(out.includes('IPTC_SECRET')).toBe(false);
    expect(out.includes('TRAILING_JPEG_SECRET')).toBe(false); // trailing gone
  });

  it('after strip, a re-scan finds no metadata containers', () => {
    const cleaned = jpeg.stripJpegMetadata(jpegWithExtraMetadata());
    const found = jpeg.scanJpegMetadata(cleaned);
    expect(found.xmp).toBe(false);
    expect(found.iptc).toBe(false);
    expect(found.trailing).toBe(false);
  });

  it('still preserves Orientation and decodable dimensions after the broader strip', () => {
    const cleaned = jpeg.stripJpegMetadata(jpegWithExtraMetadata());
    expect(jpeg.readJpegDimensions(cleaned)).toEqual({ width: 2, height: 2 });
    expect(jpeg.readExifSummary(cleaned).orientation).toBe(6);
    expect(jpeg.readExifSummary(cleaned).gps).toBeNull();
  });
});

describe('PNG hardened strip (eXIf / AI text / trailing)', () => {
  it('flags eXIf, AI text, iTXt and tIME as strippable; counts trailing bytes', () => {
    const png = pngWithExtraMetadata();
    const strip = listStrippableChunks(png);
    expect(strip).toEqual(expect.arrayContaining(['tEXt', 'iTXt', 'eXIf', 'tIME']));
    expect(pngTrailingByteCount(png)).toBe('TRAILING_PNG_SECRET'.length);
  });

  it('removes eXIf, the AI workflow text chunk, XMP and trailing data', () => {
    const out = asLatin1(stripPngMetadata(pngWithExtraMetadata()));
    expect(out.includes('SECRET_PROMPT')).toBe(false);   // ComfyUI/A1111 prompt gone
    expect(out.includes('SECRET_XMP')).toBe(false);
    expect(out.includes('SECRET_PNG_EXIF')).toBe(false);  // PNG eXIf gone
    expect(out.includes('TRAILING_PNG_SECRET')).toBe(false);
  });

  it('keeps render-critical chunks (IHDR/IDAT/IEND/tRNS) and no trailing remains', () => {
    const cleaned = stripPngMetadata(pngWithExtraMetadata());
    const types = parsePngChunks(cleaned).map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(['IHDR', 'IDAT', 'IEND', 'tRNS']));
    expect(types).not.toContain('eXIf');
    expect(pngTrailingByteCount(cleaned)).toBe(0);
  });
});
