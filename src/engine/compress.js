// compress.js — gzip compression for browser-local storage of binary blobs.
// Uses the native CompressionStream API (Chrome 80+, Safari 16.4+, Firefox 113+).
// If unavailable, falls back to storing the payload uncompressed.

// Compress a base64-encoded payload using gzip.
// Input:  base64 string (e.g. the data portion of a data: URL)
// Output: base64 string of the gzipped bytes
// Storage-only — NEVER send the compressed output to an API expecting the original format.
export async function compressToBase64(base64String) {
  if (typeof CompressionStream === 'undefined') {
    console.warn('CompressionStream not supported — storing uncompressed');
    return base64String;
  }
  try {
    const bytes = _base64ToBytes(base64String);
    const compressed = await _pipeThrough(bytes, new CompressionStream('gzip'));
    return _bytesToBase64(compressed);
  } catch (err) {
    console.warn('Compression failed, storing uncompressed:', err?.message || err);
    return base64String;
  }
}

// Reverse of compressToBase64. Returns the original base64 string,
// byte-for-byte identical to the input that was originally compressed.
// If decompression fails (e.g. the payload was stored uncompressed via fallback),
// returns the input unchanged rather than corrupting downstream consumers.
export async function decompressFromBase64(compressedBase64) {
  if (typeof DecompressionStream === 'undefined') {
    return compressedBase64;
  }
  try {
    const bytes = _base64ToBytes(compressedBase64);
    const decompressed = await _pipeThrough(bytes, new DecompressionStream('gzip'));
    return _bytesToBase64(decompressed);
  } catch (err) {
    console.warn('Decompression failed, treating input as uncompressed:', err?.message || err);
    return compressedBase64;
  }
}

// Human-readable byte size formatter used by the regeneration UI.
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── internals ──────────────────────────────────────────────────────────────

function _base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Chunked byte→base64 to avoid O(n²) string concat and apply() stack limits
// on multi-megabyte payloads.
function _bytesToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    );
  }
  return btoa(binary);
}

// Push bytes through a CompressionStream/DecompressionStream and collect output.
// The write promise is kicked off but NOT awaited before reading, so the pipeline
// drains concurrently — otherwise large payloads can deadlock on backpressure.
async function _pipeThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writePromise = writer.write(bytes).then(() => writer.close());

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writePromise;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
