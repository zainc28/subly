import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Chrome storage adapter — service workers don't have localStorage
const chromeStorageAdapter = {
  getItem: (key: string): Promise<string | null> =>
    new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve(r[key] ?? null))),
  setItem: (key: string, value: string): Promise<void> =>
    new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve)),
  removeItem: (key: string): Promise<void> =>
    new Promise((resolve) => chrome.storage.local.remove(key, resolve)),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ── Auth state sync ────────────────────────────────────────────────────────────

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    chrome.storage.local.set({ subly_token: session.access_token });
  } else {
    chrome.storage.local.remove('subly_token');
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, _sender, sendResponse) => {

    // ── Auth: get current session token ───────────────────────────────────────
    if (message.type === 'GET_TOKEN') {
      supabase.auth.getSession().then(({ data: { session } }) => {
        sendResponse({ token: session?.access_token ?? null });
      });
      return true;
    }

    // ── Auth: sign out ────────────────────────────────────────────────────────
    if (message.type === 'SIGN_OUT') {
      supabase.auth.signOut().then(() => {
        chrome.storage.local.remove('subly_token');
        sendResponse({ ok: true });
      });
      return true;
    }

    // ── API proxy ─────────────────────────────────────────────────────────────
    // Background service workers are extension contexts — they are NOT subject to
    // Chrome's Private Network Access (PNA) restriction that blocks HTTPS pages
    // (YouTube) from fetching http://localhost. All content-script API calls are
    // routed here so they always succeed, regardless of PNA policy.
    if (message.type === 'FETCH_API') {
      const url = message.url as string;
      const method = (message.method as string | undefined) ?? 'GET';
      const headers = (message.headers as Record<string, string> | undefined) ?? {};
      const body = message.body as string | undefined;

      fetch(url, { method, headers, body })
        .then(async (res) => {
          // Always try to parse JSON body — caller decides what to do with status
          const data = await res.json().catch(() => null);
          sendResponse({ ok: res.ok, status: res.status, data });
        })
        .catch((err: Error) => {
          sendResponse({ ok: false, status: 0, data: null, error: err.message });
        });

      return true; // keep message channel open for async sendResponse
    }

    return false;
  },
);

// Keep service worker alive while YouTube tab is open
chrome.tabs.onUpdated.addListener(() => {
  // no-op — registering any listener prevents the SW from being killed prematurely
});
