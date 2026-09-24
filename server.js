import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

import {
  isAiConfigured,
  createCompletion
} from './services/ai.service.js';

dotenv.config();

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  );

const app =
  express();

const port =
  Number(
    process.env.PORT || 3000
  );


/* =========================================================
   BASIC CONFIG
========================================================= */

if (
  process.env.TRUST_PROXY === 'true'
) {
  app.set(
    'trust proxy',
    1
  );
}

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN || true
  })
);

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);


/* =========================================================
   RATE LIMIT
========================================================= */

app.use(
  '/api',
  rateLimit({

    windowMs:
      Number(
        process.env.RATE_LIMIT_WINDOW_MS ||
        60000
      ),

    limit:
      Number(
        process.env.RATE_LIMIT_MAX ||
        60
      ),

    standardHeaders:
      'draft-7',

    legacyHeaders:
      false,

    message: {
      error:
        'rate_limited',

      message:
        'طلبات كثيرة. حاول مرة أخرى بعد قليل.'
    }

  })
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/health',
  (req, res) => {

    res.json({

      ok: true,

      ai:
        isAiConfigured(),

      database:
        'disabled',

      memory:
        'conversation_context',

      projects:
        'enabled',

      zip:
        'enabled'

    });

  }
);


/* =========================================================
   SAFE CHAT HISTORY
========================================================= */

function buildSafeHistory(
  history
) {

  if (
    !Array.isArray(history)
  ) {

    return [];

  }

  const allowedRoles =
    new Set([
      'user',
      'assistant'
    ]);

  const MAX_MESSAGES =
    30;

  const MAX_TOTAL_CHARS =
    24000;

  const MAX_MESSAGE_CHARS =
    12000;

  const cleanHistory =
    [];

  let totalChars =
    0;

  for (
    let i =
      history.length - 1;

    i >= 0 &&
    cleanHistory.length <
      MAX_MESSAGES;

    i--
  ) {

    const item =
      history[i];

    if (
      !item ||
      typeof item !== 'object'
    ) {

      continue;

    }

    if (
      !allowedRoles.has(
        item.role
      )
    ) {

      continue;

    }

    if (
      typeof item.content !==
      'string'
    ) {

      continue;

    }

    const content =
      item.content.trim();

    if (!content) {

      continue;

    }

    const safeContent =
      content.slice(
        0,
        MAX_MESSAGE_CHARS
      );

    if (
      totalChars +
        safeContent.length >
        MAX_TOTAL_CHARS &&
      cleanHistory.length >= 4
    ) {

      break;

    }

    cleanHistory.push({

      role:
        item.role,

      content:
        safeContent

    });

    totalChars +=
      safeContent.length;

  }

  return cleanHistory.reverse();

}


/* =========================================================
   PROJECT DETECTION
========================================================= */

function looksLikeProjectRequest(
  message
) {

  const text =
    message
      .toLowerCase()
      .trim();

  const keywords = [

    'اعمللي موقع',
    'اعمل لي موقع',
    'برمجلي موقع',
    'برمج لي موقع',

    'اعمللي تطبيق',
    'اعمل لي تطبيق',
    'برمجلي تطبيق',
    'برمج لي تطبيق',

    'اعمل ابلكيشن',
    'اعمللي ابلكيشن',
    'اعمل لي ابلكيشن',

    'اعمل مشروع',
    'اعمللي مشروع',
    'اعمل لي مشروع',

    'ابني موقع',
    'ابني تطبيق',
    'ابني مشروع',

    'build a website',
    'build an app',
    'build a project',

    'create a website',
    'create an app',
    'create a project',

    'full project',
    'complete project',

    'مشروع كامل',
    'ملفات المشروع',

    'zip المشروع',
    'ملف مضغوط'

  ];

  return keywords.some(
    keyword =>
      text.includes(keyword)
  );

}


/* =========================================================
   PROJECT SYSTEM PROMPT
========================================================= */

