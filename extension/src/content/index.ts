import type { EnhancedSubtitle, WordBreakdown } from '../lib/api';

// Vite inlines this at build time from extension/.env
const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

// ── Language detection ────────────────────────────────────────────────────────

function detectLang(text: string): string {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // hiragana / katakana
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';              // hangul
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';              // arabic
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';              // cyrillic
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';              // CJK (chinese)
  return 'auto';
}

// ── Background proxy fetch ────────────────────────────────────────────────────
// Routes all HTTP calls through the background service worker.
// Background contexts are NOT subject to Chrome's Private Network Access (PNA)
// restriction that blocks HTTPS pages (YouTube) from fetching http://localhost.

interface ProxyResponse {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

function proxyFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_API', url, ...options },
      (response: ProxyResponse | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'Extension context unavailable'));
          return;
        }
        if (!response) {
          reject(new Error('No response from background worker'));
          return;
        }
        resolve(response);
      },
    );
  });
}

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ── Client-side word tokenisation (shows words before API responds) ───────────

const WORD_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fb923c'];

function clientTokenize(text: string, lang: string): string[] {
  // CJK: split every character (no spaces between words)
  if (lang === 'ja' || lang === 'zh') {
    return Array.from(text).filter((c) => c.trim() !== '');
  }
  return text.split(/\s+/).filter((w) => w !== '');
}

// ── Subtitle history (for AI context) ─────────────────────────────────────────

const subtitleHistory: string[] = [];
const MAX_HISTORY = 6;

// ── Caption preloading types ──────────────────────────────────────────────────

interface CaptionEntry {
  tStartMs: number;
  dDurationMs: number;
  text: string;
}

let captionEntries: CaptionEntry[] = [];
let preloadTimer: number | null = null;
let preloadingInitialized = false;

// ── State ─────────────────────────────────────────────────────────────────────

let enabled = false;
let overlay: HTMLDivElement | null = null;
let captionObserver: MutationObserver | null = null;
let lastText = '';
let processingLock = false;
let pendingText: string | null = null;
let currentSubtitle: EnhancedSubtitle | null = null;

const subtitleCache = new Map<string, EnhancedSubtitle>();

// Drag state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let overlayX = 0;
let overlayY = 0;

// Player position tracking
let playerObserver: ResizeObserver | null = null;

// Transcript sidebar state
let transcriptEl: HTMLDivElement | null = null;
let transcriptBodyEl: HTMLDivElement | null = null;
let autoScrollTranscript = true;

// ── Auth token ────────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response?.token ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ── Player-relative overlay positioning ──────────────────────────────────────
// Keeps the overlay just above the YouTube controls bar regardless of scroll,
// theater mode, or window resize.

function updateOverlayPosition() {
  if (!overlay) return;
  const player = document.querySelector<HTMLElement>('#movie_player');
  if (!player) return;
  const rect = player.getBoundingClientRect();
  // 50px gap from the player's bottom edge (sits above the controls bar)
  const fromBottom = window.innerHeight - rect.bottom + 50;
  overlay.style.bottom = `${Math.max(fromBottom, 8)}px`;
}

function startPositionTracking() {
  updateOverlayPosition();
  const player = document.querySelector<HTMLElement>('#movie_player');
  if (player && !playerObserver) {
    playerObserver = new ResizeObserver(updateOverlayPosition);
    playerObserver.observe(player);
    playerObserver.observe(document.documentElement);
  }
  window.addEventListener('scroll', updateOverlayPosition, { passive: true });
  window.addEventListener('resize', updateOverlayPosition, { passive: true });
}

function stopPositionTracking() {
  playerObserver?.disconnect();
  playerObserver = null;
  window.removeEventListener('scroll', updateOverlayPosition);
  window.removeEventListener('resize', updateOverlayPosition);
}

// ── Transcript sidebar ────────────────────────────────────────────────────────

function buildTranscriptWordSpan(word: string, colorIndex: number, wb: WordBreakdown | null, sub: EnhancedSubtitle): HTMLElement {
  const span = document.createElement('span');
  span.className = 'subly-word';
  span.textContent = word;
  span.style.color = WORD_COLORS[colorIndex % WORD_COLORS.length];
  span.addEventListener('click', () => {
    if (!wb) {
      showToast('Click a Japanese or romaji word to save', 'info');
      return;
    }
    handleWordClick(wb, sub);
  });
  return span;
}

