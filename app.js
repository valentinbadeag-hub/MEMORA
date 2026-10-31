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
let selectedSessionId = null;

const DB_NAME = 'memora-local';
const STORE = 'sessions';
const DEFAULT_SUMMARY_ENDPOINT = 'https://memora-summary.valentin-badeag.workers.dev/api/summarize';

function showSummarySetup(message) {
  $('summarySettings').open = true;
  $('summarySettingsStatus').textContent = message;
}

function formatSummaryForNotes(summary, language) {
  const labels = {
    ro: { exec: 'SUMAR EXECUTIV', context: 'CONTEXT', what: 'Ce', when: 'Când', how: 'Cum', where: 'Unde', why: 'De ce', points: 'PUNCTE DISCUTATE', decisions: 'DECIZII', actions: 'ACȚIUNI', open: 'ÎNTREBĂRI DESCHISE / RISCURI', none: 'Niciuna identificată', unspecified: 'Nespecificat', owner: 'Responsabil' },
    en: { exec: 'EXECUTIVE SUMMARY', context: 'CONTEXT', what: 'What', when: 'When', how: 'How', where: 'Where', why: 'Why', points: 'KEY DISCUSSION', decisions: 'DECISIONS', actions: 'ACTIONS', open: 'OPEN QUESTIONS / RISKS', none: 'None identified', unspecified: 'Not specified', owner: 'Owner' },
    hu: { exec: 'VEZETŐI ÖSSZEFOGLALÓ', context: 'KONTEXTUS', what: 'Mi', when: 'Mikor', how: 'Hogyan', where: 'Hol', why: 'Miért', points: 'FŐBB TÉMÁK', decisions: 'DÖNTÉSEK', actions: 'TEENDŐK', open: 'NYITOTT KÉRDÉSEK / KOCKÁZATOK', none: 'Nem merült fel', unspecified: 'Nincs megadva', owner: 'Felelős' }
  }[language] || null;
  const text = labels || { exec: 'EXECUTIVE SUMMARY', context: 'CONTEXT', what: 'What', when: 'When', how: 'How', where: 'Where', why: 'Why', points: 'KEY DISCUSSION', decisions: 'DECISIONS', actions: 'ACTIONS', open: 'OPEN QUESTIONS / RISKS', none: 'None identified', unspecified: 'Not specified', owner: 'Owner' };
  const lines = [text.exec, summary.executiveSummary || text.unspecified + '.'];
  if (summary.context) {
    lines.push('', text.context);
    for (const key of ['what', 'when', 'how', 'where', 'why']) {
      lines.push(text[key] + ': ' + (summary.context[key] || text.unspecified));
    }
  }
  const addList = (heading, items, format) => {
    lines.push('', heading);
    if (!items || !items.length) lines.push('• ' + text.none);
    else items.forEach(item => lines.push('• ' + format(item)));
  };
  addList(text.points, summary.keyPoints, item => item);
  addList(text.decisions, summary.decisions, item => item);
  addList(text.actions, summary.actions, item => {
    const parts = [item.action || text.unspecified, text.owner + ': ' + (item.owner || text.unspecified), text.when + ': ' + (item.when || text.unspecified), text.how + ': ' + (item.how || text.unspecified), text.where + ': ' + (item.where || text.unspecified), text.why + ': ' + (item.why || text.unspecified)];
    return parts.join(' | ');
  });
  addList(text.open, summary.openQuestions, item => item);
  return lines.join('\n');
}

function speechLanguageName(language) {
  if (language === 'ro-RO') return 'Romanian';
  if (language === 'hu-HU') return 'Hungarian';
  return 'English';
}

function summaryLanguageName(language) {
  return ({ ro: 'Romanian', en: 'English', hu: 'Hungarian' })[language] || 'Romanian';
}