function buildProjectPrompt(
  originalMessage
) {

  return `
أنت الآن تعمل في وضع بناء المشاريع داخل CodeMind AI.

المستخدم طلب:
${originalMessage}

إذا كان الطلب يتطلب مشروعًا كاملًا، أعد النتيجة بهذا الشكل فقط:

<PROJECT>
{
  "name": "اسم المشروع",
  "description": "وصف مختصر",
  "files": [
    {
      "path": "package.json",
      "content": "محتوى الملف"
    },
    {
      "path": "src/App.jsx",
      "content": "محتوى الملف"
    }
  ]
}
</PROJECT>

بعد ذلك اكتب شرحًا عربيًا مختصرًا للمشروع.

قواعد مهمة:

1. الملفات يجب أن تكون كاملة وقابلة للاستخدام.
2. لا تستخدم مسارات تبدأ بـ /.
3. لا تستخدم ../.
4. لا تضع ملفات binary.
5. لا تضع أسرار أو API keys حقيقية.
6. رتب المشروع بطريقة احترافية.
7. إذا كان React استخدم package.json صحيحًا.
8. إذا كان HTML/CSS/JS اجعل المشروع قابلًا للتشغيل مباشرة.
9. إذا كان Node.js أضف package.json.
10. إذا كان Flutter أضف pubspec.yaml والملفات الأساسية.
11. لا تختصر محتوى الملفات بعبارات مثل "ضع باقي الكود هنا".
12. لا تستخدم Markdown code fences داخل قيمة content.
13. اجعل اسم path نسبيًا وآمنًا.
14. لا تنشئ أكثر من 60 ملفًا.
15. اجعل حجم المشروع النصي معقولًا.

إذا كان طلب المستخدم مجرد سؤال أو تعديل بسيط، لا تستخدم PROJECT format.
`;

}


/* =========================================================
   PARSE PROJECT FROM AI
========================================================= */

function extractProject(
  text
) {

  if (
    typeof text !== 'string'
  ) {

    return {
      reply:
        text || '',
      project:
        null
    };

  }

  const match =
    text.match(
      /<PROJECT>\s*([\s\S]*?)\s*<\/PROJECT>/i
    );

  if (!match) {

    return {
      reply:
        text.trim(),
      project:
        null
    };

  }

  let projectData;

  try {

    projectData =
      JSON.parse(
        match[1]
      );

  } catch (error) {

    console.error(
      'Project JSON parse failed:',
      error
    );

    return {
      reply:
        text.trim(),
      project:
        null
    };

  }

  if (
    !projectData ||
    !Array.isArray(
      projectData.files
    )
  ) {

    return {
      reply:
        text.trim(),
      project:
        null
    };

  }

  const safeFiles =
    projectData.files
      .slice(0, 60)
      .filter(
        file =>
          file &&
          typeof file.path ===
            'string' &&
          typeof file.content ===
            'string'
      )
      .map(
        file => ({

          path:
            sanitizeProjectPath(
              file.path
            ),

          content:
            file.content

        })
      )
      .filter(
        file =>
          Boolean(file.path)
      );

  const project = {

    name:
      sanitizeProjectName(
        projectData.name ||
        'codemind-project'
      ),

    description:
      typeof projectData.description ===
        'string'
        ? projectData.description
        : '',

    files:
      safeFiles

  };

  const reply =
    text
      .replace(
        match[0],
        ''
      )
      .trim();

  return {

    reply:
      reply ||
      'تم إنشاء المشروع وتجهيز ملفاته.',

    project

  };

}


/* =========================================================
   SANITIZE PROJECT PATH
========================================================= */

function sanitizeProjectPath(
  filePath
) {

  let value =
    String(
      filePath || ''
    )
    .replace(
      /\\/g,
      '/'
    )
    .trim();

  value =
    value.replace(
      /^\/+/,
      ''
    );

  const parts =
    value
      .split('/')
      .filter(
        part =>
          part &&
          part !== '.' &&
          part !== '..'
      );

  if (!parts.length) {

    return '';

  }

  return parts.join('/');

}


/* =========================================================
   SANITIZE PROJECT NAME
========================================================= */

function sanitizeProjectName(
  name
) {

  return String(
    name || 'codemind-project'
  )
  .replace(
    /[^a-zA-Z0-9_\-\u0600-\u06FF ]/g,
    ''
  )
  .trim()
  .slice(0, 80)
  || 'codemind-project';

}


/* =========================================================
   PROJECT SIZE VALIDATION
========================================================= */

