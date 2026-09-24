/* Workspace bridge: connects the existing chat fetch to the Project Workspace. */
(() => {
  const KEY = 'codemind_current_project_v1';
  const MAX_BYTES = 2 * 1024 * 1024;
  const originalFetch = window.fetch.bind(window);
  let current = null;
  try { current = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { current = null; }

  const bytes = (project) => new Blob([JSON.stringify(project || {})]).size;
  const persist = (project) => {
    if (!project || !Array.isArray(project.files) || bytes(project) > MAX_BYTES) return;
    current = { name: String(project.name || '').slice(0, 80), description: String(project.description || '').slice(0, 1000), files: project.files.slice(0, 60), updatedAt: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (error) { console.warn('Project memory unavailable:', error); }
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!String(url).includes('/api/chat') || !init.body) return originalFetch(input, init);
    try {
      const body = JSON.parse(init.body);
      if (current && !body.project) body.project = current;
      if (current && Array.isArray(body.history)) body.history = body.history.slice(-20);
      init = { ...init, body: JSON.stringify(body) };
    } catch { /* Preserve the original request if it is not JSON. */ }
    const response = await originalFetch(input, init);
    try {
      const data = await response.clone().json();
      if (data.project?.files) {
        persist(data.project);
        window.dispatchEvent(new CustomEvent('codemind:project', { detail: data.project }));
      }
    } catch { /* Non-JSON responses remain unchanged. */ }
    return response;
  };

  window.CodeMindProjectMemory = { get: () => current, save: persist };
})();
