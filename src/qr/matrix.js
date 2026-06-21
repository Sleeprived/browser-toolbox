// QR matrix generation, wrapping the vendored qrcode-generator library.
// In the browser, qrcode-generator is loaded as a global <script> exposing
// `qrcode`. In Node tests, the module is imported and assigned to globalThis.
// This module stays thin; all custom payload logic lives in payloads.js.

const VALID_ECL = ['L', 'M', 'Q', 'H'];

function getFactory() {
  const f = globalThis.qrcode;
  if (typeof f !== 'function') {
    throw new Error('qrcode-generator library is not loaded');
  }
  return f;
}

// Returns { size, modules } where modules is a size×size array of booleans
// (true = dark). typeNumber 0 lets the library auto-pick the smallest version.
export function getQrMatrix(text, ecl = 'M') {
  if (!VALID_ECL.includes(ecl)) throw new Error(`Invalid error-correction level: ${ecl}`);
  if (text == null || text === '') throw new Error('Nothing to encode');

  const qrcode = getFactory();
  // The vendored library defaults to a Latin-1 byte encoder, which corrupts any
  // non-ASCII input. Switch to its UTF-8 encoder (idempotent; ASCII bytes are
  // identical so existing matrix vectors are unaffected).
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  const qr = qrcode(0, ecl);
  try {
    qr.addData(String(text));
    qr.make();
  } catch (e) {
    // qrcode-generator throws a bare string (not an Error) on overflow; normalize
    // it so callers can rely on Error.message instead of seeing "undefined".
    const msg = typeof e === 'string' ? e : (e && e.message) || String(e);
    if (/overflow/i.test(msg)) {
      throw new Error('Too much data for one QR code — shorten the input or lower the error correction.');
    }
    throw new Error(msg);
  }

  const size = qr.getModuleCount();
  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
    modules.push(row);
  }
  // QR version 1..40 maps to module count 17 + 4×version.
  const version = Math.round((size - 17) / 4);
  return { size, modules, version };
}

// Serialize a matrix to a compact "01" string (used by tests as a regression
// vector and available for debugging).
export function matrixToBitString(matrix) {
  return matrix.modules.map((row) => row.map((d) => (d ? '1' : '0')).join('')).join('\n');
}
