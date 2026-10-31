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
- In **Live transcript**, choose Romanian, English, or Hungarian as the translation language. Changing this selection translates the visible transcript automatically; the original remains unchanged. Translations are cached with saved recordings.
- Choose Romanian, English, or Hungarian as the summary language in Quick notes. The summary is generated in that language even when the conversation is in another language. Changing it translates the latest displayed summary; use **Translate summary to …** in the library for other saved conversations. Translations are cached locally, and you can search them.
- Use **Quick notes** to save a decision, participant, or follow-up. During recording, a saved note is also attached to that recording.
- After Finish, MEMORA saves the transcript and audio locally, then requests a structured executive summary. The summary appears in Quick notes and is searchable with the transcript.
- Select a saved item by tapping its date or **Open in Quick Notes** to load its summary, notes, and transcript into the Quick notes editor. If an AI summary cannot be created, MEMORA still loads the full transcript and reports why the summary is missing.
- The summary format includes an executive summary, key discussion points, decisions, action items (owner, when, how, where, why), and open questions. Missing details are labeled **Not specified**.
- AI summaries and translations run through Cloudflare Workers AI using the multilingual Qwen model; this does not require an OpenAI API key. The free Workers AI allocation is 10,000 Neurons per day; limits and billing are controlled by Cloudflare.
- Deploy `worker.js` using the included `wrangler.jsonc`, then add a `MEMORA_API_TOKEN` secret to the Worker. Enter the deployed Worker's URL ending in `/api/summarize` and the same token in **Quick notes → AI summary service setup**. Never commit the token to this repository.
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

1. In Cloudflare, open **Workers & Pages → Create application → Import a repository** and select `valentinbadeag-hub/MEMORA`.
2. Deploy with the included `wrangler.jsonc`; it configures the Workers AI binding as `AI`.
3. In the new Worker, open **Settings → Variables and Secrets → Add → Secret**. Name it `MEMORA_API_TOKEN` and enter a long random value you create.
4. Copy the Worker's `workers.dev` URL, adding `/api/summarize` at the end.
5. In MEMORA, open **Quick notes → AI summary service setup**. Enter that URL and the same token, then save the settings.
6. Redeploy the Worker whenever `worker.js` changes.

Record only when people are aware and you have the necessary permission.
