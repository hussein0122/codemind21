const MAX_FILES = 220;
const MAX_BYTES = 15 * 1024 * 1024;

export function sanitizeProjectName(value) {
  return String(value || 'codemind-project')
    .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '')
    .trim()
    .slice(0, 80) || 'codemind-project';
}

export function sanitizeProjectPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function normalizeProject(input) {
  if (!input || typeof input !== 'object') return null;
  const files = (Array.isArray(input.files) ? input.files : [])
    .slice(0, MAX_FILES)
    .filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
    .map((file) => ({ path: sanitizeProjectPath(file.path), content: file.content }))
    .filter((file) => file.path);
  const bytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
  if (!files.length || bytes > MAX_BYTES) return null;
  return {
    name: sanitizeProjectName(input.name),
    description: typeof input.description === 'string' ? input.description.slice(0, 1000) : '',
    files
  };
}

function balancedObjects(text) {
  const results = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth === 0) start = i; depth += 1; }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) results.push(text.slice(start, i + 1));
    }
  }
  return results;
}

export function parseProjectResponse(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { reply: '', project: null };
  const text = raw.trim();
  const candidates = [];
  const tag = text.match(/<PROJECT>\s*([\s\S]*?)\s*<\/PROJECT>/i);
  if (tag) candidates.push(tag[1]);
  candidates.push(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  candidates.push(...balancedObjects(text));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
      const project = normalizeProject(parsed.project || parsed);
      if (project) return {
        reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'تم إنشاء المشروع بنجاح.',
        project
      };
    } catch {
      // Continue with the next candidate.
    }
  }
  console.error('Project manifest parsing failed: no valid project.files found');
  return { reply: text, project: null };
}

export { MAX_FILES, MAX_BYTES };
