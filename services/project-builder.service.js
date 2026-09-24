import { parseProjectResponse } from './project.service.js';

const CURRENT_PROJECT_KEY = 'codemind_current_project_v1';

export function isProjectRequest(message, currentProject = null) {
  if (currentProject) return true;
  const text = String(message || '').toLowerCase();
  return ['برمجلي موقع', 'برمج لي موقع', 'اعمللي موقع', 'اعمل لي موقع', 'برمجلي تطبيق', 'برمج لي تطبيق', 'اعمللي تطبيق', 'اعمل لي تطبيق', 'برمجلي مشروع', 'برمج لي مشروع', 'اعمللي مشروع', 'اعمل لي مشروع', 'ابني موقع', 'ابني تطبيق', 'ابني مشروع', 'مشروع كامل', 'ملفات المشروع', 'build a website', 'build an app', 'build a project', 'create a website', 'create an app', 'create a project', 'full project', 'complete project', 'ecommerce', 'متجر الكتروني', 'متجر إلكتروني'].some((keyword) => text.includes(keyword));
}

export function buildProjectPrompt(message, currentProject = null) {
  const context = currentProject ? `\nالمشروع الحالي الذي يجب تعديله، مع الحفاظ على الملفات غير المطلوبة:\n${JSON.stringify(currentProject)}` : '\nأنشئ مشروعًا جديدًا قابلًا للتشغيل.';
  return `أنت CodeMind AI Project Builder. أعد JSON صالحًا فقط دون Markdown أو <PROJECT>.\nالمخطط: {"reply":"تم إنشاء المشروع بنجاح.","project":{"name":"project-name","description":"...","files":[{"path":"index.html","content":"..."}]}}\nأنشئ ملفات كاملة وآمنة، واستخدم .env.example بدل الأسرار. لا تختصر المحتوى ولا تضع المشروع داخل reply.${context}\nطلب المستخدم: ${message}`;
}

export function loadCurrentProject() {
  try { return JSON.parse(localStorage.getItem(CURRENT_PROJECT_KEY) || 'null'); } catch { return null; }
}

export { parseProjectResponse };