function validateProject(
  project
) {

  if (
    !project ||
    !Array.isArray(
      project.files
    )
  ) {

    return {
      valid: false,
      message:
        'بيانات المشروع غير صحيحة.'
    };

  }

  if (
    project.files.length === 0
  ) {

    return {
      valid: false,
      message:
        'المشروع لا يحتوي على ملفات.'
    };

  }

  let totalSize =
    0;

  for (
    const file of project.files
  ) {

    if (
      !file.path ||
      typeof file.content !==
        'string'
    ) {

      return {
        valid: false,
        message:
          'يوجد ملف غير صالح داخل المشروع.'
      };

    }

    if (
      file.path.includes(
        '..'
      )
    ) {

      return {
        valid: false,
        message:
          'مسار ملف غير آمن.'
      };

    }

    totalSize +=
      Buffer.byteLength(
        file.content,
        'utf8'
      );

  }

  const MAX_PROJECT_SIZE =
    5 * 1024 * 1024;

  if (
    totalSize >
    MAX_PROJECT_SIZE
  ) {

    return {
      valid: false,
      message:
        'حجم المشروع أكبر من الحد المسموح.'
    };

  }

  return {
    valid: true
  };

}


/* =========================================================
   CREATE ZIP
========================================================= */

async function createProjectZip(
  project
) {

  const tempRoot =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'codemind-'
      )
    );

  const projectRoot =
    path.join(
      tempRoot,
      project.name
        .replace(
          /[^\w\u0600-\u06FF-]+/g,
          '-'
        )
    );

  await fs.mkdir(
    projectRoot,
    {
      recursive:true
    }
  );

  for (
    const file of project.files
  ) {

    const safePath =
      sanitizeProjectPath(
        file.path
      );

    if(!safePath){
      continue;
    }

    const absolutePath =
      path.resolve(
        projectRoot,
        safePath
      );

    const normalizedRoot =
      path.resolve(
        projectRoot
      );

    if (
      !absolutePath.startsWith(
        normalizedRoot +
        path.sep
      )
    ) {

      continue;

    }

    await fs.mkdir(
      path.dirname(
        absolutePath
      ),
      {
        recursive:true
      }
    );

    await fs.writeFile(
      absolutePath,
      file.content,
      'utf8'
    );

  }

  const zipName =
    `${project.name}-${crypto
      .randomBytes(5)
      .toString('hex')}.zip`;

  const zipPath =
    path.join(
      tempRoot,
      zipName
    );

  await new Promise(
    (resolve, reject) => {

      const output =
        requireLikeCreateWriteStream(
          zipPath
        );

      const archive =
        archiver(
          'zip',
          {
            zlib:{
              level:9
            }
          }
        );

      output.on(
        'close',
        resolve
      );

      output.on(
        'error',
        reject
      );

      archive.on(
        'error',
        reject
      );

      archive.pipe(
        output
      );

      archive.directory(
        projectRoot,
        project.name
      );

      archive.finalize();

    }
  );

  return {
    zipPath,
    zipName
  };

}


/* =========================================================
   WRITE STREAM COMPATIBILITY
========================================================= */

import { createWriteStream } from 'fs';

function requireLikeCreateWriteStream(
  filePath
) {

  return createWriteStream(
    filePath
  );

}


/* =========================================================
   TEMP ZIP DOWNLOAD
========================================================= */

const zipStore =
  new Map();


app.get(
  '/api/projects/:id/download',
  async (req, res) => {

    try {

      const project =
        zipStore.get(
          req.params.id
        );

      if(!project){

        return res.status(404).json({
          error:
            'project_not_found',

          message:
            'ملف المشروع غير موجود أو انتهت صلاحيته.'
        });

      }

      res.download(
        project.zipPath,
        project.zipName,
        async function(error){

          if(error){

            console.error(
              'ZIP download error:',
              error
            );

          }

          zipStore.delete(
            req.params.id
          );

          try{

            await fs.rm(
              path.dirname(
                project.zipPath
              ),
              {
                recursive:true,
                force:true
              }
            );

          }catch(cleanupError){

            console.error(
              cleanupError
            );

          }

        }
      );

    }catch(error){

      console.error(
        'ZIP endpoint failed:',
        error
      );

      res.status(500).json({

        error:
          'zip_download_failed',

        message:
          'تعذر تحميل المشروع.'

      });

    }

  }
);


/* =========================================================
   DIRECT AI CHAT
========================================================= */

