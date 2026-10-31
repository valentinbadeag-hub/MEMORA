const $ = id => document.getElementById(id);

let recorder = null;
let stream = null;
let chunks = [];
let startedAt = 0;
let elapsedBefore = 0;
let timerHandle = null;
let recognition = null;
let speechWanted = false;
let transcriptText = '';
let currentSession = null;

const DB_NAME = 'memora-local';
const STORE = 'sessions';
const DEFAULT_SUMMARY_ENDPOINT = '';

function formatSummaryForNotes(summary) {
  const lines = ['EXECUTIVE SUMMARY', summary.executiveSummary || 'Not specified.'];
  if (summary.context) {
    lines.push('', 'CONTEXT');
    for (const [label, key] of [['What', 'what'], ['When', 'when'], ['How', 'how'], ['Where', 'where'], ['Why', 'why']]) {
      lines.push(label + ': ' + (summary.context[key] || 'Not specified'));
    }
  }
  const addList = (heading, items, format) => {
    lines.push('', heading);
    if (!items || !items.length) lines.push('• None identified.');
    else items.forEach(item => lines.push('• ' + format(item)));
  };
  addList('KEY DISCUSSION', summary.keyPoints, item => item);
  addList('DECISIONS', summary.decisions, item => item);
  addList('ACTIONS', summary.actions, item => {
    const parts = [item.action || 'Action not specified', 'Owner: ' + (item.owner || 'Not specified'), 'When: ' + (item.when || 'Not specified'), 'How: ' + (item.how || 'Not specified'), 'Where: ' + (item.where || 'Not specified'), 'Why: ' + (item.why || 'Not specified')];
    return parts.join(' | ');
  });
  addList('OPEN QUESTIONS / RISKS', summary.openQuestions, item => item);
  return lines.join('\n');
}

async function createSummary(transcript) {
  const endpoint = localStorage.getItem('memora-summary-endpoint') || DEFAULT_SUMMARY_ENDPOINT;
  const token = localStorage.getItem('memora-summary-token') || '';
  if (!endpoint || !token) throw new Error('Configure the AI summary service below Quick notes.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ transcript, language: $('speechLanguage').value })
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'AI summary service is not connected yet.' : 'AI summary request failed.');
  const data = await response.json();
  if (!data || !data.summary || typeof data.summary.executiveSummary !== 'string') {
    throw new Error('AI summary service returned an invalid response.');
  }
  return data.summary;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSession(session) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(session);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

async function allSessions() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => {
      database.close();
      resolve(request.result.sort((a, b) => b.created - a.created));
    };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function deleteSession(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remaining = String(seconds % 60).padStart(2, '0');
  return hours + ':' + minutes + ':' + remaining;
}

function elapsed() {
  return elapsedBefore + (startedAt ? Date.now() - startedAt : 0);
}

function setStatus(isRecording, message) {
  const pill = $('statusPill');
  pill.className = 'pill ' + (isRecording ? 'recording' : 'idle');
  pill.innerHTML = isRecording ? '<i></i> Recording' : '<i></i> Ready';
  $('recordHint').textContent = message || (isRecording
    ? 'Microphone active — keep MEMORA open.'
    : 'Your microphone is off.');
  $('meterFill').style.width = isRecording ? '100%' : '0%';
}

function updateTimer() {
  $('timer').textContent = formatDuration(elapsed());
}

function startTimer() {
  startedAt = Date.now();
  clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 500);
}

function pauseTimer() {
  elapsedBefore = elapsed();
  startedAt = 0;
  clearInterval(timerHandle);
  updateTimer();
}

function updateTranscript(text) {
  transcriptText += text;
  $('transcript').textContent = transcriptText || 'Listening for speech…';
  $('transcript').classList.toggle('empty', !transcriptText);
  $('wordCount').textContent = String(transcriptText.trim()
    ? transcriptText.trim().split(/\s+/).length
    : 0);
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $('speechLabel').textContent = 'Unavailable in this browser';
    return;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = $('speechLanguage').value;
    speechWanted = true;

    recognition.onstart = () => {
      $('speechLabel').textContent = 'Listening';
    };
    recognition.onend = () => {
      if (speechWanted && recorder && recorder.state === 'recording') {
        try { recognition.start(); } catch (error) { $('speechLabel').textContent = 'Audio only'; }
      }
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        speechWanted = false;
      }
      $('speechLabel').textContent = 'Audio saved; transcription unavailable';
    };
    recognition.onresult = event => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          finalText += event.results[index][0].transcript.trim() + ' ';
        }
      }
      if (finalText) updateTranscript(finalText);
    };
    recognition.start();
  } catch (error) {
    $('speechLabel').textContent = 'Audio only';
  }
}

