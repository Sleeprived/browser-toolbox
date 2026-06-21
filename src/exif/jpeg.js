// JPEG metadata handling. Dimension parsing is pure (reads the SOF marker).
//
// Stripping uses an ALLOWLIST rebuild (the same philosophy as the PNG stripper):
// walk the JPEG marker structure and keep ONLY the segments needed to decode the
// image, dropping every metadata container — EXIF, XMP, IPTC/Photoshop, ICC,
// comments, the embedded thumbnail, maker notes — and any trailing bytes after
// the EOI marker. The non-identifying Orientation tag is then re-inserted so
// cleaned photos are not displayed rotated. Pixels are never re-encoded (lossless).
//
// The vendored piexif library is used only to (a) read identifying EXIF for the
// "what was found" display and (b) read + re-insert the Orientation tag.

export class JpegError extends Error {}

const ORIENTATION_TAG = 274; // piexif.ImageIFD.Orientation
const MAKE_TAG = 271;
const MODEL_TAG = 272;
const DATETIME_TAG = 306; // 0th
const DATETIME_ORIGINAL_TAG = 36867; // Exif
const GPS_LAT_REF = 1;
const GPS_LAT = 2;
const GPS_LON_REF = 3;
const GPS_LON = 4;

function getPiexif() {
  const p = globalThis.piexif;
  if (!p || typeof p.remove !== 'function') {
    throw new JpegError('piexif library is not loaded');
  }
  return p;
}

export function isJpeg(bytes) {
  return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

export function bytesToBinaryString(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

export function binaryStringToBytes(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}

export function readJpegDimensions(bytes) {
  if (!isJpeg(bytes)) throw new JpegError('Not a JPEG file');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let marker = bytes[i + 1];
    while (marker === 0xff) { i++; marker = bytes[i + 1]; }
    // Standalone markers (no length payload).
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) + bytes[i + 3];
    // SOF markers carry the image dimensions: C0–CF except C4/C8/CC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) + bytes[i + 6];
      const width = (bytes[i + 7] << 8) + bytes[i + 8];
      return { width, height };
    }
    i += 2 + len;
  }
  throw new JpegError('No SOF marker found');
}

// A length-bearing marker is KEPT if it is structurally required to decode the
// image. Everything else (APP1=EXIF/XMP, APP2=ICC, APP13=IPTC, other APPn,
// COM comments) is dropped.
//   C0–CF  frame headers (SOF), Huffman (DHT), arithmetic (DAC)
//   DB–DF  DQT/DNL/DRI/DHP/EXP  (quant tables, restart interval, hierarchical)
//   E0     APP0 / JFIF          (density + units — structural, non-identifying)
//   EE     APP14 / Adobe        (color transform flag — needed for correct CMYK/YCCK color)
function isStructuralMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xcf) ||
    (marker >= 0xdb && marker <= 0xdf) ||
    marker === 0xe0 ||
    marker === 0xee
  );
}

// Given the offset of the first byte of entropy-coded scan data (just past an SOS
// header), walk to the next REAL marker, honoring byte-stuffing (0xFF00), restart
// markers (0xFFD0–D7) and fill bytes (0xFFFF) as part of the scan. Returns the
// offset of the 0xFF that begins the next real marker (or n if the stream ends).
function endOfScanData(bytes, start) {
  const n = bytes.length;
  let k = start;
  while (k < n - 1) {
    if (bytes[k] === 0xff) {
      const mk = bytes[k + 1];
      // 0x00 (stuffing) and 0xD0–0xD7 (restart) belong to the scan.
      if (mk === 0x00 || (mk >= 0xd0 && mk <= 0xd7)) {
        k += 2;
        continue;
      }
      // A real segment marker (0xC0–0xFE; the restart range is handled above)
      // ends the scan. 0xFF fill bytes and reserved/garbage bytes (< 0xC0) are
      // NOT markers — treat them as scan data and keep walking, so a malformed
      // or crafted entropy stream reaches the true next marker instead of being
      // truncated mid-scan.
      if (mk >= 0xc0 && mk <= 0xfe) return k;
    }
    k++;
  }
  return n;
}

