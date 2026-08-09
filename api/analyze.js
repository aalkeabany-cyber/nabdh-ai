export async function POST(request) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

    if (!GEMINI_API_KEY || !YOUTUBE_API_KEY) {
      return Response.json(
        { error: "مفاتيح API غير موجودة في Vercel." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const videoUrl =
      body.url ||
      body.videoUrl ||
      body.youtubeUrl ||
      "";

    const videoId = getVideoId(videoUrl);

    if (!videoId) {
      return Response.json(
        { error: "رابط YouTube غير صحيح." },
        { status: 400 }
      );
    }

    // جلب حتى 100 تعليق من YouTube
    const youtubeUrl =
      "https://www.googleapis.com/youtube/v3/commentThreads" +
      "?part=snippet" +
      "&videoId=" + encodeURIComponent(videoId) +
      "&maxResults=100" +
      "&order=relevance" +
      "&textFormat=plainText" +
      "&key=" + encodeURIComponent(YOUTUBE_API_KEY);

    const youtubeResponse = await fetch(youtubeUrl);
    const youtubeData = await youtubeResponse.json();

    if (!youtubeResponse.ok) {
      const message =
        youtubeData?.error?.message ||
        "تعذر جلب تعليقات الفيديو.";

      return Response.json(
        { error: message },
        { status: youtubeResponse.status }
      );
    }

    const comments = (youtubeData.items || [])
      .map((item) => {
        const snippet =
          item?.snippet?.topLevelComment?.snippet;

        return {
          text: snippet?.textDisplay || "",
          likes: snippet?.likeCount || 0
        };
      })
      .filter((comment) => comment.text)
      .map((comment) => ({
        ...comment,
        text: comment.text.slice(0, 500)
      }));

    if (comments.length === 0) {
      return Response.json(
        { error: "لم نجد تعليقات عامة لهذا الفيديو." },
        { status: 400 }
      );
    }

    const commentsText = comments
      .map(
        (comment, index) =>
          `${index + 1}. ${comment.text} | الإعجابات: ${comment.likes}`
      )
      .join("\n");

    const prompt = `
أنت محلل محترف لتعليقات YouTube.

حلل التعليقات التالية باللغة العربية.

أريد منك:
1. تحديد نسبة التعليقات الإيجابية والمحايدة والسلبية.
2. تلخيص رأي الجمهور.
3. استخراج أهم المواضيع التي يتحدث عنها الجمهور.
4. اقتراح أفكار محتوى جديدة لصاحب الفيديو.
5. استخراج المشاكل والانتقادات والسلبيات.
6. تقديم توصيات عملية لتحسين المحتوى.

يجب أن تكون نسب:
positive + neutral + negative = 100

أعد النتيجة بصيغة JSON فقط، بدون Markdown وبدون شرح إضافي، بهذا الشكل:

{
  "summary": "ملخص عربي قصير",
  "sentiment": {
    "positive": 0,
    "neutral": 0,
    "negative": 0
  },
  "audienceOpinions": [
    "رأي 1",
    "رأي 2",
    "رأي 3"
  ],
  "topTopics": [
    "موضوع 1",
    "موضوع 2",
    "موضوع 3"
  ],
  "contentIdeas": [
    "فكرة 1",
    "فكرة 2",
    "فكرة 3"
  ],
  "problems": [
    "مشكلة أو سلبية 1",
    "مشكلة أو سلبية 2"
  ],
  "recommendations": [
    "توصية 1",
    "توصية 2",
    "توصية 3"
  ]
}

التعليقات:
${commentsText}
`;

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        })
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return Response.json(
        {
          error:
            geminiData?.error?.message ||
            "حدث خطأ أثناء تحليل التعليقات بواسطة Gemini."
        },
        { status: geminiResponse.status }
      );
    }

    let text =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    text = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let analysis;

    try {
      analysis = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);

      if (!match) {
        throw new Error("Gemini لم يُرجع نتيجة قابلة للقراءة.");
      }

      analysis = JSON.parse(match[0]);
    }

    const positive = clampNumber(
      analysis?.sentiment?.positive
    );

    const neutral = clampNumber(
      analysis?.sentiment?.neutral
    );

    const negative = clampNumber(
      analysis?.sentiment?.negative
    );

    const total = positive + neutral + negative;

    if (total > 0 && total !== 100) {
      analysis.sentiment = {
        positive: Math.round((positive / total) * 100),
        neutral: Math.round((neutral / total) * 100),
        negative: Math.round((negative / total) * 100)
      };

      const fixedTotal =
        analysis.sentiment.positive +
        analysis.sentiment.neutral +
        analysis.sentiment.negative;

      analysis.sentiment.positive +=
        100 - fixedTotal;
    }

    return Response.json({
      success: true,
      videoId,
      commentsAnalyzed: comments.length,

      positive: analysis.sentiment?.positive || 0,
      neutral: analysis.sentiment?.neutral || 0,
      negative: analysis.sentiment?.negative || 0,

      summary: analysis.summary || "",
      audienceOpinions: analysis.audienceOpinions || [],
      topTopics: analysis.topTopics || [],
      contentIdeas: analysis.contentIdeas || [],
      problems: analysis.problems || [],
      recommendations: analysis.recommendations || [],

      analysis
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          error?.message ||
          "حدث خطأ غير متوقع أثناء التحليل."
      },
      { status: 500 }
    );
  }
}

export function GET() {
  return Response.json({
    success: true,
    message: "Nabdh AI API is running"
  });
}

function getVideoId(input) {
  if (!input) return null;

  const value = String(input).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (
      url.hostname === "youtu.be" ||
      url.hostname === "www.youtu.be"
    ) {
      return url.pathname
        .split("/")
        .filter(Boolean)[0] || null;
    }

    if (
      url.hostname.includes("youtube.com")
    ) {
      const watchId = url.searchParams.get("v");

      if (watchId) return watchId;

      const parts = url.pathname
        .split("/")
        .filter(Boolean);

      if (
        ["shorts", "embed", "live"].includes(parts[0]) &&
        parts[1]
      ) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function clampNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  return Math.max(
    0,
    Math.min(100, Math.round(number))
  );
}