function createTranscript(): HTMLDivElement {
  const div = document.createElement('div');
  div.id = 'subly-transcript';

  const header = document.createElement('div');
  header.className = 'subly-transcript-header';

  const title = document.createElement('span');
  title.className = 'subly-transcript-title';
  title.textContent = 'Transcript';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'subly-transcript-clear';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    if (transcriptBodyEl) transcriptBodyEl.innerHTML = '';
  });

  header.appendChild(title);
  header.appendChild(clearBtn);
  div.appendChild(header);

  const body = document.createElement('div');
  body.className = 'subly-transcript-body';

  body.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = body;
    autoScrollTranscript = scrollTop + clientHeight >= scrollHeight - 24;
  });

  div.appendChild(body);
  transcriptBodyEl = body;

  document.body.appendChild(div);
  return div;
}

function appendTranscriptEntry(sub: EnhancedSubtitle) {
  if (!transcriptBodyEl) return;

  // Deduplicate: same subtitle re-rendered (silence reset, cache hit after API, etc.)
  const last = transcriptBodyEl.lastElementChild as HTMLElement | null;
  if (last?.dataset.text === sub.original) return;

  const entry = document.createElement('div');
  entry.className = 'subly-transcript-entry';
  entry.dataset.text = sub.original;

  // Japanese words row (color-coded, clickable to save)
  const wordsRow = document.createElement('div');
  wordsRow.className = 'subly-transcript-entry-words';
  const tokens = sub.wordBreakdown.filter((wb) => wb.word.trim());
  if (tokens.length > 0) {
    tokens.forEach((wb, i) => wordsRow.appendChild(buildTranscriptWordSpan(wb.word, i, wb, sub)));
  } else {
    clientTokenize(sub.original, sub.sourceLanguage).forEach((tok, i) =>
      wordsRow.appendChild(buildTranscriptWordSpan(tok, i, null, sub)),
    );
  }
  entry.appendChild(wordsRow);

  // Romaji row (color-coded, clickable to save the underlying Japanese word)
  const hasTranslit = !!(sub.transliteration && sub.transliteration !== sub.original);
  if (hasTranslit && tokens.length > 0) {
    const translitRow = document.createElement('div');
    translitRow.className = 'subly-transcript-entry-translit';
    let added = false;
    tokens.forEach((wb, i) => {
      if (wb.transliteration && wb.transliteration !== wb.word) {
        translitRow.appendChild(buildTranscriptWordSpan(wb.transliteration, i, wb, sub));
        added = true;
      }
    });
    if (added) entry.appendChild(translitRow);
  }

  // English translation — plain sentence text
  if (sub.translation) {
    const transRow = document.createElement('div');
    transRow.className = 'subly-transcript-entry-translation';
    transRow.textContent = sub.translation;
    entry.appendChild(transRow);
  }

  transcriptBodyEl.appendChild(entry);

  if (autoScrollTranscript) {
    transcriptBodyEl.scrollTop = transcriptBodyEl.scrollHeight;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message: string, type: 'success' | 'info' | 'error' = 'info') {
  const existing = document.getElementById('subly-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'subly-toast';
  toast.className = `subly-toast subly-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('subly-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('subly-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function createOverlay(): HTMLDivElement {
  const div = document.createElement('div');
  div.id = 'subly-overlay';
  div.innerHTML = `
    <div class="subly-translation" id="subly-translation"></div>
    <div class="subly-words" id="subly-words"></div>
    <div class="subly-transliteration" id="subly-transliteration"></div>
    <div class="subly-tooltip" id="subly-tooltip"></div>
  `;

  // Hide tooltip when mouse leaves it
  const tooltip = div.querySelector('#subly-tooltip') as HTMLElement;
  tooltip.addEventListener('mouseleave', hideWordTooltip);

  div.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.subly-word')) return;
    isDragging = true;
    dragStartX = e.clientX - overlayX;
    dragStartY = e.clientY - overlayY;
    div.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    overlayX = e.clientX - dragStartX;
    overlayY = e.clientY - dragStartY;
    div.style.transform = `translateX(calc(-50% + ${overlayX}px)) translateY(${overlayY}px)`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; div.style.cursor = 'grab'; }
  });

  document.body.appendChild(div);
  return div;
}

// ── Word span factory ─────────────────────────────────────────────────────────

function buildWordSpan(
  word: string,
  colorIndex: number,
  wb: WordBreakdown | null,
  sub: EnhancedSubtitle | null,
): HTMLElement {
  const span = document.createElement('span');
  span.className = 'subly-word';
  span.textContent = word;
  span.style.color = WORD_COLORS[colorIndex % WORD_COLORS.length];

  const tooltipWb: WordBreakdown = wb ?? {
    word,
    transliteration: word,
    translation: '',
    startIndex: 0,
    endIndex: word.length,
  };

  span.addEventListener('mouseenter', (e) => showWordTooltip(e, tooltipWb));
  span.addEventListener('mouseleave', (e) => {
    // Don't hide if the mouse moved into the tooltip
    const tip = overlay?.querySelector('#subly-tooltip');
    if (tip && tip.contains((e as MouseEvent).relatedTarget as Element | null)) return;
    hideWordTooltip();
  });
  span.addEventListener('click', () => {
    const activeSub = sub ?? currentSubtitle;
    if (!activeSub) {
      showToast('Waiting for translation…', 'info');
      return;
    }
    handleWordClick(tooltipWb, activeSub);
  });

  return span;
}

// ── Render ────────────────────────────────────────────────────────────────────

function getOverlayEls() {
  return {
    translationEl: overlay!.querySelector('#subly-translation') as HTMLElement,
    wordsEl: overlay!.querySelector('#subly-words') as HTMLElement,
    translitEl: overlay!.querySelector('#subly-transliteration') as HTMLElement,
  };
}

function renderSubtitle(sub: EnhancedSubtitle) {
  if (!overlay) return;
  const { translationEl, wordsEl, translitEl } = getOverlayEls();

  const tokens = sub.wordBreakdown.filter((wb) => wb.word.trim());
  const hasTranslit = !!(sub.transliteration && sub.transliteration !== sub.original);
  // Guard: MyMemory echoes the source text when it can't translate — never show that as English
  const translation = sub.translation !== sub.original ? sub.translation : '';

  // ── Japanese row — always shown, colored + clickable ──────────────────────
  wordsEl.innerHTML = '';
  if (tokens.length > 0) {
    tokens.forEach((wb, i) => wordsEl.appendChild(buildWordSpan(wb.word, i, wb, sub)));
  } else {
    clientTokenize(sub.original, sub.sourceLanguage).forEach((tok, i) =>
      wordsEl.appendChild(buildWordSpan(tok, i, null, sub)),
    );
  }

  // ── Romaji row — shown whenever transliteration differs from original ─────
  translitEl.innerHTML = '';
  if (hasTranslit) {
    if (tokens.length > 0) {
      let added = false;
      tokens.forEach((wb, i) => {
        if (wb.transliteration && wb.transliteration !== wb.word) {
          translitEl.appendChild(buildWordSpan(wb.transliteration, i, wb, sub));
          added = true;
        }
      });
      if (!added) translitEl.textContent = sub.transliteration;
    } else {
      translitEl.textContent = sub.transliteration;
    }
  }

  // ── English row — always color-coded ─────────────────────────────────────
  // When per-word glosses are cached, each English word gets the same color index
  // as its corresponding Japanese/romaji word (exact match).
  // When glosses aren't cached yet, fall back to the sentence translation split by
  // spaces with positional colors — still fully colored, just not word-aligned.
  translationEl.innerHTML = '';
  translationEl.style.opacity = '1';
  if (translation) {
    let glossCount = 0;
    if (tokens.length > 0) {
      tokens.forEach((wb, i) => {
        const g = wb.translation;
        if (g && g !== sub.original && g.length <= 20 && g.trim().split(/\s+/).length <= 3) {
          translationEl.appendChild(buildWordSpan(g, i, wb, sub));
          glossCount++;
        }
      });
    }
    // Glosses don't cover enough tokens — use sentence translation, color-coded by position
    if (glossCount < Math.ceil(tokens.length / 2)) {
      translationEl.innerHTML = '';
      translation.trim().split(/\s+/).filter(Boolean).forEach((word, i) => {
        translationEl.appendChild(buildWordSpan(word, i, null, sub));
      });
    }
  }

  appendTranscriptEntry(sub);
}

function showLoading(text: string, lang: string) {
  if (!overlay) return;
  const { translationEl, wordsEl, translitEl } = getOverlayEls();

  translationEl.textContent = '…';
  translationEl.style.opacity = '0.35';
  translitEl.textContent = '';
  wordsEl.innerHTML = '';

  // Render client-side tokens immediately in the original row — clickable right away
  clientTokenize(text, lang).forEach((token, i) => {
    const span = buildWordSpan(token, i, null, null);
    span.style.opacity = '0.6';
    wordsEl.appendChild(span);
  });
}

function showFallback(text: string, lang: string) {
  if (!overlay) return;
  const { translationEl, wordsEl, translitEl } = getOverlayEls();

  translationEl.innerHTML = '';
  translationEl.style.opacity = '1';
  translitEl.innerHTML = '';
  wordsEl.innerHTML = '';

  clientTokenize(text, lang).forEach((token, i) => {
    wordsEl.appendChild(buildWordSpan(token, i, null, null));
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showWordTooltip(e: MouseEvent, wb: WordBreakdown) {
  if (!overlay) return;
  const tooltip = overlay.querySelector('#subly-tooltip') as HTMLElement;

  tooltip.innerHTML = '';

  const lines: string[] = [];
  if (wb.word) lines.push(`<span class="subly-tip-original">${wb.word}</span>`);
  if (wb.transliteration && wb.transliteration !== wb.word)
    lines.push(`<span class="subly-tip-romaji">${wb.transliteration}</span>`);
  if (wb.translation)
    lines.push(`<span class="subly-tip-translation">${wb.translation}</span>`);

  if (!lines.length) return;

  const textDiv = document.createElement('div');
  textDiv.className = 'subly-tip-text';
  textDiv.innerHTML = lines.join('');
  tooltip.appendChild(textDiv);

  // Lightbulb button for AI in-context definition
  const aiBtn = document.createElement('button');
  aiBtn.className = 'subly-ai-btn';
  aiBtn.title = 'AI in-context definition';
  aiBtn.textContent = '💡';
  aiBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    fetchAndShowAIDef(tooltip, wb);
  });
  tooltip.appendChild(aiBtn);

  tooltip.style.display = 'flex';

  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();

  requestAnimationFrame(() => {
    tooltip.style.left = `${rect.left - overlayRect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - overlayRect.top - tooltip.offsetHeight - 8}px`;
  });
}

function hideWordTooltip() {
  if (!overlay) return;
  (overlay.querySelector('#subly-tooltip') as HTMLElement).style.display = 'none';
}

// ── AI in-context definition ──────────────────────────────────────────────────

async function fetchAndShowAIDef(tooltip: HTMLElement, wb: WordBreakdown) {
  // Reuse or create the AI definition div inside the tooltip
  let aiDiv = tooltip.querySelector('.subly-ai-def') as HTMLElement | null;
  if (!aiDiv) {
    aiDiv = document.createElement('div');
    aiDiv.className = 'subly-ai-def';
    tooltip.appendChild(aiDiv);
  }

  aiDiv.textContent = '⟳ Thinking…';

  try {
    const video = document.querySelector<HTMLVideoElement>('video');
    const currentMs = (video?.currentTime ?? 0) * 1000;

    const videoTitle =
      document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string')
        ?.textContent?.trim() ??
      document.title.replace(' - YouTube', '').trim();

    // Upcoming subtitles from preloaded caption entries
    const upcoming = captionEntries
      .filter((e) => e.tStartMs > currentMs && e.tStartMs <= currentMs + 15000)
      .slice(0, 3)
      .map((e) => e.text);

    const token = await getToken();
    const res = await proxyFetch(`${API_URL}/api/ai/define`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        word: wb.word,
        transliteration: wb.transliteration,
        translation: wb.translation,
        sourceLanguage: currentSubtitle?.sourceLanguage ?? 'ja',
        recentSubtitles: subtitleHistory.slice(-3),
        upcomingSubtitles: upcoming,
        videoTitle,
      }),
    });

    if (res.ok) {
      const data = res.data as { definition: string };
      aiDiv.textContent = data.definition;
    } else if ((res.data as Record<string, unknown>)?.error === 'AI feature not configured on this server') {
      aiDiv.textContent = 'AI not configured (add GROQ_API_KEY to backend).';
    } else {
      aiDiv.textContent = 'AI unavailable.';
    }
  } catch {
    aiDiv.textContent = 'AI unavailable.';
  }

  // Reposition tooltip now that it's taller
  requestAnimationFrame(() => {
    const overlayRect = overlay?.getBoundingClientRect();
    if (!overlayRect) return;
    const currentTop = parseInt(tooltip.style.top || '0', 10);
    tooltip.style.top = `${currentTop - tooltip.offsetHeight / 2}px`;
  });
}

// ── Word save ─────────────────────────────────────────────────────────────────

// Fetch a per-word translation directly from MyMemory when the cache hasn't warmed yet.
async function fetchWordTranslation(word: string, sourceLang: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${sourceLang}|en`;
    const res = await proxyFetch(url, {});
    if (res.ok && res.data) {
      const data = res.data as { responseStatus: number; responseData: { translatedText: string } };
      if (data.responseStatus === 200) {
        const t = data.responseData?.translatedText?.trim();
        // MyMemory echoes the input when it can't translate — discard that
        if (t && t.toLowerCase() !== word.toLowerCase() && t.length < 60) return t;
      }
    }
  } catch { /* ignore — word saves with empty translation rather than wrong one */ }
  return '';
}

async function handleWordClick(wb: WordBreakdown, sub: EnhancedSubtitle) {
  const token = await getToken();
  if (!token) {
    showToast('Sign in to save words', 'info');
    return;
  }

  // Detect fallback English spans: wb has no real breakdown (word == transliteration, no translation)
  // and the word is Latin-only while the source language is non-Latin. These can't be saved
  // as meaningful dictionary entries — the user should click the Japanese or romaji word instead.
  const isLatinOnly = /^[a-zA-Z\s'-]+$/.test(wb.word);
  const nonLatinSource = ['ja', 'zh', 'ko', 'ar', 'ru'].includes(sub.sourceLanguage);
  if (isLatinOnly && nonLatinSource && wb.transliteration === wb.word && !wb.translation) {
    showToast('Click a Japanese or romaji word to save', 'info');
    return;
  }

  // Use cached per-word translation; if absent, fetch it now (single MyMemory call)
  let wordTranslation = wb.translation;
  if (!wordTranslation && wb.word.trim()) {
    wordTranslation = await fetchWordTranslation(wb.word, sub.sourceLanguage);
  }

  try {
    const res = await proxyFetch(`${API_URL}/api/dictionary`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        word: wb.word,
        transliteration: wb.transliteration || wb.word,
        translation: wordTranslation,           // correct per-word translation, not the sentence
        context_sentence: sub.original,
        source_language: sub.sourceLanguage,
        video_url: window.location.href,
      }),
    });

    if (res.status === 409) {
      showToast('Already saved', 'info');
    } else if (res.ok) {
      showToast(`Saved "${wb.word}"`, 'success');
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[Subly] save word error:', err);
    showToast('Failed to save — check connection', 'error');
  }
}