// Walk segments and report which metadata containers are present, so the UI can
// tell the user exactly what is being removed. Returns booleans.
export function scanJpegMetadata(bytes) {
  const found = { exif: false, xmp: false, iptc: false, icc: false, comment: false, trailing: false, other: false };
  if (!isJpeg(bytes)) return found;
  const n = bytes.length;
  let i = 2;
  const startsWith = (off, str) => {
    for (let k = 0; k < str.length; k++) if (bytes[off + k] !== str.charCodeAt(k)) return false;
    return true;
  };
  while (i < n) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let j = i;
    while (j < n && bytes[j] === 0xff) j++;
    if (j >= n) break;
    const marker = bytes[j];
    i = j + 1;
    if (marker === 0xd9) { // EOI — anything after is trailing data
      if (i < n) found.trailing = true;
      break;
    }
    if (marker === 0xda) {
      // SOS: skip the entropy-coded scan data and resume scanning at the next real
      // marker. Metadata segments (APPn/COM) can legally appear AFTER a scan in a
      // progressive/multi-scan JPEG (or be crafted there), so we must not stop at
      // the first SOS. The EOI case below flags any trailing data after the image.
      const sosLen = (bytes[i] << 8) + bytes[i + 1];
      i = endOfScanData(bytes, i + sosLen);
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // standalone
    const len = (bytes[i] << 8) + bytes[i + 1];
    const dataOff = i + 2;
    if (marker === 0xe1) {
      if (startsWith(dataOff, 'Exif\0\0')) found.exif = true;
      else if (startsWith(dataOff, 'http://ns.adobe.com/xap/')) found.xmp = true;
      else found.other = true;
    } else if (marker === 0xe2 && startsWith(dataOff, 'ICC_PROFILE\0')) {
      found.icc = true;
    } else if (marker === 0xed && startsWith(dataOff, 'Photoshop 3.0\0')) {
      found.iptc = true;
    } else if (marker === 0xfe) {
      found.comment = true;
    } else if (marker >= 0xe1 && marker <= 0xef) {
      found.other = true;
    }
    i += len;
  }
  return found;
}

// Allowlist rebuild: keep only structural segments + the scan data through EOI;
// drop all metadata containers and trailing data. Pixels are untouched.
function rebuildJpegAllowlist(bytes) {
  if (!isJpeg(bytes)) throw new JpegError('Not a JPEG file');
  const n = bytes.length;
  const parts = [Uint8Array.of(0xff, 0xd8)]; // SOI
  let i = 2;

  while (i < n) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let j = i;
    while (j < n && bytes[j] === 0xff) j++; // collapse fill bytes
    if (j >= n) break;
    const marker = bytes[j];
    const markerStart = j - 1; // the 0xff preceding the marker
    i = j + 1;

    if (marker === 0xd9) { // EOI — stop here, dropping any trailing bytes
      parts.push(Uint8Array.of(0xff, 0xd9));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(Uint8Array.of(0xff, marker)); // standalone marker
      continue;
    }
    if (marker === 0xda) {
      // Start of Scan: copy the SOS header AND its entropy-coded data verbatim, but
      // do NOT stop — a progressive/multi-scan JPEG (or a crafted file) can place
      // more scans and even APPn/COM segments after this scan. Resume the outer
      // allowlist loop at the next real marker so those are filtered too. The EOI
      // case emits the final EOI and stops; trailing bytes after it are dropped.
      const len = (bytes[i] << 8) + bytes[i + 1];
      const dataStart = i + len; // first byte of entropy-coded data
      const end = endOfScanData(bytes, dataStart); // offset of the next real marker (or n)
      parts.push(bytes.subarray(markerStart, end));
      i = end;
      continue;
    }

    // Length-bearing segment.
    const len = (bytes[i] << 8) + bytes[i + 1];
    const segEnd = i + len;
    if (marker === 0xe0) {
      // APP0: keep a minimal 16-byte JFIF (density/units) but drop any embedded
      // thumbnail; drop JFXX (thumbnail-only) and any other APP0 entirely.
      const isJfif = bytes[i + 2] === 0x4a && bytes[i + 3] === 0x46 &&
        bytes[i + 4] === 0x49 && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x00;
      if (isJfif) {
        parts.push(Uint8Array.of(
          0xff, 0xe0, 0x00, 0x10, // length 16
          0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
          bytes[i + 7], bytes[i + 8], // version
          bytes[i + 9], // units
          bytes[i + 10], bytes[i + 11], // Xdensity
          bytes[i + 12], bytes[i + 13], // Ydensity
          0x00, 0x00, // Xthumb=0 Ythumb=0
        ));
      }
      // else: JFXX or unknown APP0 — drop it.
    } else if (isStructuralMarker(marker)) {
      parts.push(bytes.subarray(markerStart, segEnd));
    }
    i = segEnd;
  }

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// Pure: given a piexif exif object, return a new exif object containing ONLY
// the Orientation tag (everything identifying removed).
export function filterExifKeepOrientation(exifObj) {
  const out = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null };
  const zeroth = exifObj && exifObj['0th'];
  if (zeroth && zeroth[ORIENTATION_TAG] != null) {
    out['0th'][ORIENTATION_TAG] = zeroth[ORIENTATION_TAG];
  }
  return out;
}

