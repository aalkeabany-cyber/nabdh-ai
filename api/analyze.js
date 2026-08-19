const MODEL = "gemini-3.5-flash-lite";
const MAX_COMMENTS = 300;
const CHUNK_SIZE = 50;
const FIXED_SEED = 260814;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function sendJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

function getVideoId(input) {
  try {
    const url = new URL(input);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    const normalId = url.searchParams.get("v");
    if (normalId) return normalId;

    const parts = url.pathname.split("/").filter(Boolean);

    const shortsIndex = parts.indexOf("shorts");
    if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
      return parts[shortsIndex + 1];
    }

    const embedIndex = parts.indexOf("embed");
    if (embedIndex !== -1 && parts[embedIndex + 1]) {
      return parts[embedIndex + 1];
    }

    return null;
  } catch {
    return null;
  }
}

async function getComments(videoId, youtubeKey) {
  const comments = [];
  let pageToken = "";

  while (comments.length < MAX_COMMENTS) {
    const params = new URLSearchParams({
      part: "snippet",
      videoId: videoId,
      maxResults: "100",
      order: "time",
      textFormat: "plainText",
      key: youtubeKey,
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?${params}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "فشل جلب تعليقات YouTube."
      );
    }

    for (const item of data.items || []) {
      const topComment = item?.snippet?.topLevelComment;

      const id = topComment?.id;
      const snippet = topComment?.snippet;
      const text =
        snippet?.textDisplay ||
        snippet?.textOriginal ||
        "";

      if (!id || !text.trim()) continue;

      comments.push({
        id,
        text: text.trim(),
      });

      if (comments.length >= MAX_COMMENTS) break;
    }

    pageToken = data.nextPageToken || "";

    if (!pageToken) break;
  }

  const unique = new Map();

  for (const comment of comments) {
    if (!unique.has(comment.id)) {
      unique.set(comment.id, comment);
    }
  }

  return Array.from(unique.values());
}

const sentimentSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
          },
          sentiment: {
            type: "string",
            enum: [
              "positive",
              "neutral",
              "negative"
            ],
          },
        },
        required: [
          "id",
          "sentiment"
        ],
      },
    },
  },
  required: ["results"],
};

async function askGemini(
  prompt,
  schema,
  geminiKey,
  seed
) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
      geminiKey
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],

        generationConfig: {
          
          seed: seed,
          
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error(data);

    throw new Error(
      data?.error?.message ||
      "حدث خطأ أثناء الاتصال بـ Gemini."
    );
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || "";

  if (!text) {
    throw new Error(
      "لم يرجع Gemini نتيجة صالحة."
    );
  }

  return JSON.parse(text);
}

async function classifyChunk(
  comments,
  geminiKey,
  chunkNumber
) {
  const input = comments.map((comment) => ({
    id: comment.id,
    text: comment.text,
  }));

  const prompt = `
أنت نظام دقيق ومتخصص في تحليل مشاعر تعليقات YouTube.

صنف كل تعليق إلى تصنيف واحد فقط:

positive = إيجابي
neutral = محايد
negative = سلبي

قواعد مهمة جداً:

- افهم العربية الفصحى واللهجات العربية والإنجليزية.
- افهم الإيموجي والسخرية قدر الإمكان.
- المدح والشكر والتشجيع والإعجاب = positive.
- الانتقاد والرفض وعدم الرضا والهجوم الواضح = negative.
- السؤال أو المعلومة بلا موقف واضح = neutral.
- إذا كان التعليق يجمع مدحاً وانتقاداً بشكل متوازن فصنفه neutral.
- الحزن على موضوع الفيديو لا يعني أن صاحب التعليق يكره الفيديو.
- مثال: "الله يرحمه 😢" لا يصنف سلبياً لمجرد وجود الحزن.
- صنف رأي صاحب التعليق تجاه المحتوى.
- لا تخترع أي ID.
- يجب إعادة تصنيف لكل ID موجود.
- لا تغير نصوص الـ ID.

التعليقات:

${JSON.stringify(input)}
`;

  const result = await askGemini(
    prompt,
    sentimentSchema,
    geminiKey,
    FIXED_SEED + chunkNumber
  );

  return result.results || [];
}

async function classifyAll(
  comments,
  geminiKey
) {
  const classifications = new Map();

  for (
    let i = 0;
    i < comments.length;
    i += CHUNK_SIZE
  ) {
    const chunk =
      comments.slice(i, i + CHUNK_SIZE);

    const result = await classifyChunk(
      chunk,
      geminiKey,
      Math.floor(i / CHUNK_SIZE)
    );

    for (const item of result) {
      if (
        item?.id &&
        [
          "positive",
          "neutral",
          "negative"
        ].includes(item.sentiment)
      ) {
        classifications.set(
          item.id,
          item.sentiment
        );
      }
    }
  }

  return comments.map((comment) => ({
    ...comment,

    sentiment:
      classifications.get(comment.id) ||
      "neutral",
  }));
}