function stopSpeechRecognition() {
  speechWanted = false;
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch (error) {}
    recognition = null;
  }
  $('speechLabel').textContent = 'Standby';
}

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    alert('This browser cannot record audio here. Open the hosted app in Safari on your iPhone.');
    return;
  }

  const previousSummary = $('sessionNotes').dataset.generatedSummary || '';
  if (previousSummary) {
    const currentNotes = $('sessionNotes').value;
    $('sessionNotes').value = currentNotes.endsWith(previousSummary)
      ? currentNotes.slice(0, -previousSummary.length).trim()
      : currentNotes;
    $('sessionNotes').dataset.generatedSummary = '';
  }

  $('recordBtn').disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const supportedTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    let options = {};
    if (window.MediaRecorder.isTypeSupported) {
      const mimeType = supportedTypes.find(type => window.MediaRecorder.isTypeSupported(type));
      if (mimeType) options.mimeType = mimeType;
    }

    recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = event => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = finishSave;
    recorder.start(1000);

    currentSession = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2)),
      created: Date.now(),
      duration: 0,
      transcript: '',
      notes: '',
      blob: null,
      mime: recorder.mimeType || 'audio/mp4'
    };
    transcriptText = '';
    updateTranscript('');
    $('transcript').textContent = 'Listening for speech…';
    $('wordCount').textContent = '0';
    elapsedBefore = 0;
    startTimer();
    setStatus(true);
    $('pauseBtn').disabled = false;
    $('stopBtn').disabled = false;
    $('speechLanguage').disabled = true;
    startSpeechRecognition();
  } catch (error) {
    $('recordBtn').disabled = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    alert('Microphone access was not granted. Check Safari microphone permissions and try again.');
  }
}

function pauseRecording() {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    pauseTimer();
    stopSpeechRecognition();
    $('pauseBtn').textContent = 'Resume';
    setStatus(false, 'Paused. Microphone capture is paused.');
  } else if (recorder.state === 'paused') {
    recorder.resume();
    startTimer();
    $('pauseBtn').textContent = 'Pause';
    setStatus(true);
    startSpeechRecognition();
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  stopSpeechRecognition();
  pauseTimer();
  recorder.stop();
  $('recordBtn').disabled = true;
  $('pauseBtn').disabled = true;
  $('pauseBtn').textContent = 'Pause';
  $('stopBtn').disabled = true;
  $('speechLanguage').disabled = false;
  setStatus(false, 'Saving this session on your device…');
}

async function finishSave() {
  const activeRecorder = recorder;
  const audio = new Blob(chunks, { type: activeRecorder && activeRecorder.mimeType ? activeRecorder.mimeType : 'audio/mp4' });
  try {
    if (currentSession) {
      currentSession.blob = audio;
      currentSession.duration = elapsedBefore;
      currentSession.transcript = transcriptText;
      const userNotes = $('sessionNotes').value.trim();
      currentSession.notes = userNotes;
      currentSession.mime = audio.type;
      await saveSession(currentSession);
      if (transcriptText.trim()) {
        $('recordHint').textContent = 'Transcript saved. Preparing executive summary…';
        try {
          const structuredSummary = await createSummary(transcriptText.trim());
          currentSession.summary = formatSummaryForNotes(structuredSummary);
          $('sessionNotes').value = [userNotes, currentSession.summary].filter(Boolean).join('\n\n');
          $('sessionNotes').dataset.generatedSummary = currentSession.summary;
          currentSession.notes = $('sessionNotes').value.trim();
        } catch (error) {
          currentSession.summaryError = error.message;
          $('recordHint').textContent = error.message + ' Transcript and audio are saved locally.';
        }
      } else {
        $('recordHint').textContent = 'Audio saved. No transcript was available to summarize.';
      }
      await saveSession(currentSession);
      if (currentSession.summary) $('recordHint').textContent = 'Transcript and executive summary saved in Quick notes.';
    }
  } catch (error) {
    $('recordHint').textContent = 'Could not save this session. Check device storage.';
    alert('The session could not be saved in browser storage. Export anything important before leaving this page.');
  } finally {
    if (stream) stream.getTracks().forEach(track => track.stop());
    recorder = null;
    $('recordBtn').disabled = false;
    stream = null;
    chunks = [];
    currentSession = null;
    try { await renderSessions(); } catch (error) { $('sessionCount').textContent = '—'; }
  }
}

async function saveQuickNote() {
  const notes = $('sessionNotes').value.trim();
  if (!notes) {
    $('sessionNotes').focus();
    return;
  }
  try {
    await saveSession({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2)),
      created: Date.now(),
      duration: 0,
      transcript: '',
      notes: notes,
      blob: null,
      mime: ''
    });
    if (!recorder) $('sessionNotes').value = '';
    $('recordHint').textContent = recorder
      ? 'Note saved on this device and will also be attached to this recording.'
      : 'Note saved on this device.';
    await renderSessions();
  } catch (error) {
    alert('This note could not be saved. Check available device storage.');
  }
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function addTextDetails(parent, label, text) {
  if (!text || !text.trim()) return;
  const details = document.createElement('details');
  details.className = 'session-text';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const body = document.createElement('p');
  body.textContent = text;
  details.append(summary, body);
  parent.append(details);
}