// ── Subtitle processing ───────────────────────────────────────────────────────

async function processSubtitleText(text: string) {
  if (!overlay) return;

  const trimmed = text.trim();
  const lang = detectLang(trimmed);

  subtitleHistory.push(trimmed);
  if (subtitleHistory.length > MAX_HISTORY) subtitleHistory.shift();

  if (!preloadingInitialized && lang !== 'auto') {
    preloadingInitialized = true;
    initPreloading(lang).catch(() => {});
  }

  // ── Fast path: preloaded / cached result → instant render, zero loading flash ──
  if (subtitleCache.has(trimmed)) {
    overlay.style.display = 'flex';
    const cached = subtitleCache.get(trimmed)!;
    currentSubtitle = cached;
    renderSubtitle(cached);
    return;
  }

  // ── Slow path: needs a network round-trip ────────────────────────────────
  // Only one request at a time; queue the latest text for when the lock releases.
  if (processingLock) {
    pendingText = text;
    return;
  }
  processingLock = true;
  pendingText = null;

  overlay.style.display = 'flex';
  showLoading(trimmed, lang); // Japanese tokens clickable immediately while we wait

  try {
    const token = await getToken();

    const res = await proxyFetch(`${API_URL}/api/subtitles/enhance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text: trimmed, source_language: lang, target_language: 'en' }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const result = res.data as EnhancedSubtitle;

    subtitleCache.set(trimmed, result);
    if (subtitleCache.size > 200) {
      const firstKey = subtitleCache.keys().next().value;
      if (firstKey) subtitleCache.delete(firstKey);
    }

    currentSubtitle = result;
    renderSubtitle(result);
  } catch (err) {
    console.warn('[Subly] enhance failed:', (err as Error).message);
    showFallback(trimmed, lang);
  } finally {
    processingLock = false;
    const queued = pendingText;
    if (queued) {
      pendingText = null;
      processSubtitleText(queued);
    }
  }
}

// ── Caption preloading ────────────────────────────────────────────────────────

// Inject a tiny script to read ytInitialPlayerResponse (page global) and post it back.
// Content scripts run in an isolated world but share window with the page, so
// postMessage works as the bridge.
function getYTCaptionTracks(): Promise<Array<{ baseUrl: string; languageCode: string }> | null> {
  return new Promise((resolve) => {
    const nonce = `subly_${Date.now()}`;
    const handler = (e: MessageEvent) => {
      if ((e.data as Record<string, unknown>)?.type === nonce) {
        window.removeEventListener('message', handler);
        resolve((e.data as Record<string, unknown>).tracks as Array<{ baseUrl: string; languageCode: string }> | null);
      }
    };
    window.addEventListener('message', handler);

    const s = document.createElement('script');
    s.textContent = `(function(){var r=null;try{var p=window.ytInitialPlayerResponse;r=(p&&p.captions&&p.captions.playerCaptionsTracklistRenderer&&p.captions.playerCaptionsTracklistRenderer.captionTracks)||null;}catch(e){}window.postMessage({type:${JSON.stringify(nonce)},tracks:r},'*');})();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();

    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 2000);
  });
}

