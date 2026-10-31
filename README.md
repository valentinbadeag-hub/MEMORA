# MEMORA — phone-first MVP

MEMORA is an installable web app for iPhone. It records audio while the app is open, optionally displays browser speech recognition, stores audio/transcripts/notes in local browser storage, creates an executive-level AI summary when a summary service is configured, and lets you search saved text.

## Install on iPhone

An iPhone needs an HTTPS website for microphone access and service-worker installation. To publish with GitHub Pages at no cost:

1. Create a GitHub repository and upload the files in this folder to its root.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select your main branch and the root folder, then save.
4. Wait for GitHub Pages to show the published HTTPS link.
5. Open that link in Safari on your iPhone.
6. Tap **Share → Add to Home Screen**. Turn on **Open as Web App** if shown, then tap **Add**.
7. Launch MEMORA from the new Home Screen icon and allow microphone access.

The AI provider key belongs on the summary service, never in the public app. Audio remains in browser storage; the transcript is sent to the configured AI service to generate the summary.

## Run checks on Windows

Install Node.js, open PowerShell in this folder, and run node --test --test-isolation=none. The test suite uses only Node.js built-ins.

## Use

- Tap **Start recording** and keep MEMORA in the foreground.
- Choose Romanian, English, or Hungarian before recording. Browser speech recognition is optional and may be unavailable.
- Choose Romanian, English, or Hungarian as the summary language in Quick notes. The summary is generated in that language even when the conversation is in another language. Changing it translates the latest displayed summary; use **Translate summary to …** in the library for other saved conversations. Translations are cached locally, and you can search them.
- Use **Quick notes** to save a decision, participant, or follow-up. During recording, a saved note is also attached to that recording.
- After Finish, MEMORA saves the transcript and audio locally, then requests a structured executive summary. The summary appears in Quick notes and is searchable with the transcript.
- The summary format includes an executive summary, key discussion points, decisions, action items (owner, when, how, where, why), and open questions. Missing details are labeled **Not specified**.
- To enable AI summaries, deploy `worker.js` as a Cloudflare Worker with `OPENAI_API_KEY` and `MEMORA_API_TOKEN` secrets. Set the Worker route to `/api/summarize`, then enter its full URL and the same access token in **Quick notes → AI summary service setup**. Create a long random token and use it for `MEMORA_API_TOKEN`; do not commit provider keys or tokens to this repository.
- With the current Worker configuration, the service uses OpenAI `gpt-4o-mini`. OpenAI API billing is separate from ChatGPT subscriptions.
- Search the library by words or phrases. Results include transcript text and notes.
- Use **Export audio** or **Export .txt** to keep a copy outside browser storage.

## Current limits

- Recording works only while this app stays open. Keep the iPhone awake; iOS may suspend a web app in the background.
- Live speech recognition depends on Safari support and permissions. If unavailable, MEMORA still saves audio.
- Speech recognition may be unavailable in the browser. In that case the audio is saved, but there is no transcript to summarize.
- AI summaries require the separately deployed Worker and a configured API key. Until enabled, transcripts are still saved locally and the Quick notes area shows the setup status.
- Notes, recordings, and transcripts are stored in this browser on this device. Clearing Safari website data can delete them. Export important recordings.
- Audio recognition may be handled by the browser's speech service. Local recording storage does not imply that browser speech recognition is processed locally.
- This is not a Huawei watch app. Watch installation and watch-to-iPhone audio transfer need a separate compatibility milestone.

### Deploy the summary service

1. Install the Cloudflare Wrangler CLI and log in to your Cloudflare account.
2. From this folder, deploy `worker.js` as a Worker named `memora-summary`.
3. Add secrets with `npx wrangler secret put OPENAI_API_KEY` and `npx wrangler secret put MEMORA_API_TOKEN`.
4. Set up a route or custom domain that serves the Worker at `/api/summarize` (the app accepts the full URL).
5. In MEMORA's AI summary service setup, enter that URL and the exact `MEMORA_API_TOKEN` value.

Record only when people are aware and you have the necessary permission.