async function renderSessions() {
  const list = await allSessions();
  const query = $('searchSessions').value.trim();
  const matches = list.filter(session => MemoraSearch.matchesSearch(session, query));
  $('sessionCount').textContent = String(list.length);
  const container = $('sessions');
  container.replaceChildren();

  if (!list.length) {
    container.innerHTML = '<div class="empty">No sessions yet. Record a conversation or save a quick note.</div>';
    return;
  }
  if (!matches.length) {
    container.innerHTML = '<div class="empty">No saved transcripts or notes match this search.</div>';
    return;
  }

  for (const session of matches) {
    const item = document.createElement('article');
    item.className = 'session';
    const content = document.createElement('div');
    content.className = 'session-content';
    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = new Date(session.created).toLocaleString();
    const transcriptWords = session.transcript && session.transcript.trim()
      ? session.transcript.trim().split(/\s+/).length
      : 0;
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = formatDuration(session.duration || 0) + ' · ' +
      (transcriptWords ? transcriptWords + ' transcript words' : session.blob ? 'Audio recording' : 'Written note');
    content.append(title, meta);

    const excerpt = MemoraSearch.excerptFor(session.transcript || '', query) || MemoraSearch.excerptFor(session.summary || '', query) || MemoraSearch.excerptFor(session.notes || '', query);
    if (excerpt) {
      const preview = document.createElement('p');
      preview.className = 'match-preview';
      preview.textContent = excerpt;
      content.append(preview);
    }
    addTextDetails(content, 'View transcript', session.transcript || '');
    addTextDetails(content, 'Executive summary', session.summary || '');
    addTextDetails(content, 'View notes', session.notes || '');

    const actions = document.createElement('div');
    actions.className = 'session-actions';
    if (session.blob) {
      const play = document.createElement('button');
      play.textContent = 'Play';
      play.onclick = () => {
        const oldPlayer = content.querySelector('audio');
        if (oldPlayer) oldPlayer.remove();
        const player = document.createElement('audio');
        player.controls = true;
        player.preload = 'metadata';
        player.src = URL.createObjectURL(session.blob);
        player.className = 'session-player';
        content.append(player);
        player.play().catch(() => {});
      };
      const exportButton = document.createElement('button');
      exportButton.textContent = 'Export audio';
      exportButton.onclick = () => downloadFile(session.blob, 'memora-' + session.id + '.audio');
      actions.append(play, exportButton);
    }
    const savedText = [session.summary, session.transcript, session.notes].filter(text => text && text.trim()).join('\n\n');
    if (savedText) {
      const exportText = document.createElement('button');
      exportText.textContent = 'Export text';
      exportText.onclick = () => downloadFile(
        new Blob([savedText], { type: 'text/plain;charset=utf-8' }),
        'memora-' + session.id + '.txt'
      );
      actions.append(exportText);
    }
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.className = 'delete';
    remove.onclick = async () => {
      if (confirm('Delete this session, its notes, and any transcript from this device?')) {
        await deleteSession(session.id);
        await renderSessions();
      }
    };
    actions.append(remove);
    item.append(content, actions);
    container.append(item);
  }
}

$('recordBtn').addEventListener('click', startRecording);
$('pauseBtn').addEventListener('click', pauseRecording);
$('stopBtn').addEventListener('click', stopRecording);
$('saveNoteBtn').addEventListener('click', saveQuickNote);
$('searchSessions').addEventListener('input', () => renderSessions().catch(() => {}));
$('copyTranscript').addEventListener('click', async () => {
  if (!transcriptText) {
    alert('There is no transcript to copy yet.');
    return;
  }
  try {
    await navigator.clipboard.writeText(transcriptText);
    $('copyTranscript').textContent = 'Copied';
    setTimeout(() => $('copyTranscript').textContent = 'Copy transcript', 1500);
  } catch (error) {
    alert('Clipboard access is unavailable. Select and copy the transcript text manually.');
  }
});
$('downloadTranscript').addEventListener('click', () => {
  if (!transcriptText) {
    alert('There is no transcript to export yet.');
    return;
  }
  downloadFile(new Blob([transcriptText], { type: 'text/plain;charset=utf-8' }), 'memora-transcript.txt');
});

$('saveSummarySettings').addEventListener('click', () => {
  const endpoint = $('summaryEndpoint').value.trim();
  const token = $('summaryToken').value.trim();
  if (endpoint) localStorage.setItem('memora-summary-endpoint', endpoint);
  else localStorage.removeItem('memora-summary-endpoint');
  if (token) localStorage.setItem('memora-summary-token', token);
  else localStorage.removeItem('memora-summary-token');
  $('summarySettingsStatus').textContent = endpoint && token ? 'AI summary service saved on this device.' : 'Add both the service URL and access token.';
});
$('summaryEndpoint').value = localStorage.getItem('memora-summary-endpoint') || '';
$('summaryToken').value = localStorage.getItem('memora-summary-token') || '';

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
renderSessions().catch(() => {
  $('sessions').innerHTML = '<div class="empty">Storage is unavailable in this browser.</div>';
});
