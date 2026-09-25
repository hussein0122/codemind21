/* CodeMind Project Workspace UI */
(() => {
  'use strict';

  const STORAGE_KEY = 'codemind.projects.v1';
  const MAX_PROJECTS = 8;
  const MAX_FILES = 220;
  const MAX_BYTES = 15 * 1024 * 1024;
  let currentProject = null;

  const escapeText = (value) => String(value ?? '');
  const safeName = (value) => (String(value || 'codemind-project')
    .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]/g, '-') || 'codemind-project');

  function projectBytes(project) {
    return (project?.files || []).reduce((total, file) => total + new Blob([file.content || '']).size, 0);
  }

  function saveProject(project) {
    if (!project || !Array.isArray(project.files) || projectBytes(project) > MAX_BYTES) return;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      .filter((item) => item && item.name !== project.name);
    saved.unshift({
      name: String(project.name || 'codemind-project').slice(0, 80),
      description: String(project.description || '').slice(0, 1000),
      files: project.files.slice(0, MAX_FILES).map((file) => ({
        path: String(file.path || '').slice(0, 500),
        content: String(file.content || '')
      })),
      updatedAt: new Date().toISOString()
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(0, MAX_PROJECTS)));
  }

  function isStaticPreview(project) {
    const paths = new Set((project.files || []).map((file) => file.path));
    return paths.has('index.html') && paths.has('style.css') && paths.has('script.js');
  }

  function buildPreview(project) {
    const get = (name) => (project.files || []).find((file) => file.path === name)?.content || '';
    const html = get('index.html')
      .replace(/<base[^>]*>/gi, '')
      .replace(/<script[^>]*src=["'](?:https?:)?\/\/[^"']+["'][^>]*>[\s\S]*?<\/script>/gi, '')
      .replace('</head>', `<style>${get('style.css').replace(/<\/style/gi, '<\\/style')}</style></head>`)
      .replace('</body>', `<script>${get('script.js').replace(/<\/script/gi, '<\\/script')}</script></body>`);
    return html;
  }

  function downloadFile(file) {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.path.split('/').pop() || 'file.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function downloadZip(project) {
    const bytes = projectBytes(project);
    if (bytes > 6 * 1024 * 1024) {
      const response = await fetch('/api/project-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
      });
      if (!response.ok) throw new Error('server_zip_failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${safeName(project.name)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1500);
      return;
    }
    if (!window.JSZip) throw new Error('JSZip is not loaded');
    const zip = new window.JSZip();
    project.files.forEach((file) => zip.file(file.path, file.content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName(project.name)}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function render(project) {
    currentProject = project;
    saveProject(project);
    let card = document.getElementById('codemind-project-workspace');
    if (!card) {
      card = document.createElement('section');
      card.id = 'codemind-project-workspace';
      card.className = 'project-card';
      const target = document.querySelector('.chat-scroll .wrap') || document.querySelector('.chat-scroll') || document.body;
      target.appendChild(card);
    }
    card.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'project-head';
    const title = document.createElement('div');
    title.className = 'project-title';
    title.textContent = `📦 ${project.name || 'Project'}`;
    const status = document.createElement('span');
    status.className = 'project-status';
    status.textContent = `${project.files.length} ملفات`;
    heading.append(title, status);

    const description = document.createElement('p');
    description.className = 'project-description';
    description.textContent = project.description || '';

    const tree = document.createElement('div');
    tree.className = 'project-files';
    project.files.forEach((file) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'project-file';
      row.textContent = `📄 ${file.path}`;
      row.addEventListener('click', () => showViewer(file));
      tree.appendChild(row);
    });

    const actions = document.createElement('div');
    actions.className = 'project-actions';
    const zip = document.createElement('button');
    zip.className = 'project-btn primary';
    zip.textContent = 'تحميل ZIP';
    zip.addEventListener('click', async () => {
      try { await downloadZip(project); zip.textContent = 'تم تجهيز ZIP ✅'; }
      catch (error) { zip.textContent = 'تعذر إنشاء ZIP'; console.error(error); }
    });
    if (isStaticPreview(project)) {
      const preview = document.createElement('button');
      preview.className = 'project-btn';
      preview.textContent = 'Preview';
      preview.addEventListener('click', () => showPreview(project));
      actions.appendChild(preview);
    }
    actions.appendChild(zip);
    card.append(heading, description, tree, actions);
  }

  function showViewer(file) {
    let viewer = document.getElementById('codemind-file-viewer');
    if (!viewer) { viewer = document.createElement('dialog'); viewer.id = 'codemind-file-viewer'; document.body.appendChild(viewer); }
    viewer.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = file.path;
    const code = document.createElement('pre'); code.className = 'code-body'; code.textContent = file.content;
    const copy = document.createElement('button'); copy.textContent = 'Copy';
    copy.onclick = async () => { await navigator.clipboard.writeText(file.content); copy.textContent = 'Copied ✅'; };
    const download = document.createElement('button'); download.textContent = 'Download File'; download.onclick = () => downloadFile(file);
    const close = document.createElement('button'); close.textContent = 'إغلاق'; close.onclick = () => viewer.close();
    viewer.append(heading, code, copy, download, close); viewer.showModal();
  }

  function showPreview(project) {
    const dialog = document.createElement('dialog');
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts'; iframe.srcdoc = buildPreview(project); iframe.style.cssText = 'width:min(90vw,1000px);height:70vh;background:white';
    const close = document.createElement('button'); close.textContent = 'إغلاق'; close.onclick = () => dialog.close();
    dialog.append(iframe, close); document.body.appendChild(dialog); dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
  }

  window.CodeMindProjectWorkspace = { render, saveProject, downloadZip };
  window.addEventListener('codemind:project', (event) => render(event.detail));
})();