function ratToDecimal(rat) {
  // rat: [[deg,den],[min,den],[sec,den]]. A zero denominator would yield NaN;
  // treat any such component as 0 so the caller can detect a non-finite result.
  const safeDiv = (num, den) => (den === 0 ? NaN : num / den);
  const d = safeDiv(rat[0][0], rat[0][1]);
  const m = safeDiv(rat[1][0], rat[1][1]);
  const s = safeDiv(rat[2][0], rat[2][1]);
  return d + m / 60 + s / 3600;
}

// Read a human-readable summary of identifying metadata for display.
export function readExifSummary(bytes) {
  const piexif = getPiexif();
  const summary = { gps: null, make: null, model: null, dateTime: null, orientation: null };
  let exif;
  try {
    exif = piexif.load(bytesToBinaryString(bytes));
  } catch {
    return summary; // no/unreadable EXIF
  }
  const zeroth = exif['0th'] || {};
  const exifIfd = exif.Exif || {};
  const gps = exif.GPS || {};

  if (zeroth[MAKE_TAG]) summary.make = String(zeroth[MAKE_TAG]).replace(/\0+$/, '');
  if (zeroth[MODEL_TAG]) summary.model = String(zeroth[MODEL_TAG]).replace(/\0+$/, '');
  summary.dateTime = exifIfd[DATETIME_ORIGINAL_TAG] || zeroth[DATETIME_TAG] || null;
  if (zeroth[ORIENTATION_TAG] != null) summary.orientation = zeroth[ORIENTATION_TAG];

  if (gps[GPS_LAT] && gps[GPS_LON]) {
    try {
      let lat = ratToDecimal(gps[GPS_LAT]);
      let lon = ratToDecimal(gps[GPS_LON]);
      if (gps[GPS_LAT_REF] === 'S') lat = -lat;
      if (gps[GPS_LON_REF] === 'W') lon = -lon;
      // A zero denominator (or otherwise malformed rational) yields NaN; never
      // render "NaN, NaN" — report no GPS instead.
      summary.gps = (!Number.isFinite(lat) || !Number.isFinite(lon))
        ? null
        : `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    } catch {
      summary.gps = null;
    }
  }
  return summary;
}

// Strip ALL metadata containers and trailing data, keeping only the Orientation
// tag. Returns a new Uint8Array. Lossless — the compressed pixel data is copied
// verbatim, never re-encoded.
export function stripJpegMetadata(bytes) {
  const piexif = getPiexif();

  // Read the Orientation tag (if any) before we discard the EXIF block.
  let orientation = null;
  try {
    const ex = piexif.load(bytesToBinaryString(bytes));
    if (ex['0th'] && ex['0th'][ORIENTATION_TAG] != null) {
      orientation = ex['0th'][ORIENTATION_TAG];
    }
  } catch {
    /* no readable EXIF */
  }

  // Allowlist rebuild removes EXIF, XMP, IPTC, ICC, COM, thumbnail, maker notes
  // and trailing data in one pass.
  const rebuilt = rebuildJpegAllowlist(bytes);

  if (orientation == null) return rebuilt;

  // Re-insert a minimal EXIF block carrying only Orientation.
  const exifBytes = piexif.dump(filterExifKeepOrientation({ '0th': { [ORIENTATION_TAG]: orientation } }));
  const withOrientation = piexif.insert(exifBytes, bytesToBinaryString(rebuilt));
  return binaryStringToBytes(withOrientation);
}
