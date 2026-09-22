# Subly

A Chrome extension and web app that adds intelligent language-learning subtitles to YouTube videos. Three synchronized layers — original, romanization, translation — are color-coded token by token so you can follow along word by word.

## Demo

[![Subly Demo](https://res.cloudinary.com/doemtnqjh/video/upload/v1774567372/sublydemo_ahq32v.jpg)](https://res.cloudinary.com/doemtnqjh/video/upload/v1774567372/sublydemo_ahq32v.mp4)

---

## How It Works

**Subtitle Alignment**
YouTube's JSON3 caption format gives per-word timestamps. Subly parses these and pre-translates a 10-second lookahead window so subtitles are ready before the line plays. A multi-pass fuzzy alignment algorithm then color-codes tokens across all three layers despite differing word orders between languages, using exact matching first and prefix matching as a fallback.

**Translation Pipeline**
Subtitles hit an Express backend that checks a 2-tier cache before calling Azure Cognitive Services. A SHA-256 hash of the normalized text is the cache key, repeat subtitles are served from Supabase under 2ms. A context-aware Groq LLM provides nuanced word definitions rather than dictionary lookups.

**Auth & Billing**
JWT authentication via Supabase Auth. Usage is tracked per user per day against a tier limit. Stripe handles pro upgrades. The extension shares the same session as the web app, log in once, both work.

**Saved Vocabulary**
Any word can be saved to a personal dictionary with its translation, romanization, and the sentence it appeared in as context. The dictionary page lets you review and export saved words.

**Translation Pipeline**
Subtitles hit an Express backend that checks a 2-tier cache before calling Azure Cognitive Services. A SHA-256 hash of the normalized text is the cache key — repeat subtitles are served from Supabase under 2ms. For word definitions, a Groq LLM receives not just the clicked word but the surrounding transcript lines as context, so definitions reflect how the word is actually being used in the scene rather than returning a generic dictionary entry.

---

## Stack

TypeScript · Node.js/Express · React · Tailwind · Supabase · Azure · Groq · Stripe · Chrome Extensions API
