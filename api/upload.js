import { validateUpload, uploadLimits, attachmentResult, safeFilename } from '../services/file-upload.service.js';

const MAX_HEADER = 4096;

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const files = [];
  let offset = 0;
  while (true) {
    const start = buffer.indexOf(marker, offset);
    if (start < 0) break;
    const headerStart = start + marker.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0 || headerEnd - headerStart > MAX_HEADER) break;
    const headers = buffer.subarray(headerStart, headerEnd).toString('utf8');
    const next = buffer.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    const data = buffer.subarray(headerEnd + 4, Math.max(headerEnd + 4, next - 2));
    const disposition = headers.match(/content-disposition:\s*form-data;[^\r\n]*name="([^"]+)"[^\r\n]*(?:filename="([^"]*)")?/i);
    if (disposition?.[2]) {
      const type = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
      files.push({ field: disposition[1], filename: safeFilename(disposition[2]), contentType: type, data });
    }
    offset = next + marker.length;
  }
  return files;
}

export default async function upload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const limits = uploadLimits();
  const contentType = String(req.headers['content-type'] || '');
  const match = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return res.status(415).json({ error: 'multipart_required', message: 'أرسل الملفات بصيغة multipart/form-data.' });
  const length = Number(req.headers['content-length'] || 0);
  if (length > limits.maxRequestSize) return res.status(413).json({ error: 'request_too_large', message: 'حجم الطلب أكبر من الحد المسموح.' });
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > limits.maxRequestSize) return res.status(413).json({ error: 'request_too_large', message: 'حجم الطلب أكبر من الحد المسموح.' });
      chunks.push(chunk);
    }
    const files = parseMultipart(Buffer.concat(chunks), match[1] || match[2]);
    if (!files.length) return res.status(400).json({ error: 'no_files', message: 'لم يتم إرسال أي ملف.' });
    if (files.length > limits.maxFiles) return res.status(413).json({ error: 'too_many_files', message: 'عدد الملفات أكبر من الحد المسموح.' });
    const result = files.map((file) => { validateUpload(file, limits); return attachmentResult(file); });
    return res.json({ attachments: result });
  } catch (error) {
    const messages = {
      FILE_TOO_LARGE: 'حجم الملف أكبر من الحد المسموح.', UNSUPPORTED_FILE_TYPE: 'نوع الملف غير مدعوم.',
      UNSAFE_FILE_TYPE: 'هذا النوع من الملفات غير مسموح به.', INVALID_IMAGE: 'الصورة غير صالحة.', INVALID_ZIP: 'ملف ZIP غير صالح.'
    };
    console.error('Upload validation failed:', error);
    return res.status(400).json({ error: error.message || 'upload_failed', message: messages[error.message] || 'تعذر رفع الملف.' });
  }
}
