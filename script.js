const $ = (id) => document.getElementById(id);

const urlInput = $('youtubeUrl');
const analyzeBtn = $('analyzeBtn');
const result = $('result');
const resetBtn = $('resetBtn');

const menuBtn = $('menuBtn');
const drawer = $('drawer');
const drawerClose = $('drawerClose');
const backdrop = $('backdrop');
const CACHE_VERSION = 'v1';

function getVideoIdForCache(value) {
  try {
    const url = new URL(value.trim());

    if (url.hostname.includes('youtu.be')) {
      return url.pathname.split('/').filter(Boolean)[0] || null;
    }

    const normalId = url.searchParams.get('v');
    if (normalId) return normalId;

    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.includes('shorts')) {
      return parts[parts.indexOf('shorts') + 1] || null;
    }

    if (parts.includes('embed')) {
      return parts[parts.indexOf('embed') + 1] || null;
    }

    return null;
  } catch {
    return null;
  }
}

function getCachedAnalysis(videoUrl) {
  return null;
}
  const videoId = getVideoIdForCache(videoUrl);
  if (!videoId) return null;

  try {
    const saved = localStorage.getItem(
      `nabdh-${CACHE_VERSION}-${videoId}`
    );

    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveCachedAnalysis(videoUrl, data) {
  const videoId = getVideoIdForCache(videoUrl);
  if (!videoId) return;

  try {
    localStorage.setItem(
      `nabdh-${CACHE_VERSION}-${videoId}`,
      JSON.stringify(data)
    );
  } catch {}
}
function isYouTubeUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace('www.', '');

    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

function sync() {
  if (!urlInput || !analyzeBtn) return;

  const ready = isYouTubeUrl(urlInput.value);

  analyzeBtn.disabled = !ready;
  analyzeBtn.classList.toggle('ready', ready);
}

function arrayToText(items) {
  if (!Array.isArray(items) || !items.length) return '—';

  return items.map(item => `• ${item}`).join('\n');
}

function fill(data, commentsCount = 0) {
  const positive = Number(data.positive) || 0;
  const neutral = Number(data.neutral) || 0;
  const negative = Number(data.negative) || 0;

  const summaryText = $('summaryText');
  const positiveStat = $('positiveStat');
  const neutralStat = $('neutralStat');
  const negativeStat = $('negativeStat');

  const positiveBar = $('positiveBar');
  const neutralBar = $('neutralBar');
  const negativeBar = $('negativeBar');

  const likedText = $('likedText');
  const requestedText = $('requestedText');
  const ideaText = $('ideaText');

  if (summaryText) {
    summaryText.textContent =
      `${data.summary || 'لا يوجد ملخص.'}` +
      (commentsCount ? ` — تم تحليل ${commentsCount} تعليقًا.` : '');
  }

  if (positiveStat) positiveStat.textContent = `${positive}%`;
  if (neutralStat) neutralStat.textContent = `${neutral}%`;
  if (negativeStat) negativeStat.textContent = `${negative}%`;

  if (positiveBar) positiveBar.style.width = `${positive}%`;
  if (neutralBar) neutralBar.style.width = `${neutral}%`;
  if (negativeBar) negativeBar.style.width = `${negative}%`;

  if (likedText) likedText.textContent = data.liked || '—';
  if (requestedText) requestedText.textContent = data.requested || '—';
  if (ideaText) ideaText.textContent = data.idea || '—';

  if (result) {
    result.hidden = false;
    result.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

if (urlInput) {
  urlInput.addEventListener('input', sync);
}

if (analyzeBtn) {
  analyzeBtn.addEventListener('click', async () => {
    if (!isYouTubeUrl(urlInput.value)) return;
const videoUrl = urlInput.value.trim();
const cachedData = getCachedAnalysis(videoUrl);

if (cachedData) {
  fill(
    cachedData,
    cachedData.commentsCount || cachedData.analyzedComments || 0
  );

  if (result) result.hidden = false;

  result?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  return;
}
    const oldText = analyzeBtn.innerHTML;

    analyzeBtn.disabled = true;
    analyzeBtn.classList.remove('ready');
    analyzeBtn.innerHTML = '<span>جاري التحليل...</span>';

    if (result) result.hidden = true;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          youtubeUrl: urlInput.value.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر إكمال التحليل.');
      }

      saveCachedAnalysis(videoUrl, data);
      fill(
        {
          summary:
            data.summary ||
            data.analysis?.summary ||
            '',

          positive:
            data.positive ??
            data.analysis?.sentiment?.positive ??
            0,

          neutral:
            data.neutral ??
            data.analysis?.sentiment?.neutral ??
            0,

          negative:
            data.negative ??
            data.analysis?.sentiment?.negative ??
            0,

          liked: arrayToText(
            data.audienceOpinions ||
            data.analysis?.audienceOpinions
          ),

          requested: arrayToText(
            data.contentIdeas ||
            data.analysis?.contentIdeas
          ),

          idea: arrayToText(
            data.problems ||
            data.analysis?.problems
          )
        },
        data.commentsAnalyzed || 0
      );

    } catch (error) {
      fill({
        summary: error.message,
        positive: 0,
        neutral: 0,
        negative: 0,
        liked: '—',
        requested: '—',
        idea: '—'
      });
    } finally {
      analyzeBtn.innerHTML = oldText;
      sync();
    }
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (result) result.hidden = true;

    if (urlInput) {
      urlInput.value = '';
      sync();

      document.getElementById('analyzer')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      setTimeout(() => urlInput.focus(), 400);
    }
  });
}

/* القائمة */
function openMenu() {
  drawer?.classList.add('open');
  backdrop?.classList.add('show');

  drawer?.setAttribute('aria-hidden', 'false');
  menuBtn?.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  drawer?.classList.remove('open');
  backdrop?.classList.remove('show');

  drawer?.setAttribute('aria-hidden', 'true');
  menuBtn?.setAttribute('aria-expanded', 'false');
}

menuBtn?.addEventListener('click', openMenu);
drawerClose?.addEventListener('click', closeMenu);
backdrop?.addEventListener('click', closeMenu);

document.querySelectorAll('[data-scroll]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(button.dataset.scroll);

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    closeMenu();
  });
});

sync();