function calculatePercentages(comments) {
  const counts = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };

  for (const comment of comments) {
    if (
      Object.prototype.hasOwnProperty.call(
        counts,
        comment.sentiment
      )
    ) {
      counts[comment.sentiment]++;
    }
  }

  const total = comments.length;

  if (!total) {
    return {
      counts,
      positive: 0,
      neutral: 0,
      negative: 0,
    };
  }

  const values = [
    {
      key: "positive",
      raw: counts.positive / total * 100,
    },
    {
      key: "neutral",
      raw: counts.neutral / total * 100,
    },
    {
      key: "negative",
      raw: counts.negative / total * 100,
    },
  ];

  const result = {};
  let used = 0;

  for (const item of values) {
    result[item.key] =
      Math.floor(item.raw);

    used += result[item.key];
  }

  let remaining = 100 - used;

  values
    .map((item) => ({
      ...item,
      fraction:
        item.raw - Math.floor(item.raw),
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction
    )
    .forEach((item) => {
      if (remaining > 0) {
        result[item.key]++;
        remaining--;
      }
    });

  return {
    counts,
    positive: result.positive,
    neutral: result.neutral,
    negative: result.negative,
  };
}

const insightSchema = {
  type: "object",
  properties: {
  summary: {
    type: "string",
  },

  audienceOpinions: {
    type: "array",
    items: {
      type: "string",
    },
  },

  contentIdeas: {
    type: "array",
    items: {
      type: "string",
    },
  },

  problems: {
    type: "array",
    items: {
      type: "string",
    },
  },
},

required: [
  "summary",
  "audienceOpinions",
  "contentIdeas",
  "problems"
],
};
async function createInsights(
  comments,
  stats,
  geminiKey
) {
  const sample =
    comments.slice(0, 120).map(
      (comment) => ({
        text: comment.text,
        sentiment: comment.sentiment,
      })
    );

  const prompt = `
أنت محلل جمهور محترف في منصة نبض AI.

تم تحليل ${comments.length} تعليقاً حقيقياً.

النتيجة المحسوبة برمجياً:

إيجابي:
${stats.positive}%

محايد:
${stats.neutral}%

سلبي:
${stats.negative}%

الأعداد:

إيجابي:
${stats.counts.positive}

محايد:
${stats.counts.neutral}

سلبي:
${stats.counts.negative}

هذه عينة ثابتة من التعليقات:

${JSON.stringify(sample)}

المطلوب:

summary:
اكتب ملخصاً عربياً احترافياً وقصيراً يشرح رأي الجمهور.

audienceOpinions:
اكتب أهم آراء الجمهور المتكررة، بحد أقصى 5 نقاط.

contentIdeas:
اقترح بحد أقصى 5 أفكار مفيدة لصاحب الفيديو بناءً على التعليقات.
problems:
اكتب أهم المشاكل والسلبيات التي أشار إليها الجمهور في التعليقات، بحد أقصى 5 نقاط.
إذا لم توجد مشاكل أو سلبيات واضحة، أعد مصفوفة فارغة.
مهم جداً:
لا تغير نسب المشاعر.
لا تخترع آراء غير موجودة في التعليقات.
`;

  return askGemini(
    prompt,
    insightSchema,
    geminiKey,
    FIXED_SEED + 5000
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request) {
  try {
    const GEMINI_API_KEY =
      process.env.GEMINI_API_KEY;

    const YOUTUBE_API_KEY =
      process.env.YOUTUBE_API_KEY;

    if (
      !GEMINI_API_KEY ||
      !YOUTUBE_API_KEY
    ) {
      return sendJson(
        {
          error:
            "مفاتيح API غير موجودة في Vercel.",
        },
        500
      );
    }

    const body = await request.json();

    const videoUrl =
      body?.url ||
      body?.videoUrl ||
      body?.youtubeUrl ||
      "";

    if (!videoUrl.trim()) {
      return sendJson(
        {
          error:
            "أدخل رابط فيديو YouTube.",
        },
        400
      );
    }

    const videoId =
      getVideoId(videoUrl.trim());

    if (!videoId) {
      return sendJson(
        {
          error:
            "رابط YouTube غير صالح.",
        },
        400
      );
    }

    const comments =
      await getComments(
        videoId,
        YOUTUBE_API_KEY
      );

    if (!comments.length) {
      return sendJson(
        {
          error:
            "لم يتم العثور على تعليقات لهذا الفيديو.",
        },
        400
      );
    }

    const classified =
      await classifyAll(
        comments,
        GEMINI_API_KEY
      );

    const stats =
      calculatePercentages(classified);

    const insights =
      await createInsights(
        classified,
        stats,
        GEMINI_API_KEY
      );

    return sendJson({
      success: true,

      videoId,

      commentsCount:
        classified.length,

      analyzedComments:
        classified.length,

      positive:
        stats.positive,

      neutral:
        stats.neutral,

      negative:
        stats.negative,

      counts:
        stats.counts,

      summary:
        insights.summary || "",

      audienceOpinions:
        insights.audienceOpinions || [],

      contentIdeas:
        insights.contentIdeas || [],
problems:
  insights.problems || [],
      analyzedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);

    return sendJson(
      {
        error:
          error?.message ||
          "حدث خطأ أثناء التحليل.",
      },
      500
    );
  }
        }