async function fetchCaptionEntries(baseUrl: string): Promise<CaptionEntry[]> {
  try {
    const res = await proxyFetch(baseUrl + '&fmt=json3', {});
    if (!res.ok) return [];
    const data = res.data as { events?: Record<string, unknown>[] };
    return (data.events ?? [])
      .filter((e) => Array.isArray(e.segs))
      .map((e) => ({
        tStartMs: (e.tStartMs as number) ?? 0,
        dDurationMs: (e.dDurationMs as number) ?? 3000,
        text: (e.segs as Array<{ utf8?: string }>)
          .map((s) => s.utf8 ?? '')
          .join('')
          .replace(/\n/g, ' ')
          .trim(),
      }))
      .filter((e) => e.text.length > 0);
  } catch {
    return [];
  }
}

async function preloadUpcomingSubtitles() {
  if (captionEntries.length === 0) return;
  const video = document.querySelector<HTMLVideoElement>('video');
  if (!video) return;

  const currentMs = video.currentTime * 1000;
  const upcoming = captionEntries
    .filter((e) => e.tStartMs > currentMs && e.tStartMs <= currentMs + 30000)
    .slice(0, 6);

  const token = await getToken();
  for (const entry of upcoming) {
    const text = entry.text.trim();
    if (!text || subtitleCache.has(text)) continue;
    const lang = detectLang(text);
    proxyFetch(`${API_URL}/api/subtitles/enhance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text, source_language: lang, target_language: 'en' }),
    })
      .then((res) => {
        if (res.ok) subtitleCache.set(text, res.data as EnhancedSubtitle);
      })
      .catch(() => {});
  }
}

async function initPreloading(sourceLang: string) {
  // Short delay so ytInitialPlayerResponse has time to settle after navigation
  await new Promise((r) => setTimeout(r, 300));

  let tracks = await getYTCaptionTracks();
  if (!tracks?.length) {
    // ytInitialPlayerResponse may still be stale — retry once after 3s
    await new Promise((r) => setTimeout(r, 3000));
    tracks = await getYTCaptionTracks();
    if (!tracks?.length) return;
  }

  // Prefer a track matching the source language; fall back to first available
  const track =
    tracks.find((t) => t.languageCode && t.languageCode.startsWith(sourceLang)) ?? tracks[0];
  if (!track?.baseUrl) return;

  captionEntries = await fetchCaptionEntries(track.baseUrl);
  if (captionEntries.length === 0) return;

  console.log(`[Subly] Preloaded ${captionEntries.length} caption entries for ${track.languageCode}`);

  // Preload immediately then every 3 seconds (was 5s)
  preloadUpcomingSubtitles().catch(() => {});
  if (preloadTimer !== null) clearInterval(preloadTimer);
  preloadTimer = window.setInterval(() => preloadUpcomingSubtitles().catch(() => {}), 3000);
}

function stopPreloading() {
  if (preloadTimer !== null) {
    clearInterval(preloadTimer);
    preloadTimer = null;
  }
  captionEntries = [];
  preloadingInitialized = false;
}

// ── Caption observer ──────────────────────────────────────────────────────────

function getCaptionText(): string {
  return Array.from(document.querySelectorAll('.ytp-caption-segment'))
    .map((s) => s.textContent ?? '')
    .join('')
    .trim();
}

function startCaptionObserver() {
  if (captionObserver) return;

  const container = document.querySelector('.ytp-caption-window-container');
  if (!container) return;

  captionObserver = new MutationObserver(() => {
    const text = getCaptionText();
    if (!text) {
      // Keep last subtitle visible during silence — just reset so next line is processed
      lastText = '';
      return;
    }
    if (text === lastText) return;
    lastText = text;
    processSubtitleText(text);
  });

  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

function stopCaptionObserver() {
  captionObserver?.disconnect();
  captionObserver = null;
  lastText = '';
  processingLock = false;
  pendingText = null;
}

function waitForElement(selector: string, callback: (el: Element) => void, timeout = 15000) {
  const el = document.querySelector(selector);
  if (el) { callback(el); return; }

  const start = Date.now();
  const obs = new MutationObserver(() => {
    const found = document.querySelector(selector);
    if (found || Date.now() - start > timeout) {
      obs.disconnect();
      if (found) callback(found);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// ── Enable / Disable ──────────────────────────────────────────────────────────

function enableSubly() {
  if (!overlay) overlay = createOverlay();
  if (!transcriptEl) transcriptEl = createTranscript();
  transcriptEl.classList.remove('subly-transcript--hidden');
  startPositionTracking();
  waitForElement('.ytp-caption-window-container', () => startCaptionObserver());
}

function disableSubly() {
  stopCaptionObserver();
  stopPreloading();
  stopPositionTracking();
  if (overlay) overlay.style.display = 'none';
  if (transcriptEl) transcriptEl.classList.add('subly-transcript--hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get('subly_enabled', (result) => {
  enabled = !!result.subly_enabled;
  if (enabled) enableSubly();
});

chrome.storage.onChanged.addListener((changes) => {
  if ('subly_enabled' in changes) {
    enabled = !!changes.subly_enabled.newValue;
    if (enabled) enableSubly();
    else disableSubly();
  }
});

chrome.runtime.onMessage.addListener((message: { type: string; enabled?: boolean }) => {
  if (message.type === 'TOGGLE') {
    enabled = !!message.enabled;
    if (enabled) enableSubly();
    else disableSubly();
  }
});

document.addEventListener('yt-navigate-finish', () => {
  lastText = '';
  subtitleCache.clear();
  subtitleHistory.length = 0;
  stopCaptionObserver();
  stopPreloading();
  stopPositionTracking();
  // Clear transcript for the new video
  if (transcriptBodyEl) transcriptBodyEl.innerHTML = '';
  autoScrollTranscript = true;
  if (enabled) {
    setTimeout(() => {
      startPositionTracking();
      waitForElement('.ytp-caption-window-container', () => startCaptionObserver());
    }, 1000);
  }
});
