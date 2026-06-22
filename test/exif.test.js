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

  it('M3: a stripped photo with Orientation reads clean by CONTENT, though an EXIF container remains', () => {
    // The strip re-inserts an Orientation-only EXIF block so cleaned photos are not
    // shown rotated, so a raw container scan still reports an EXIF segment present...
    const cleaned = jpeg.stripJpegMetadata(b64ToBytes(JPEG_WITH_EXIF_B64));
    expect(jpeg.scanJpegMetadata(cleaned).exif).toBe(true);
    // ...but NO identifying content survives — which is what the UI verdict checks
    // after audit-6 M3 (so the cleaner no longer falsely warns on phone photos).
    const after = jpeg.readExifSummary(cleaned);
    expect(after.gps).toBeNull();
    expect(after.make).toBeNull();
    expect(after.model).toBeNull();
    expect(after.dateTime).toBeNull();
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

describe('JPEG JFIF thumbnail normalization', () => {
  it('drops the JFIF APP0 embedded thumbnail and JFXX segment', () => {
    // SOI + APP0(JFIF, 1x1 thumbnail = 3 bytes) + minimal SOF0 + EOI.
    const app0 = [
      0xff, 0xe0, 0x00, 0x13, // marker + length 19
      0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x02, // version 1.2
      0x00, // units
      0x00, 0x48, 0x00, 0x48, // density 72x72
      0x01, 0x01, // Xthumb=1 Ythumb=1
      0xaa, 0xbb, 0xcc, // 3-byte RGB thumbnail
    ];
    const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00];
    const bytes = new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
    const out = jpeg.stripJpegMetadata(bytes);
    // APP0 length must now be 16 (no thumbnail) and the 0xaabbcc bytes gone.
    let i = 2;
    expect(out[i]).toBe(0xff); expect(out[i + 1]).toBe(0xe0);
    const len = (out[i + 2] << 8) + out[i + 3];
    expect(len).toBe(16);
    expect(Array.from(out)).not.toEqual(expect.arrayContaining([0xaa, 0xbb, 0xcc]));
  });
});

// ---- M3: metadata placed AFTER the first scan must NOT survive the strip, and
// detection (scanJpegMetadata) must agree with removal (stripJpegMetadata). The
// first SOS is not the end of the JPEG walk. ----

// Minimal structurally-walkable JPEG pieces. SOF0 declares 2x2 so
// readJpegDimensions succeeds. Scan data is a short non-marker blob.
const SOF0_2x2 = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00];
const SOS_HEADER = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const SCAN_DATA = [0x12, 0x34, 0x56, 0xff, 0x00, 0x65]; // includes a stuffed 0xff00

describe('JPEG metadata after the first scan (M3)', () => {
  it('strips a COM segment placed after the scan data before EOI, and scan/strip agree', () => {
    const com = jpegSegment(0xfe, 'COM_AFTER_SCAN_SECRET');
    const bytes = concatBytes([
      Uint8Array.of(0xff, 0xd8),
      Uint8Array.from(SOF0_2x2),
      Uint8Array.from(SOS_HEADER),
      Uint8Array.from(SCAN_DATA),
      com,                       // comment AFTER the scan, before EOI
      Uint8Array.of(0xff, 0xd9), // EOI
    ]);
    // Detection must see the comment even though it is past the first SOS.
    expect(jpeg.scanJpegMetadata(bytes).comment).toBe(true);

    const cleaned = jpeg.stripJpegMetadata(bytes);
    const out = asLatin1(cleaned);
    expect(out.includes('COM_AFTER_SCAN_SECRET')).toBe(false); // comment gone
    // Removal and detection agree: a re-scan finds nothing.
    expect(jpeg.scanJpegMetadata(cleaned).comment).toBe(false);
    // The image is still decodable.
    expect(jpeg.readJpegDimensions(cleaned)).toEqual({ width: 2, height: 2 });
  });

  it('strips an APP1/Exif segment placed between two SOS scans', () => {
    const exif = jpegSegment(0xe1, 'Exif\0\0BETWEEN_SCANS_SECRET');
    const bytes = concatBytes([
      Uint8Array.of(0xff, 0xd8),
      Uint8Array.from(SOF0_2x2),
      Uint8Array.from(SOS_HEADER),   // first scan
      Uint8Array.from(SCAN_DATA),
      exif,                          // EXIF between the two scans
      Uint8Array.from(SOS_HEADER),   // second scan
      Uint8Array.from(SCAN_DATA),
      Uint8Array.of(0xff, 0xd9),     // EOI
    ]);
    // Detection sees the EXIF that lives after the first scan.
    expect(jpeg.scanJpegMetadata(bytes).exif).toBe(true);

    const cleaned = jpeg.stripJpegMetadata(bytes);
    const out = asLatin1(cleaned);
    expect(out.includes('BETWEEN_SCANS_SECRET')).toBe(false); // EXIF payload gone
    // Both scans must survive (two SOS markers remain).
    let sosCount = 0;
    for (let k = 0; k + 1 < cleaned.length; k++) {
      if (cleaned[k] === 0xff && cleaned[k + 1] === 0xda) sosCount++;
    }
    expect(sosCount).toBe(2);
    // readJpegDimensions still succeeds.
    expect(jpeg.readJpegDimensions(cleaned)).toEqual({ width: 2, height: 2 });
  });
});

describe('JPEG crafted entropy robustness (audit-5)', () => {
  it('does not truncate the scan on a crafted 0xFF 0xFF <non-marker> sequence', () => {
    // 0xFF inside entropy is only valid before 0x00 (stuffing) or a restart
    // marker. A crafted "0xFF 0xFF 0x30" must be walked through as scan data,
    // not mistaken for a marker that cuts the scan (and the trailing EOI) short.
    const craftedScan = [0x10, 0x20, 0xff, 0xff, 0x30, 0xff, 0x00, 0x40];
    const bytes = concatBytes([
      Uint8Array.of(0xff, 0xd8),
      Uint8Array.from(SOF0_2x2),
      Uint8Array.from(SOS_HEADER),
      Uint8Array.from(craftedScan),
      Uint8Array.of(0xff, 0xd9), // EOI
    ]);
    const cleaned = jpeg.stripJpegMetadata(bytes);
    // The EOI must survive at the very end (pre-fix the scan was cut at 0xFF30
    // and everything after it — including the EOI — was dropped).
    expect(Array.from(cleaned.slice(-2))).toEqual([0xff, 0xd9]);
    // And it still decodes.
    expect(jpeg.readJpegDimensions(cleaned)).toEqual({ width: 2, height: 2 });
  });
});

describe('JPEG GPS zero-denominator guard (minor bug)', () => {
  it('readExifSummary returns null GPS instead of "NaN, NaN" on a zero denominator', () => {
    // Build EXIF with a malformed GPS latitude (denominator 0) and re-read it.
    const exifObj = {
      '0th': {}, Exif: {}, Interop: {}, '1st': {}, thumbnail: null,
      GPS: {
        1: 'N', 2: [[40, 1], [26, 0], [0, 1]], // minutes denominator = 0 -> NaN
        3: 'W', 4: [[79, 1], [58, 1], [0, 1]],
      },
    };
    const exifBytes = piexifLib.dump(exifObj);
    // Insert into the base JPEG so readExifSummary can load it.
    const base = jpeg.bytesToBinaryString(b64ToBytes(JPEG_WITH_EXIF_B64));
    const withGps = piexifLib.insert(exifBytes, base);
    const bytes = jpeg.binaryStringToBytes(withGps);
    expect(jpeg.readExifSummary(bytes).gps).toBeNull();
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
