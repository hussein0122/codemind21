import { parseProjectResponse } from './project.service.js';

const CURRENT_PROJECT_KEY = 'codemind_current_project_v1';

export function isProjectRequest(message, currentProject = null) {
  if (currentProject) return true;
  const text = String(message || '').toLowerCase();
  return ['برمجلي موقع', 'برمج لي موقع', 'اعمللي موقع', 'اعمل لي موقع', 'برمجلي تطبيق', 'برمج لي تطبيق', 'اعمللي تطبيق', 'اعمل لي تطبيق', 'برمجلي مشروع', 'برمج لي مشروع', 'اعمللي مشروع', 'اعمل لي مشروع', 'ابني موقع', 'ابني تطبيق', 'ابني مشروع', 'مشروع كامل', 'ملفات المشروع', 'build a website', 'build an app', 'build a project', 'create a website', 'create an app', 'create a project', 'full project', 'complete project', 'ecommerce', 'متجر الكتروني', 'متجر إلكتروني'].some((keyword) => text.includes(keyword));
}

export function buildProjectPrompt(message, currentProject = null) {
  const context = currentProject
    ? `\nالمشروع الحالي الذي يجب تعديله، مع الحفاظ على كل الملفات غير المطلوبة وعدم حذف أي جزء سليم:\n${JSON.stringify(currentProject)}`
    : '\nأنشئ مشروعًا جديدًا كاملًا وقابلًا للتشغيل من أول تحميل.';
  return `أنت CodeMind AI Project Builder وتعمل كمهندس برمجيات كامل.
أعد JSON صالحًا فقط دون Markdown أو <PROJECT>.
المخطط: {"reply":"...","project":{"name":"project-name","description":"...","files":[{"path":"index.html","content":"..."}]}}
قواعد البناء:
- ابنِ المشروع فعليًا، وليس مجرد نموذج أو ملفات ناقصة.
- اختر architecture مناسبة للمشروع وأنشئ كل الملفات الضرورية: frontend/backend/config/database/schema/migrations/tests/docs عند الحاجة.
- نسّق المسارات والمجلدات بشكل احترافي واجعل المشروع قابلًا للتشغيل بعد فك الضغط.
- لا تضع أسرارًا حقيقية؛ استخدم .env.example ووثّق المتغيرات المطلوبة في README.
- لا تختصر محتوى الملفات بعبارات مثل "..." أو "same as above".
- لا تضع كودًا داخل reply؛ كل الكود داخل files.
- عند طلب مشروع كبير، فضّل اكتمال الملفات الأساسية والتشغيلية على الزخرفة، ويمكن إنشاء عدد كبير من الملفات ضمن الحد المتاح.
- استخدم أسماء ملفات ومسارات صحيحة ومتوافقة مع التقنية المختارة.
- راجع الترابط بين الملفات قبل إخراج JSON.
${context}
طلب المستخدم: ${message}`;
}

export function loadCurrentProject() {
  try { return JSON.parse(localStorage.getItem(CURRENT_PROJECT_KEY) || 'null'); } catch { return null; }
}

export { parseProjectResponse };
