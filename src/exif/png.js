// PNG metadata handling. Pure byte-level functions: parse chunks, read
// dimensions, list text/metadata chunks, and rebuild a PNG keeping only the
// chunks required to render it (stripping identifying metadata).

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Chunks that are kept; everything else (tEXt, iTXt, zTXt, eXIf, tIME, etc.)
// is stripped.
const KEEP_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']);

export class PngError extends Error {}

export function isPng(bytes) {
  if (!bytes || bytes.length < 8) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function chunkType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

// Parse PNG into chunks: [{ type, length, start, end }]. `start`/`end` bound the
// full chunk (length+type+data+crc) within the original array.
export function parsePngChunks(bytes) {
  if (!isPng(bytes)) throw new PngError('Not a PNG file');
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new PngError('Truncated PNG chunk');
    const length = readUint32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    const end = offset + 12 + length; // 4 len + 4 type + data + 4 crc
    if (end > bytes.length) throw new PngError('Corrupt PNG: chunk overruns file');
    chunks.push({ type, length, start: offset, end });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function readPngDimensions(bytes) {
  const chunks = parsePngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new PngError('PNG missing IHDR');
  const dataStart = ihdr.start + 8;
  return {
    width: readUint32(bytes, dataStart),
    height: readUint32(bytes, dataStart + 4),
  };
}

// List the metadata chunks that WILL be stripped, for display to the user.
export function listStrippableChunks(bytes) {
  return parsePngChunks(bytes)
    .filter((c) => !KEEP_CHUNKS.has(c.type))
    .map((c) => c.type);
}

// Number of bytes after the IEND chunk (hidden trailing payload). The rebuild
// always drops these; this is for reporting them to the user.
export function pngTrailingByteCount(bytes) {
  const chunks = parsePngChunks(bytes);
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) return 0;
  return Math.max(0, bytes.length - iend.end);
}

// Rebuild the PNG keeping only render-critical chunks. Returns a new Uint8Array.
export function stripPngMetadata(bytes) {
  const chunks = parsePngChunks(bytes);
  const kept = chunks.filter((c) => KEEP_CHUNKS.has(c.type));

  let size = 8;
  for (const c of kept) size += c.end - c.start;

  const out = new Uint8Array(size);
  out.set(PNG_SIGNATURE, 0);
  let pos = 8;
  for (const c of kept) {
    out.set(bytes.subarray(c.start, c.end), pos);
    pos += c.end - c.start;
  }
  return out;
}
