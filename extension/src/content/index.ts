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

// ── State ─────────────────────────────────────────────────────────────────────

let enabled = false;
let overlay: HTMLDivElement | null = null;
let captionObserver: MutationObserver | null = null;
let lastText = '';
let processingLock = false;
let currentSubtitle: EnhancedSubtitle | null = null;

const subtitleCache = new Map<string, EnhancedSubtitle>();

// Drag state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let overlayX = 0;
let overlayY = 0;

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
  span.addEventListener('mouseleave', hideWordTooltip);
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

  translationEl.textContent = sub.translation || '';
  translationEl.style.opacity = '1';

  translitEl.textContent =
    sub.transliteration && sub.transliteration !== sub.original
      ? sub.transliteration
      : '';

  wordsEl.innerHTML = '';
  const tokens = sub.wordBreakdown.filter((wb) => wb.word.trim());

  if (tokens.length > 0) {
    tokens.forEach((wb, i) => {
      wordsEl.appendChild(buildWordSpan(wb.word, i, wb, sub));
    });
  } else {
    // No tokenisation from backend — use client-side split
    clientTokenize(sub.original, sub.sourceLanguage).forEach((token, i) => {
      wordsEl.appendChild(buildWordSpan(token, i, null, sub));
    });
  }
}

function showLoading(text: string, lang: string) {
  if (!overlay) return;
  const { translationEl, wordsEl, translitEl } = getOverlayEls();

  translationEl.textContent = '…';
  translationEl.style.opacity = '0.35';
  translitEl.textContent = '';
  wordsEl.innerHTML = '';

  // Render client-side tokens immediately — they're clickable right away
  clientTokenize(text, lang).forEach((token, i) => {
    const span = buildWordSpan(token, i, null, null);
    span.style.opacity = '0.6';
    wordsEl.appendChild(span);
  });
}

function showFallback(text: string, lang: string) {
  if (!overlay) return;
  const { translationEl, wordsEl, translitEl } = getOverlayEls();

  translationEl.textContent = '';
  translitEl.textContent = '';
  wordsEl.innerHTML = '';

  clientTokenize(text, lang).forEach((token, i) => {
    wordsEl.appendChild(buildWordSpan(token, i, null, null));
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showWordTooltip(e: MouseEvent, wb: WordBreakdown) {
  if (!overlay) return;
  const tooltip = overlay.querySelector('#subly-tooltip') as HTMLElement;

  const lines: string[] = [];
  if (wb.word) lines.push(`<span class="subly-tip-original">${wb.word}</span>`);
  if (wb.transliteration && wb.transliteration !== wb.word)
    lines.push(`<span class="subly-tip-romaji">${wb.transliteration}</span>`);
  if (wb.translation)
    lines.push(`<span class="subly-tip-translation">${wb.translation}</span>`);

  if (!lines.length) return;

  tooltip.innerHTML = lines.join('');
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

// ── Word save ─────────────────────────────────────────────────────────────────

async function handleWordClick(wb: WordBreakdown, sub: EnhancedSubtitle) {
  const token = await getToken();
  if (!token) {
    showToast('Sign in to save words', 'info');
    return;
  }

  try {
    const res = await proxyFetch(`${API_URL}/api/dictionary`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        word: wb.word,
        transliteration: wb.transliteration || wb.word,
        translation: wb.translation || sub.translation,
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
  if (!overlay || processingLock) return;
  processingLock = true;

  const trimmed = text.trim();
  const lang = detectLang(trimmed);

  overlay.style.display = 'flex';
  showLoading(trimmed, lang); // words are clickable immediately

  try {
    if (subtitleCache.has(trimmed)) {
      const cached = subtitleCache.get(trimmed)!;
      currentSubtitle = cached;
      renderSubtitle(cached);
      return;
    }

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
  }
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
      if (overlay) overlay.style.display = 'none';
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
  waitForElement('.ytp-caption-window-container', () => startCaptionObserver());
}

function disableSubly() {
  stopCaptionObserver();
  if (overlay) overlay.style.display = 'none';
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
  stopCaptionObserver();
  if (enabled) {
    setTimeout(() => waitForElement('.ytp-caption-window-container', () => startCaptionObserver()), 1000);
  }
});