async function createSummary(transcript, sourceLanguage, targetLanguage) {
  const endpoint = localStorage.getItem('memora-summary-endpoint') || DEFAULT_SUMMARY_ENDPOINT;
  const token = localStorage.getItem('memora-summary-token') || '';
  if (!endpoint || !token) {
    showSummarySetup('The MEMORA service URL is ready. Add the access token on this device to enable AI summaries and translations.');
    throw new Error('AI service is not configured.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ transcript, language: sourceLanguage, outputLanguage: targetLanguage }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI summary timed out after 45 seconds.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 404) showSummarySetup('The configured AI service URL was not found. Check that it ends with /api/summarize.');
    if (response.status === 401) showSummarySetup('The access token was rejected. Re-enter the MEMORA_API_TOKEN for this device.');
    throw new Error(data.error || (response.status === 404 ? 'AI summary service is not connected yet.' : `AI summary request failed (HTTP ${response.status}).`));
  }
  if (!data || !data.summary || typeof data.summary.executiveSummary !== 'string') {
    throw new Error('AI summary service returned an invalid response.');
  }
  return data.summary;
}

function setTranslatedTranscript(text) {
  const output = $('translatedTranscript');
  output.textContent = text || 'Translated text will appear here.';
  output.classList.toggle('empty', !text);
}

async function translateCurrentTranscript() {
  const button = $('translateTranscript');
  const targetLanguage = $('transcriptLanguage').value;
  const sessionId = $('sessionNotes').dataset.sessionId;
  let session = currentSession;
  if (!recorder && sessionId) session = (await allSessions()).find(item => item.id === sessionId) || null;
  const source = session && session.transcript ? session.transcript : transcriptText.trim();
  if (!source) {
    $('translationStatus').textContent = 'There is no transcript to translate yet.';
    return;
  }
  const sourceLanguageCode = session && session.speechLanguage === 'ro-RO' ? 'ro' : session && session.speechLanguage === 'hu-HU' ? 'hu' : session && session.speechLanguage ? 'en' : '';
  if (sourceLanguageCode && sourceLanguageCode === targetLanguage) {
    setTranslatedTranscript(source);
    $('translationStatus').textContent = 'The transcript is already in the selected language.';
    return;
  }
  if (session && session.translations && session.translations[targetLanguage]) {
    setTranslatedTranscript(session.translations[targetLanguage]);
    $('translationStatus').textContent = 'Showing the saved translation.';
    return;
  }

  button.disabled = true;
  $('translationStatus').textContent = 'Translating transcript…';
  setTranslatedTranscript('Translating…');
  try {
    const endpoint = localStorage.getItem('memora-summary-endpoint') || DEFAULT_SUMMARY_ENDPOINT;
    const token = localStorage.getItem('memora-summary-token') || '';
    if (!endpoint || !token) {
      showSummarySetup('The MEMORA service URL is ready. Add the access token on this device to enable AI summaries and translations.');
      throw new Error('AI service is not configured.');
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ operation: 'translate', transcript: source, outputLanguage: targetLanguage })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) showSummarySetup('The configured AI service URL was not found. Check that it ends with /api/summarize.');
      if (response.status === 401) showSummarySetup('The access token was rejected. Re-enter the MEMORA_API_TOKEN for this device.');
      throw new Error(result.error || 'Translation service request failed.');
    }
    if (!result.translation || typeof result.translation !== 'string') throw new Error('Translation service returned no translated text.');
    setTranslatedTranscript(result.translation);
    $('translationStatus').textContent = 'Translation ready. The original transcript is unchanged.';
    if (session) {
      session.translations = session.translations || {};
      session.translations[targetLanguage] = result.translation;
      if (!recorder) await saveSession(session);
    }
  } catch (error) {
    setTranslatedTranscript('');
    $('translationStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function summaryForLanguage(session, language) {
  if (session.summaryByLanguage && session.summaryByLanguage[language]) return session.summaryByLanguage[language];
  if (session.summary && session.summaryLanguage === language) return session.summary;
  return '';
}

async function translateSessionSummary(session, targetLanguage) {
  if (!session.transcript) throw new Error('This note has no transcript to translate.');
  session.summaryByLanguage = session.summaryByLanguage || {};
  const structuredSummary = await createSummary(session.transcript, session.speechLanguage || 'auto', targetLanguage);
  const formatted = formatSummaryForNotes(structuredSummary, targetLanguage);
  const previousSummary = session.summary || '';
  if (!session.sourceNotes) {
    session.sourceNotes = previousSummary && session.notes && session.notes.endsWith(previousSummary)
      ? session.notes.slice(0, -previousSummary.length).trim()
      : session.notes || '';
  }
  session.summaryByLanguage[targetLanguage] = formatted;
  session.summary = formatted;
  session.summaryLanguage = targetLanguage;
  session.notes = [session.sourceNotes || '', formatted].filter(Boolean).join('\n\n');
  await saveSession(session);
  const notes = $('sessionNotes');
  if (notes.dataset.sessionId === session.id) {
    const manual = session.sourceNotes || '';
    notes.value = [manual, formatted].filter(Boolean).join('\n\n');
    notes.dataset.generatedSummary = formatted;
  }
  return formatted;
}

function notesWithoutGeneratedSummary(text, summary) {
  if (!summary || !text || !text.endsWith(summary)) return text || '';
  return text.slice(0, -summary.length).trim();
}

async function selectSessionForQuickNotes(session) {
  selectedSessionId = session.id;
  const notes = $('sessionNotes');
  notes.dataset.sessionId = session.id;
  let transcriptNeedsTranslation = false;
  if (!recorder) {
    transcriptText = session.transcript || '';
    $('transcript').textContent = transcriptText || 'This saved item has no transcript.';
    $('transcript').classList.toggle('empty', !transcriptText);
    $('wordCount').textContent = String(transcriptText.trim() ? transcriptText.trim().split(/\s+/).length : 0);
    const speechLanguage = session.speechLanguage;
    if (speechLanguage && Array.from($('speechLanguage').options).some(option => option.value === speechLanguage)) {
      $('speechLanguage').value = speechLanguage;
    }
    const translation = (session.translations || {})[$('transcriptLanguage').value] || '';
    setTranslatedTranscript(translation);
    const targetLanguage = $('transcriptLanguage').value;
    const speechCode = session.speechLanguage === 'ro-RO' ? 'ro' : session.speechLanguage === 'hu-HU' ? 'hu' : session.speechLanguage ? 'en' : '';
    $('translationStatus').textContent = translation ? 'Showing the saved translation.' : speechCode === targetLanguage ? 'The transcript is already in the selected language.' : 'Preparing translation…';
    if (!translation && transcriptText && speechCode && speechCode === targetLanguage) setTranslatedTranscript(transcriptText);
    transcriptNeedsTranslation = Boolean(!translation && transcriptText && speechCode !== targetLanguage);
  }
  const language = $('notesLanguage').value;
  const sourceNotes = session.sourceNotes || (session.summary ? notesWithoutGeneratedSummary(session.notes, session.summary) : session.notes || '');
  let summary = summaryForLanguage(session, language);

  $('quickNotesStatus').textContent = 'Loading the selected note…';
  $('quickNotesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!summary && session.transcript) {
    $('quickNotesStatus').textContent = 'Preparing an executive summary from this transcript…';
    try {
      summary = await translateSessionSummary(session, language);
      $('quickNotesStatus').textContent = 'Summary generated and saved. You can edit these notes.';
      await renderSessions();
    } catch (error) {
      summary = '';
      $('quickNotesStatus').textContent = error.message + ' The transcript is shown below so you can still review it.';
    }
  }

  if (summary) {
    notes.value = [sourceNotes, summary].filter(Boolean).join('\n\n');
    notes.dataset.generatedSummary = summary;
    notes.dataset.sessionId = session.id;
    $('quickNotesStatus').textContent = 'Selected note loaded. Executive summary and details are shown below.';
  } else if (sourceNotes || session.transcript) {
    const transcriptBlock = session.transcript ? '\n\nTRANSCRIPT\n' + session.transcript : '';
    notes.value = [sourceNotes, transcriptBlock].filter(Boolean).join('\n\n').trim();
    notes.dataset.generatedSummary = '';
    notes.dataset.sessionId = session.id;
    if (!session.transcript) $('quickNotesStatus').textContent = 'Saved note loaded in Quick Notes.';
  } else {
    notes.value = 'Nu există încă un transcript sau un sumar pentru această înregistrare.';
    notes.dataset.generatedSummary = '';
    notes.dataset.sessionId = session.id;
    $('quickNotesStatus').textContent = 'This recording has no saved transcript or summary.';
  }
  renderSessions().catch(() => {});
  if (!recorder && transcriptNeedsTranslation) await translateCurrentTranscript();
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
  selectedSessionId = null;
  $('sessionNotes').dataset.sessionId = '';

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
      speechLanguage: $('speechLanguage').value,
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
      currentSession.sourceNotes = userNotes;
      currentSession.notes = userNotes;
      currentSession.mime = audio.type;
      try {
        await saveSession(currentSession);
      } catch (audioSaveError) {
        currentSession.blob = null;
        currentSession.audioSaveError = 'Audio could not be stored; transcript and notes are saved.';
        await saveSession(currentSession);
        $('recordHint').textContent = currentSession.audioSaveError;
      }
      selectedSessionId = currentSession.id;
      $('sessionNotes').dataset.sessionId = currentSession.id;
      $('searchSessions').value = '';
      if (transcriptText.trim()) {
        $('sessionNotes').value = [userNotes, 'SUMAR EXECUTIV\nSe generează sumarul AI. Până atunci, transcriptul complet este disponibil mai jos.', 'TRANSCRIPT\n' + transcriptText.trim()].filter(Boolean).join('\n\n');
        $('quickNotesStatus').textContent = 'Transcript salvat. Se generează sumarul executiv…';
        $('recordHint').textContent = 'Transcript saved. Preparing executive summary…';
      } else {
        $('sessionNotes').value = [userNotes, 'Nu există un transcript disponibil pentru sumarizare. Înregistrarea audio a fost salvată.'].filter(Boolean).join('\n\n');
        $('quickNotesStatus').textContent = 'Înregistrarea audio este salvată, dar browserul nu a furnizat un transcript.';
      }
      $('sessionNotes').dataset.generatedSummary = '';
      await renderSessions();
      if (transcriptText.trim()) {
        try {
          const targetLanguage = $('notesLanguage').value;
          const structuredSummary = await createSummary(transcriptText.trim(), currentSession.speechLanguage, targetLanguage);
          currentSession.summary = formatSummaryForNotes(structuredSummary, targetLanguage);
          currentSession.summaryLanguage = targetLanguage;
          currentSession.summaryByLanguage = { ...(currentSession.summaryByLanguage || {}), [targetLanguage]: currentSession.summary };
          $('sessionNotes').value = [userNotes, currentSession.summary].filter(Boolean).join('\n\n');
          $('sessionNotes').dataset.generatedSummary = currentSession.summary;
          currentSession.notes = $('sessionNotes').value.trim();
          $('quickNotesStatus').textContent = 'Executive summary and action details are ready in Quick Notes.';
        } catch (error) {
          currentSession.summaryError = error.message;
          $('sessionNotes').value = [userNotes, 'SUMAR EXECUTIV\nSumarul AI nu a putut fi generat. Transcriptul complet este inclus mai jos.', 'TRANSCRIPT\n' + transcriptText.trim()].filter(Boolean).join('\n\n');
          $('sessionNotes').dataset.generatedSummary = '';
          currentSession.notes = $('sessionNotes').value.trim();
          $('quickNotesStatus').textContent = 'Transcript salvat. ' + error.message;
          $('recordHint').textContent = error.message + ' Transcript and audio are saved locally.';
        }
      } else {
        $('sessionNotes').value = [userNotes, 'Nu există un transcript disponibil pentru sumarizare. Înregistrarea audio a fost salvată.'].filter(Boolean).join('\n\n');
        $('sessionNotes').dataset.generatedSummary = '';
        $('quickNotesStatus').textContent = 'Înregistrarea audio este salvată, dar browserul nu a furnizat un transcript.';
        $('recordHint').textContent = 'Audio saved. No transcript was available to summarize.';
      }
      await saveSession(currentSession);
      await renderSessions();
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
    const sessionId = $('sessionNotes').dataset.sessionId;
    if (sessionId && !recorder) {
      const selected = (await allSessions()).find(session => session.id === sessionId);
      if (selected) {
        const summary = $('sessionNotes').dataset.generatedSummary || '';
        selected.sourceNotes = notesWithoutGeneratedSummary(notes, summary);
        selected.notes = notes;
        await saveSession(selected);
        $('quickNotesStatus').textContent = 'Changes saved to the selected note.';
        await renderSessions();
        return;
      }
    }
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
  const latestWithSummary = list.find(session => session.transcript && (session.summary || Object.keys(session.summaryByLanguage || {}).length));
  if (!$('sessionNotes').value.trim() && latestWithSummary && !recorder) {
    const language = $('notesLanguage').value;
    const latestSummary = summaryForLanguage(latestWithSummary, language) || latestWithSummary.summary;
    if (latestSummary) {
      $('sessionNotes').value = [latestWithSummary.sourceNotes || '', latestSummary].filter(Boolean).join('\n\n');
      $('sessionNotes').dataset.generatedSummary = latestSummary;
      $('sessionNotes').dataset.sessionId = latestWithSummary.id;
    }
  }
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
    item.className = 'session' + (session.id === selectedSessionId ? ' selected' : '');
    const content = document.createElement('div');
    content.className = 'session-content';
    const title = document.createElement('button');
    title.className = 'session-title session-select';
    title.type = 'button';
    title.textContent = new Date(session.created).toLocaleString();
    title.setAttribute('aria-label', 'Open this saved recording or note in Quick notes');
    title.onclick = () => selectSessionForQuickNotes(session);
    const transcriptWords = session.transcript && session.transcript.trim()
      ? session.transcript.trim().split(/\s+/).length
      : 0;
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = formatDuration(session.duration || 0) + ' · ' +
      (transcriptWords ? transcriptWords + ' transcript words' : session.blob ? 'Audio recording' : 'Written note');
    content.append(title, meta);

    const activeSummary = summaryForLanguage(session, $('notesLanguage').value) || session.summary || '';
    const excerpt = MemoraSearch.excerptFor(session.transcript || '', query) || MemoraSearch.excerptFor(activeSummary, query) || MemoraSearch.excerptFor(session.notes || '', query);
    if (excerpt) {
      const preview = document.createElement('p');
      preview.className = 'match-preview';
      preview.textContent = excerpt;
      content.append(preview);
    }
    addTextDetails(content, 'View transcript', session.transcript || '');
    addTextDetails(content, 'Executive summary (' + summaryLanguageName(session.summaryLanguage || 'en') + ')', activeSummary);
    addTextDetails(content, 'View notes', session.notes || '');

    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const openNotes = document.createElement('button');
    openNotes.textContent = 'Open in Quick Notes';
    openNotes.onclick = () => selectSessionForQuickNotes(session);
    actions.append(openNotes);
    if (session.transcript && !summaryForLanguage(session, $('notesLanguage').value)) {
      const translate = document.createElement('button');
      translate.textContent = 'Translate summary to ' + summaryLanguageName($('notesLanguage').value);
      translate.onclick = async () => {
        translate.disabled = true;
        translate.textContent = 'Translating…';
        try {
          await translateSessionSummary(session, $('notesLanguage').value);
          await renderSessions();
        } catch (error) {
          $('recordHint').textContent = error.message;
          translate.disabled = false;
          translate.textContent = 'Retry translation';
        }
      };
      actions.append(translate);
    }
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
    const translatedSummaries = Object.values(session.summaryByLanguage || {});
    const savedText = [...translatedSummaries, session.summary, session.transcript, session.notes].filter((text, index, values) => text && text.trim() && values.indexOf(text) === index).join('\n\n');
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
$('translateTranscript').addEventListener('click', translateCurrentTranscript);
$('transcriptLanguage').value = localStorage.getItem('memora-transcript-language') || 'ro';
$('transcriptLanguage').addEventListener('change', () => {
  localStorage.setItem('memora-transcript-language', $('transcriptLanguage').value);
  if (transcriptText.trim()) translateCurrentTranscript();
  else $('translationStatus').textContent = 'There is no transcript to translate yet.';
});
$('saveNoteBtn').addEventListener('click', saveQuickNote);
$('searchSessions').addEventListener('input', () => renderSessions().catch(() => {}));
$('notesLanguage').value = localStorage.getItem('memora-notes-language') || 'ro';
$('notesLanguage').addEventListener('change', async () => {
  const language = $('notesLanguage').value;
  localStorage.setItem('memora-notes-language', language);
  const noteInput = $('sessionNotes');
  const sessionId = noteInput.dataset.sessionId;
  if (sessionId) {
    try {
      const saved = (await allSessions()).find(session => session.id === sessionId);
      if (saved && !summaryForLanguage(saved, language) && saved.transcript) {
        $('recordHint').textContent = 'Translating the summary to ' + summaryLanguageName(language) + '…';
        await translateSessionSummary(saved, language);
        $('recordHint').textContent = 'Notes translated and saved on this device.';
      } else if (saved) {
        const text = summaryForLanguage(saved, language);
        if (text) {
          noteInput.value = [saved.sourceNotes || '', text].filter(Boolean).join('\n\n');
          noteInput.dataset.generatedSummary = text;
        }
      }
    } catch (error) {
      $('recordHint').textContent = error.message;
    }
  }
  renderSessions().catch(() => {});
});
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
  const endpoint = $('summaryEndpoint').value.trim() || DEFAULT_SUMMARY_ENDPOINT;
  const token = $('summaryToken').value.trim();
  localStorage.setItem('memora-summary-endpoint', endpoint);
  if (token) localStorage.setItem('memora-summary-token', token);
  else localStorage.removeItem('memora-summary-token');
  if (!token) {
    $('summarySettingsStatus').textContent = 'Service URL saved. Add the access token to enable summaries on this device.';
    return;
  }
  $('summarySettingsStatus').textContent = 'Checking the service and token…';
  const healthUrl = endpoint.replace(/\/api\/summarize\/?$/, '/api/health');
  fetch(healthUrl, { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' })
    .then(async response => {
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Token rejected. Check that you entered the current MEMORA_API_TOKEN.');
      if (!response.ok) throw new Error(result.error || `Service check failed (HTTP ${response.status}).`);
      $('summarySettingsStatus').textContent = 'Connected. The AI service and token are ready on this device.';
    })
    .catch(error => {
      $('summarySettingsStatus').textContent = error.message.includes('Failed to fetch')
        ? 'Could not reach the service. Check the URL and internet connection.'
        : error.message;
    });
});
$('summaryEndpoint').value = localStorage.getItem('memora-summary-endpoint') || DEFAULT_SUMMARY_ENDPOINT;
$('summaryToken').value = localStorage.getItem('memora-summary-token') || '';
if (!$('summaryToken').value) {
  $('summarySettings').open = true;
  $('summarySettingsStatus').textContent = 'AI is not connected on this device yet. Paste your MEMORA_API_TOKEN below and save to turn on summaries and translations.';
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('memora-sw-reloading') === '1') return;
    sessionStorage.setItem('memora-sw-reloading', '1');
    location.reload();
  });
  if (sessionStorage.getItem('memora-sw-reloading') === '1') sessionStorage.removeItem('memora-sw-reloading');
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(() => {});
}
renderSessions().catch(() => {
  $('sessions').innerHTML = '<div class="empty">Storage is unavailable in this browser.</div>';
});
