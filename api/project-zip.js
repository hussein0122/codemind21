import archiver from 'archiver';

const MAX_FILES = 60;
const MAX_PROJECT_SIZE = 5 * 1024 * 1024;

function sanitizeName(value) {
  return String(value || 'codemind-project')
    .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '')
    .trim()
    .slice(0, 80) || 'codemind-project';
}

function sanitizePath(value) {
  const parts = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  return parts.join('/');
}

function normalizeProject(input) {
  if (!input || !Array.isArray(input.files)) return null;

  const files = input.files
    .slice(0, MAX_FILES)
    .filter((file) => file && typeof file.content === 'string')
    .map((file) => ({
      path: sanitizePath(file.path),
      content: file.content
    }))
    .filter((file) => file.path);

  const size = files.reduce(
    (total, file) => total + Buffer.byteLength(file.content, 'utf8'),
    0
  );

  if (!files.length || size > MAX_PROJECT_SIZE) return null;

  return {
    name: sanitizeName(input.name),
    files
  };
}

export default function projectZip(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const project = normalizeProject(req.body);
  if (!project) {
    return res.status(400).json({
      error: 'invalid_project',
      message: 'بيانات المشروع غير صحيحة أو تتجاوز الحد المسموح.'
    });
  }

  const safeFileName = project.name.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]+/g, '-');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeFileName || 'codemind-project'}.zip"`
  );
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    if (!res.headersSent) res.status(500);
    res.end();
    console.error('Project ZIP stream failed:', error);
  });

  archive.pipe(res);
  for (const file of project.files) {
    archive.append(file.content, { name: `${project.name}/${file.path}` });
  }
  archive.finalize();
}
