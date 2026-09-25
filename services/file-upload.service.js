const DEFAULTS = {
  maxFileSize: 10 * 1024 * 1024,
  maxImageSize: 10 * 1024 * 1024,
  maxZipSize: 25 * 1024 * 1024,
  maxFiles: 10,
  maxRequestSize: 35 * 1024 * 1024
};

const SAFE_EXTENSIONS = new Set([
  'txt', 'pdf', 'doc', 'docx', 'csv', 'json', 'js', 'jsx', 'ts', 'tsx',
  'html', 'css', 'scss', 'php', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs',
  'dart', 'sql', 'xml', 'yaml', 'yml', 'md', 'log', 'env.example', 'zip'
]);
const BLOCKED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'sh', 'ps1', 'bin', 'msi', 'dll', 'so', 'com']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function uploadLimits() {
  return {
    maxFileSize: envNumber('MAX_FILE_SIZE', DEFAULTS.maxFileSize),
    maxImageSize: envNumber('MAX_IMAGE_SIZE', DEFAULTS.maxImageSize),
    maxZipSize: envNumber('MAX_ZIP_SIZE', DEFAULTS.maxZipSize),
    maxFiles: Math.min(envNumber('MAX_UPLOAD_FILES', DEFAULTS.maxFiles), 20),
    maxRequestSize: envNumber('MAX_UPLOAD_REQUEST_SIZE', DEFAULTS.maxRequestSize)
  };
}

export function safeFilename(value) {
  return String(value || 'attachment')
    .replace(/[\\/\0]/g, '_')
    .replace(/[^a-zA-Z0-9._\-\u0600-\u06FF ]/g, '_')
    .slice(0, 180) || 'attachment';
}

export function extensionOf(filename) {
  const name = safeFilename(filename).toLowerCase();
  if (name.endsWith('.env.example')) return 'env.example';
  return name.includes('.') ? name.split('.').pop() : '';
}

export function validateUpload(file, limits = uploadLimits()) {
  const extension = extensionOf(file.filename);
  const mime = String(file.contentType || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(extension)) throw new Error('UNSAFE_FILE_TYPE');
  if (!SAFE_EXTENSIONS.has(extension) && !IMAGE_TYPES.has(mime)) throw new Error('UNSUPPORTED_FILE_TYPE');
  const max = mime === 'application/zip' || extension === 'zip'
    ? limits.maxZipSize
    : IMAGE_TYPES.has(mime) ? limits.maxImageSize : limits.maxFileSize;
  if (file.data.length > max) throw new Error('FILE_TOO_LARGE');
  if (IMAGE_TYPES.has(mime) && !isKnownImage(file.data, mime)) throw new Error('INVALID_IMAGE');
  if ((extension === 'zip' || mime === 'application/zip') && !isZip(file.data)) throw new Error('INVALID_ZIP');
  return { extension, mime };
}

function isZip(data) { return data.length >= 4 && data.subarray(0, 4).toString('hex') === '504b0304'; }
function isKnownImage(data, mime) {
  if (mime === 'image/png') return data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (mime === 'image/jpeg') return data.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (mime === 'image/gif') return data.subarray(0, 6).toString() === 'GIF87a' || data.subarray(0, 6).toString() === 'GIF89a';
  if (mime === 'image/webp') return data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  return false;
}

export function isTextAttachment(file) {
  return file.contentType.startsWith('text/') || /\.(js|jsx|ts|tsx|json|html|css|scss|php|py|java|cpp|c|cs|go|rs|dart|sql|xml|ya?ml|md|log|env\.example)$/i.test(file.filename);
}

export function attachmentResult(file) {
  const meta = { name: safeFilename(file.filename), type: file.contentType, size: file.data.length, kind: IMAGE_TYPES.has(file.contentType) ? 'image' : 'file' };
  if (isTextAttachment(file)) return { ...meta, content: file.data.toString('utf8', 0, 2 * 1024 * 1024) };
  if (IMAGE_TYPES.has(file.contentType)) {
    return {
      ...meta,
      dataUrl: `data:${file.contentType};base64,${file.data.toString('base64')}`
    };
  }
  return meta;
}
