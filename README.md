# MEMORA — phone-first MVP

MEMORA is an installable web app for iPhone. It records audio while the app is open, optionally displays browser speech recognition, stores audio/transcripts/notes in local browser storage, and lets you search saved text.

## Install on iPhone

An iPhone needs an HTTPS website for microphone access and service-worker installation. To publish with GitHub Pages at no cost:

1. Create a GitHub repository and upload the files in this folder to its root.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select your main branch and the root folder, then save.
4. Wait for GitHub Pages to show the published HTTPS link.
5. Open that link in Safari on your iPhone.
6. Tap **Share → Add to Home Screen**. Turn on **Open as Web App** if shown, then tap **Add**.
7. Launch MEMORA from the new Home Screen icon and allow microphone access.

The files do not include any server-side application or API key. The recordings remain in browser storage on the iPhone.

## Run checks on Windows

Install Node.js, open PowerShell in this folder, and run node --test --test-isolation=none. The test suite uses only Node.js built-ins.

## Use

- Tap **Start recording** and keep MEMORA in the foreground.
- Choose Romanian or English before recording. Browser speech recognition is optional and may be unavailable.
- Use **Quick notes** to save a decision, participant, or follow-up. During recording, a saved note is also attached to that recording.
- Search the library by words or phrases. Results include transcript text and notes.
- Use **Export audio** or **Export .txt** to keep a copy outside browser storage.

## Current limits

- Recording works only while this app stays open. Keep the iPhone awake; iOS may suspend a web app in the background.
- Live speech recognition depends on Safari support and permissions. If unavailable, MEMORA still saves audio.
- This MVP does not yet include AI transcription, AI-generated summaries, or automatic decision/action extraction.
- Notes, recordings, and transcripts are stored in this browser on this device. Clearing Safari website data can delete them. Export important recordings.
- Audio recognition may be handled by the browser's speech service. Local recording storage does not imply that browser speech recognition is processed locally.
- This is not a Huawei watch app. Watch installation and watch-to-iPhone audio transfer need a separate compatibility milestone.

Record only when people are aware and you have the necessary permission.
