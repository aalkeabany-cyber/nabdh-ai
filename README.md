# نبض AI
واجهة عربية لتحليل تعليقات فيديوهات يوتيوب.

## GitHub Pages
ارفع الملفات كما هي إلى جذر المستودع. الواجهة ستعمل على GitHub Pages، لكن التحليل الحقيقي يحتاج Backend.

## Netlify (للتحليل الحقيقي)
أضف Environment variables:
- YOUTUBE_API_KEY
- OPENAI_API_KEY

ثم انشر المشروع على Netlify، وسيعمل المسار `/.netlify/functions/analyze` تلقائياً.