app.post(
  '/api/chat',
  async (req, res) => {

    try {

      const {
        message,
        mode = 'code',
        history = []
      } = req.body || {};

      /* =========================
         AI CHECK
      ========================= */

      if (
        !isAiConfigured()
      ) {

        return res.status(503).json({

          error:
            'ai_not_configured',

          message:
            'GROQ_API_KEY غير موجود في إعدادات Vercel.'

        });

      }

      /* =========================
         VALIDATION
      ========================= */

      if (
        typeof message !==
          'string' ||
        !message.trim() ||
        message.length > 20000
      ) {

        return res.status(400).json({

          error:
            'invalid_request',

          message:
            'أرسل رسالة صحيحة.'

        });

      }

      /* =========================
         SAFE HISTORY
      ========================= */

      const safeHistory =
        buildSafeHistory(
          history
        );

      /* =========================
         PROJECT MODE
      ========================= */

      const isProjectRequest =
        looksLikeProjectRequest(
          message
        );

      let messages =
        [
          ...safeHistory
        ];

      if (
        isProjectRequest
      ) {

        messages.push({

          role:
            'user',

          content:
            buildProjectPrompt(
              message
            )

        });

      } else {

        messages.push({

          role:
            'user',

          content:
            message.trim()

        });

      }

      /* =========================
         AI
      ========================= */

      const completion =
        await createCompletion({

          messages,

          mode

        });

      const rawReply =
        completion
          .choices?.[0]
          ?.message
          ?.content ||
        '';

      if (
        !rawReply.trim()
      ) {

        return res.status(502).json({

          error:
            'empty_ai_response',

          message:
            'الذكاء الاصطناعي أرسل ردًا فارغًا.'

        });

      }

      /* =========================
         PROJECT PARSING
      ========================= */

      const parsed =
        isProjectRequest
          ? extractProject(
              rawReply
            )
          : {
              reply:
                rawReply.trim(),

              project:
                null
            };

      /* =========================
         CREATE ZIP
      ========================= */

      let projectResponse =
        null;

      if (
        parsed.project
      ) {

        const validation =
          validateProject(
            parsed.project
          );

        if(
          validation.valid
        ) {

          try {

            const zip =
              await createProjectZip(
                parsed.project
              );

            const projectId =
              crypto
                .randomBytes(16)
                .toString('hex');

            zipStore.set(
              projectId,
              zip
            );

            /*
              تنظيف تلقائي بعد ساعة
            */

            setTimeout(
              async function(){

                const item =
                  zipStore.get(
                    projectId
                  );

                if(!item){
                  return;
                }

                zipStore.delete(
                  projectId
                );

                try{

                  await fs.rm(
                    path.dirname(
                      item.zipPath
                    ),
                    {
                      recursive:true,
                      force:true
                    }
                  );

                }catch(error){

                  console.error(
                    error
                  );

                }

              },
              60 * 60 * 1000
            );

            projectResponse = {

              name:
                parsed.project.name,

              description:
                parsed.project.description,

              files:
                parsed.project.files
                  .map(
                    file => ({
                      name:
                        file.path
                    })
                  ),

              zipUrl:
                `/api/projects/${projectId}/download`

            };

          } catch(error) {

            console.error(
              'Project ZIP creation failed:',
              error
            );

          }

        }

      }

      /* =========================
         RESPONSE
      ========================= */

      return res.json({

        reply:
          parsed.reply,

        project:
          projectResponse

      });

    } catch(error) {

      console.error(
        'AI request failed:',
        error
      );

      const isAuthError =
        error.status === 401 ||
        error.code ===
          'invalid_api_key';

      return res.status(502).json({

        error:
          isAuthError
            ? 'invalid_groq_key'
            : 'ai_request_failed',

        message:
          isAuthError
            ? 'مفتاح Groq غير صالح أو منتهي.'
            : 'تعذر الحصول على رد من الذكاء الاصطناعي.',

        details:
          process.env.NODE_ENV ===
            'development'
            ? error.message
            : undefined

      });

    }

  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      'Request failed:',
      error
    );

    if(
      res.headersSent
    ) {

      return next(
        error
      );

    }

    res.status(500).json({

      error:
        'internal_error',

      message:
        'حدث خطأ داخلي.'

    });

  }
);


/* =========================================================
   LOCAL SERVER
========================================================= */

if(
  !process.env.VERCEL
) {

  app.listen(
    port,
    () => {

      console.log(
        `CodeMind AI backend running on http://localhost:${port}`
      );

      if(
        !isAiConfigured()
      ) {

        console.warn(
          'GROQ_API_KEY is missing.'
        );

      }

    }
  );

}


export default app;
