/*
 * Project Builder client helper.
 *
 * The helper keeps ZIP generation stateless: it sends the JSON project to the
 * Vercel function and downloads the streamed archive without server temp files.
 */
export async function downloadProjectZip(project) {
  const response = await fetch('/api/project-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });

  if (!response.ok) {
    let message = 'تعذر تجهيز ملف ZIP.';
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // Keep the user-facing fallback when the server does not return JSON.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const name = String(project?.name || 'codemind-project')
    .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]+/g, '-') || 'codemind-project';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
