/* ══════════════════════════════════════════════════════════
   DR4G0N 5P34K — script.js
   Google Login → Supabase DB → Gemini AI
   ══════════════════════════════════════════════════════════ */

/* ─── SUPABASE CONFIG ─────────────────────────────────────── */
const SUPABASE_URL  = 'https://libioplsnfabkjpsgbwf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpYmlvcGxzbmZhYmtqcHNnYndmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzY0OTMsImV4cCI6MjA5NTM1MjQ5M30._L-Ue7OiSWiEz4nzCC07jjDzuQG67v86LAbRI2Dz8lk';

/* ─── SUPABASE DB HELPER ─────────────────────────────────── */
const db = {
  async query(table, method = 'GET', body = null, filter = '') {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${filter}`, {
        method,
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Content-Type':  'application/json',
          'Prefer':        method === 'POST' ? 'return=representation' : ''
        },
        body: body ? JSON.stringify(body) : null
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Supabase ${method} ${table} failed:`, res.status, errText);
        return null;
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : null;
    } catch (e) {
      console.warn('Supabase error:', e.message);
      return null;
    }
  },
  async getUser(uid) {
    const rows = await this.query('users', 'GET', null, `?uid=eq.${uid}&limit=1`);
    return rows?.[0] || null;
  },
  async upsertUser(uid, data) {
    return this.query('users', 'POST', { uid, ...data }, '?on_conflict=uid');
  },
  async updateUser(uid, data) {
    return this.query('users', 'PATCH', data, `?uid=eq.${uid}`);
  },
  async saveSession(uid, data) {
    return this.query('sessions', 'POST', { uid, ...data, created_at: new Date().toISOString() });
  },
  async getSessions(uid) {
    const rows = await this.query('sessions', 'GET', null,
      `?uid=eq.${uid}&order=created_at.desc&limit=20`);
    return rows || [];
  }
};

/* ─── GEMINI CONFIG ─────────────────────────────────────── */
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models/';

const SYSTEM_PROMPT = `You are Dragon, a friendly English teacher. You understand Tamil, Tanglish, and English perfectly.

YOUR REPLY MUST ALWAYS FOLLOW THIS EXACT FORMAT — no exceptions:

STEP 1 — UNDERSTAND what the student said. Think carefully. Get the real meaning.

STEP 2 — WRITE YOUR REPLY in this exact structure:

[One emoji] [One warm short sentence — max 10 words. Example: Great effort! or No problem, let me help!]

[If they made a mistake, write the correct sentence on its own line like this:]
✏️ Say it like this: "[The correct sentence here in double quotes]"

[Then one short teaching tip — max 1 sentence. Example: We say 'I am' not 'I are'.]

[Then one short question to keep talking — max 1 sentence.]
[If the question is hard, also write it in Tamil on the next line like: தமிழில்: [Tamil question here]]

SPECIAL RULES:

CORRECT SENTENCE FORMAT — always use this exact style:
✏️ Say it like this: "I am going to college."
The correct sentence must be on its own line. Use double quotes. Nothing else on that line.

WHEN USER SPEAKS TAMIL OR TANGLISH:
First line: 🌐 You said: "[English meaning]"
Then help them say it in English. Give the correct English sentence.
Then ask one short question.

WHEN USER SAYS they can't understand or asks to repeat:
Answer in simple English first. Then write the same question in Tamil on next line.
தமிழில்: [Tamil version of the question]

WHEN USER SPEAKS CORRECT ENGLISH:
Just reply naturally. One emoji. Two short sentences. One question.

EMOJI RULES:
Use ONE emoji per reply at the start. Pick based on feeling:
✅ for correct answers, ✏️ for corrections, 🌐 for Tamil/Tanglish, 😊 for casual chat, 💡 for tips, 🎯 for goals

GOLDEN RULES — NEVER BREAK:
1. Max 3 lines total in your reply. Never more. Short is better.
2. Correct sentence MUST be in double quotes on its own line with ✏️
3. Never write big paragraphs. Two sentences is a paragraph. Keep it that way.
4. Simple words only. Like talking to a child learning English for first time.
5. No bullet points. No hashtags. No bold stars. Just clean plain text with emojis.
6. The correct sentence is what Dragon speaks out loud — short and clear.
7. You are called Dragon when speaking. Never say DR4G0N 5P34K out loud.`;

/* ─── STATE ─────────────────────────────────────────────── */
let currentUser        = null;
let currentUserData    = null;
let GEMINI_KEY         = '';
let workingModel       = null;
let chatHistory        = [];
let isMuted            = false;
let isListening        = false;
let isSpeaking         = false;
let recognition        = null;
let currentUtterance   = null;
let selectedFeedbackType = 'grammar';
let volAnimFrame       = null;
let silenceTimer       = null;
let interimText        = '';
let continuousMode     = false;
let suppressRestart    = false;
const SILENCE_MS       = 2000;
let selectedVoice      = null;
let voiceRate          = 0.80;
let voicePitch         = 1.0;
let useCustomVoice     = false;
let customVoiceURL     = null;
let customAudio        = null;
let sessionStartTime   = null;
let sessionMessages    = 0;
let sessionCorrections = 0;

/* ══════════════════════════════════════════════════════════
   FIREBASE AUTH — LOGIN FLOW
   ══════════════════════════════════════════════════════════ */
function showStep(stepId) {
  document.querySelectorAll('.login-step').forEach(s => s.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');
}
function showLoading(msg = 'Loading...') {
  document.getElementById('loading-text').textContent = msg;
  showStep('step-loading');
}

document.addEventListener('firebaseReady', () => {
  window._onAuthChanged(async (firebaseUser) => {
    if (firebaseUser) {
      showLoading('Loading your profile...');
      await handleAuthSuccess(firebaseUser);
    } else {
      showStep('step-google');
    }
  });
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  showLoading('Opening Google Sign In...');
  try {
    await window._firebaseSignIn();
  } catch (err) {
    showStep('step-google');
    if (err.code === 'auth/popup-closed-by-user') {
      errEl.textContent = 'Sign-in cancelled. Try again.';
    } else if (err.code === 'auth/popup-blocked') {
      errEl.textContent = '⚠ Popup blocked. Please allow popups for this site.';
    } else if (err.code === 'auth/unauthorized-domain') {
      errEl.textContent = '⚠ This domain is not authorized. Add it in Firebase Console → Authentication → Authorized Domains.';
    } else {
      errEl.textContent = '⚠ ' + (err.message || 'Sign in failed');
    }
  }
});

document.getElementById('btn-back-google').addEventListener('click', () => showStep('step-google'));

document.getElementById('btn-show').addEventListener('click', () => {
  const inp = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-show');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
});

document.getElementById('btn-save-key').addEventListener('click', saveApiKey);

async function handleAuthSuccess(firebaseUser) {
  currentUser = firebaseUser;

  // Try Supabase first
  let userData = await db.getUser(firebaseUser.uid);

  if (!userData) {
    // New user — create in Supabase
    const inserted = await db.upsertUser(firebaseUser.uid, {
      email:       firebaseUser.email,
      name:        firebaseUser.displayName,
      photo:       firebaseUser.photoURL,
      gemini_key:  null,
      sessions:    0,
      messages:    0,
      corrections: 0,
      streak:      0,
      last_active: new Date().toISOString()
    });
    userData = inserted?.[0] || null;
    if (!userData) userData = await db.getUser(firebaseUser.uid);
  }

  currentUserData = userData;

  if (!userData?.gemini_key) {
    // First time — need API key
    document.getElementById('screen-login').style.display = 'flex';
    showStep('step-apikey');
  } else {
    GEMINI_KEY = userData.gemini_key;
    launchApp();
  }
}

async function saveApiKey() {
  const key     = document.getElementById('api-key-input').value.trim();
  const hint    = document.getElementById('api-key-hint');
  const saveBtn = document.getElementById('btn-save-key');

  if (!key) { hint.textContent = '⚠ Please paste your API key.'; hint.style.color = '#ff6060'; return; }
  if (!key.startsWith('AIza')) { hint.textContent = '⚠ Key should start with AIza...'; hint.style.color = '#ff6060'; return; }

  hint.textContent = '⏳ Verifying key...'; hint.style.color = '#888';
  saveBtn.disabled = true;

  try {
    const testUrl = GEMINI_BASE + 'gemini-2.5-flash:generateContent?key=' + key;
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 5 } })
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const errData = await res.json();
      hint.textContent = '❌ Invalid key: ' + (errData.error?.message || 'Check your key');
      hint.style.color = '#ff6060';
      saveBtn.disabled = false;
      return;
    }
  } catch (e) { /* network error — proceed */ }

  GEMINI_KEY = key;

  if (currentUser) {
    const saved = await db.updateUser(currentUser.uid, { gemini_key: key });
    if (!saved && !currentUserData) {
      // Supabase might not have the row yet — try upsert
      await db.upsertUser(currentUser.uid, {
        email: currentUser.email, name: currentUser.displayName,
        photo: currentUser.photoURL, gemini_key: key,
        sessions: 0, messages: 0, corrections: 0, streak: 0,
        last_active: new Date().toISOString()
      });
    }
    if (currentUserData) currentUserData.gemini_key = key;
  }

  hint.textContent = '✅ Key saved! Launching...';
  hint.style.color = '#1ad96b';
  setTimeout(() => launchApp(), 800);
}

function launchApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-app').classList.remove('hidden');

  const name  = currentUser?.displayName || currentUser?.email || 'Learner';
  const photo = currentUser?.photoURL;
  document.getElementById('user-name-display').textContent = name.split(' ')[0];

  const avatarEl = document.getElementById('user-avatar');
  if (photo) {
    avatarEl.style.backgroundImage    = `url(${photo})`;
    avatarEl.style.backgroundSize     = 'cover';
    avatarEl.style.backgroundPosition = 'center';
  } else {
    avatarEl.textContent = name[0].toUpperCase();
  }

  setupSpeechRecognition();
  loadProgress();
  updateLastActive();

  const firstName = name.split(' ')[0];
  const welcome = `Hey ${firstName}! I'm Dragon, your English teacher. Talk to me in Tamil, Tanglish, or English — I understand all three. What's on your mind today?`;
  addAIMsg(welcome);
  speakText(welcome);
  sessionStartTime = Date.now();
}

async function handleLogout() {
  await saveSessionToDb();
  stopSpeaking();
  stopListening();
  continuousMode  = false;
  suppressRestart = true;
  chatHistory     = [];
  currentUser     = null;
  currentUserData = null;
  GEMINI_KEY      = '';
  workingModel    = null;
  document.getElementById('chat-box').innerHTML = '';
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-login').style.display = 'flex';
  showLoading('Signing out...');
  await window._firebaseSignOut();
  showStep('step-google');
}

/* ══════════════════════════════════════════════════════════
   CHANGE API KEY (from settings)
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-change-key').addEventListener('click', () => {
  document.getElementById('apikey-change-form').classList.toggle('hidden');
});

document.getElementById('btn-update-key').addEventListener('click', async () => {
  const key = document.getElementById('new-api-key-input').value.trim();
  if (!key || !key.startsWith('AIza')) { alert('Please enter a valid Gemini key (starts with AIza...)'); return; }
  GEMINI_KEY   = key;
  workingModel = null;
  if (currentUser) await db.updateUser(currentUser.uid, { gemini_key: key });
  document.getElementById('apikey-status').textContent = '✅ Gemini API Connected';
  document.getElementById('apikey-change-form').classList.add('hidden');
  document.getElementById('new-api-key-input').value = '';
  alert('✅ API key updated!');
});

/* ══════════════════════════════════════════════════════════
   LOGOUT
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-logout').addEventListener('click', handleLogout);

/* ══════════════════════════════════════════════════════════
   PROGRESS & STATS
   ══════════════════════════════════════════════════════════ */
async function loadProgress() {
  if (!currentUserData) return;
  document.getElementById('stat-sessions').textContent    = currentUserData.sessions    || 0;
  document.getElementById('stat-messages').textContent    = currentUserData.messages    || 0;
  document.getElementById('stat-corrections').textContent = currentUserData.corrections || 0;
  document.getElementById('stat-streak').textContent      = currentUserData.streak      || 0;

  if (!currentUser) return;
  const sessions = await db.getSessions(currentUser.uid);
  const list     = document.getElementById('history-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="history-empty">No sessions yet. Start talking to Dragon! 🐉</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="history-item">
      <div class="history-date">${new Date(s.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
      <div class="history-stats">💬 ${s.messages||0} messages &nbsp;|&nbsp; ✏️ ${s.corrections||0} corrections &nbsp;|&nbsp; ⏱ ${s.duration||0} min</div>
    </div>
  `).join('');
}

async function saveSessionToDb() {
  if (!currentUser || !sessionStartTime || sessionMessages === 0) return;
  const duration = Math.round((Date.now() - sessionStartTime) / 60000);
  await db.saveSession(currentUser.uid, { messages: sessionMessages, corrections: sessionCorrections, duration });
  const newSessions    = (currentUserData?.sessions    || 0) + 1;
  const newMessages    = (currentUserData?.messages    || 0) + sessionMessages;
  const newCorrections = (currentUserData?.corrections || 0) + sessionCorrections;
  await db.updateUser(currentUser.uid, {
    sessions: newSessions, messages: newMessages,
    corrections: newCorrections, last_active: new Date().toISOString()
  });
  if (currentUserData) {
    currentUserData.sessions    = newSessions;
    currentUserData.messages    = newMessages;
    currentUserData.corrections = newCorrections;
  }
  sessionMessages = 0; sessionCorrections = 0; sessionStartTime = Date.now();
}

async function updateLastActive() {
  if (!currentUser || !currentUserData) return;
  const lastActive = currentUserData.last_active;
  let streak = currentUserData.streak || 0;
  if (lastActive) {
    const daysDiff = Math.floor((Date.now() - new Date(lastActive)) / 86400000);
    if (daysDiff === 1) streak++;
    else if (daysDiff > 1) streak = 1;
  }
  await db.updateUser(currentUser.uid, { streak, last_active: new Date().toISOString() });
  if (currentUserData) currentUserData.streak = streak;
  document.getElementById('stat-streak').textContent = streak;
}

/* ══════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════ */
const TABS = ['voice', 'analyze', 'topics', 'progress', 'voice-settings'];

TABS.forEach(t => {
  document.getElementById('tab-' + t).addEventListener('click', () => switchTab(t));
});

function switchTab(name) {
  TABS.forEach(t => {
    document.getElementById('panel-' + t).classList.remove('active');
    document.getElementById('tab-'   + t).classList.remove('active');
  });
  document.getElementById('panel-' + name).classList.add('active');
  document.getElementById('tab-'   + name).classList.add('active');
  if (name === 'progress') loadProgress();
}

/* ══════════════════════════════════════════════════════════
   CHAT UI
   ══════════════════════════════════════════════════════════ */
function addAIMsg(text) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = 'msg ai';
  const lines = text.split('\n');
  const formatted = lines.map(line => {
    const esc = escapeHtml(line.trim());
    if (!esc) return '<br>';
    if (esc.includes('Say it like this:')) return '<div class="correction-line">' + esc + '</div>';
    if (esc.includes('You said:') || esc.includes('தமிழில்:') || esc.includes('Tamil:'))
      return '<div class="tamil-line">' + esc + '</div>';
    return '<div class="reply-line">' + esc + '</div>';
  });
  div.innerHTML = '<div class="msg-label">🐉 DRAGON</div>' + formatted.join('');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addUserMsg(text) {
  const box  = document.getElementById('chat-box');
  const div  = document.createElement('div');
  const name = currentUser?.displayName?.split(' ')[0] || 'YOU';
  div.className = 'msg user';
  div.innerHTML = '<div class="msg-label">▶ ' + escapeHtml(name) + '</div>' + escapeHtml(text);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addThinking() {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'thinking';
  div.innerHTML = '<div class="msg-label">🐉 DRAGON</div><div class="thinking-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}

function removeThinking() { const t = document.getElementById('thinking'); if (t) t.remove(); }

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════
   ORB STATE
   ══════════════════════════════════════════════════════════ */
function setOrbState(state) {
  const btn     = document.getElementById('orb-btn');
  const status  = document.getElementById('voice-status');
  const rings   = ['ring1','ring2','ring3'].map(id => document.getElementById(id));
  const volBars = document.getElementById('vol-bars');
  rings.forEach(r => r && r.classList.remove('listening','speaking'));
  btn.classList.remove('listening','speaking');
  status.classList.remove('active','speaking');
  volBars.classList.remove('visible');

  if (state === 'idle') {
    btn.textContent    = '🎙';
    status.textContent = continuousMode ? '⏸ PAUSED — TAP ORB TO STOP' : 'TAP ORB → HANDS-FREE CHAT';
    stopVolAnimation();
  } else if (state === 'listening') {
    btn.textContent    = '⏹';
    btn.classList.add('listening');
    rings.forEach(r => r && r.classList.add('listening'));
    status.textContent = '🔴 SPEAK — PAUSE 2s TO SEND';
    status.classList.add('active');
    volBars.classList.add('visible');
    startVolAnimation();
  } else if (state === 'thinking') {
    btn.textContent    = '⏳';
    status.textContent = '💭 THINKING...';
    status.classList.add('active');
    stopVolAnimation();
  } else if (state === 'speaking') {
    btn.textContent    = '🔊';
    btn.classList.add('speaking');
    rings.forEach(r => r && r.classList.add('speaking'));
    status.textContent = '🟢 DRAGON SPEAKING...';
    status.classList.add('speaking');
    volBars.classList.add('visible');
    startSpeakAnimation();
  }
}

function startVolAnimation() {
  const ids = ['b1','b2','b3','b4','b5'], base = [8,14,20,14,8];
  function frame() {
    ids.forEach((id,i) => { const el = document.getElementById(id); if (el) el.style.height = (base[i] + Math.random()*14) + 'px'; });
    volAnimFrame = requestAnimationFrame(frame);
  }
  frame();
}

function startSpeakAnimation() {
  const ids = ['b1','b2','b3','b4','b5'];
  function frame() {
    ids.forEach(id => { const el = document.getElementById(id); if (el) { el.style.background='#1ad96b'; el.style.height=(6+Math.random()*18)+'px'; } });
    volAnimFrame = requestAnimationFrame(frame);
  }
  frame();
}

function stopVolAnimation() {
  if (volAnimFrame) { cancelAnimationFrame(volAnimFrame); volAnimFrame = null; }
  ['b1','b2','b3','b4','b5'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.height='4px'; el.style.background='#ff6b1a'; } });
}

/* ══════════════════════════════════════════════════════════
   TTS
   ══════════════════════════════════════════════════════════ */
function speakText(text) {
  if (isMuted) {
    if (continuousMode) { suppressRestart = false; setTimeout(() => { if (continuousMode) safeStart(); }, 400); }
    return;
  }
  stopSpeaking();
  const clean = text
    .replace(/[*#]/g,'').replace(/\n/g,' ')
    .replace(/DR4G0N\s*5P34K/gi,'Dragon').replace(/Dr4g0n/gi,'Dragon')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu,'')
    .replace(/✏️|🌐|✅|😊|💡|🎯|👍|🔥|⚡|🎙|🔊|🔇|⏹|⏳|💭|🟢|🔴|🐉/g,'')
    .replace(/\s+/g,' ').trim();

  if (useCustomVoice && customVoiceURL) {
    isSpeaking = true; setOrbState('speaking');
    if (customAudio) { customAudio.pause(); customAudio = null; }
    customAudio = new Audio(customVoiceURL);
    customAudio.onended = onSpeechEnd; customAudio.onerror = onSpeechEnd;
    customAudio.play(); return;
  }
  if (!window.speechSynthesis) return;
  isSpeaking = true; setOrbState('speaking');
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang  = 'en-US'; utter.rate = voiceRate; utter.pitch = voicePitch;
  if (selectedVoice) {
    utter.voice = selectedVoice;
  } else {
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.name.toLowerCase().includes('microsoft david')) ||
      voices.find(v => v.lang === 'en-US' && v.name.toLowerCase().includes('david')) ||
      voices.find(v => v.lang === 'en-US' && v.name.toLowerCase().includes('microsoft')) ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;
  }
  utter.onend = onSpeechEnd; utter.onerror = onSpeechEnd;
  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

function onSpeechEnd() {
  isSpeaking = false; stopVolAnimation();
  if (continuousMode) { suppressRestart = false; setTimeout(() => { if (continuousMode) safeStart(); }, 450); }
  else setOrbState('idle');
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (customAudio) { customAudio.pause(); customAudio = null; }
  isSpeaking = false; stopVolAnimation();
}

document.getElementById('mute-btn').addEventListener('click', () => {
  isMuted = !isMuted;
  const btn = document.getElementById('mute-btn');
  if (isMuted) { stopSpeaking(); btn.textContent='🔇 OFF'; btn.classList.add('muted'); }
  else { btn.textContent='🔊 ON'; btn.classList.remove('muted'); }
});

document.getElementById('clear-btn').addEventListener('click', () => {
  chatHistory = [];
  document.getElementById('chat-box').innerHTML = '';
  sessionMessages = 0; sessionCorrections = 0;
});

/* ══════════════════════════════════════════════════════════
   SPEECH RECOGNITION — CONTINUOUS MODE
   ══════════════════════════════════════════════════════════ */
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById('no-speech-msg').style.display = 'block';
    const orbBtn = document.getElementById('orb-btn');
    orbBtn.disabled = true; orbBtn.style.opacity = '0.4';
    document.getElementById('voice-status').textContent = 'TYPE BELOW — MIC NOT SUPPORTED';
    return;
  }
  recognition = new SR();
  recognition.lang = 'en-IN';
  recognition.interimResults = true;
  recognition.continuous     = true;

  recognition.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final   += e.results[i][0].transcript;
      else                       interim += e.results[i][0].transcript;
    }
    if (final) interimText += final;
    const live = (interimText + interim).trim();
    if (live) {
      const preview = live.length > 60 ? '…' + live.slice(-58) : live;
      document.getElementById('voice-status').textContent = '🎤 ' + preview;
      document.getElementById('voice-status').classList.add('active');
    }
    clearTimeout(silenceTimer);
    if (live) silenceTimer = setTimeout(() => submitSpeech(interimText.trim() || live), SILENCE_MS);
  };

  recognition.onend = () => {
    isListening = false;
    if (continuousMode && !suppressRestart && !isSpeaking)
      setTimeout(() => { if (continuousMode && !suppressRestart && !isSpeaking) safeStart(); }, 200);
  };

  recognition.onerror = e => {
    isListening = false;
    if (e.error === 'no-speech') {
      if (continuousMode && !suppressRestart && !isSpeaking) setTimeout(() => safeStart(), 300);
      return;
    }
    if (e.error === 'not-allowed') {
      continuousMode = false; setOrbState('idle');
      document.getElementById('voice-status').textContent = '⚠ MIC PERMISSION DENIED';
      return;
    }
    if (continuousMode && !suppressRestart && !isSpeaking) setTimeout(() => safeStart(), 500);
  };
}

function safeStart() {
  if (!recognition || isListening) return;
  try { interimText = ''; isListening = true; setOrbState('listening'); recognition.start(); }
  catch (err) { isListening = false; }
}

function submitSpeech(text) {
  if (!text || !text.trim()) return;
  clearTimeout(silenceTimer); interimText = '';
  suppressRestart = true;
  if (recognition) { try { recognition.stop(); } catch(e) {} }
  isListening = false;
  addUserMsg(text);
  chatHistory.push({ role: 'user', content: text });
  sessionMessages++;
  setOrbState('thinking');
  getAIReply();
}

function toggleVoice() {
  if (isSpeaking) {
    stopSpeaking();
    if (continuousMode) { suppressRestart = false; setTimeout(() => safeStart(), 300); }
    else setOrbState('idle');
    return;
  }
  if (continuousMode && isListening) {
    continuousMode = false; suppressRestart = true; clearTimeout(silenceTimer); stopListening(); return;
  }
  if (!continuousMode) { continuousMode = true; suppressRestart = false; safeStart(); }
}

function stopListening() {
  continuousMode = false; suppressRestart = true; clearTimeout(silenceTimer); interimText = '';
  if (recognition) { try { recognition.stop(); } catch(e) {} }
  isListening = false; setOrbState('idle');
}

document.getElementById('orb-btn').addEventListener('click', toggleVoice);

/* ══════════════════════════════════════════════════════════
   GEMINI API — WITH MODEL FALLBACK
   ══════════════════════════════════════════════════════════ */
async function callGeminiWithModel(modelName, messages, maxTokens) {
  const url = GEMINI_BASE + modelName + ':generateContent?key=' + GEMINI_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Gemini ' + res.status); }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');
  return text;
}

async function callGemini(messages, maxTokens = 500) {
  if (workingModel) {
    try { return await callGeminiWithModel(workingModel, messages, maxTokens); }
    catch(e) { workingModel = null; } // fall through to retry
  }
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try { const result = await callGeminiWithModel(model, messages, maxTokens); workingModel = model; return result; }
    catch (err) { lastErr = err; }
  }
  throw new Error('All models failed: ' + lastErr?.message);
}

function extractSpeakText(reply) {
  const matchCorrection = reply.match(/Say it like this:\s*"([^"]+)"/i);
  if (matchCorrection) return matchCorrection[1];
  const lines = reply.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const speakLines = [];
  for (const line of lines) {
    if (line.includes('You said:') || line.includes('தமிழில்:')) continue;
    const m = line.match(/"([^"]+)"/);
    if (m) return m[1];
    speakLines.push(line);
    if (speakLines.length >= 2) break;
  }
  return speakLines.join(' ').slice(0, 200);
}

async function getAIReply() {
  addThinking();
  try {
    const reply = await callGemini(chatHistory);
    removeThinking();
    chatHistory.push({ role: 'assistant', content: reply });
    addAIMsg(reply);
    if (reply.includes('Say it like this:')) sessionCorrections++;
    speakText(extractSpeakText(reply));
    if (sessionMessages > 0 && sessionMessages % 10 === 0) saveSessionToDb();
  } catch (err) {
    removeThinking();
    addAIMsg('⚠ Error: ' + err.message + '\n\nCheck your API key in Voice FX → API Key section.');
    suppressRestart = false;
    if (continuousMode) setTimeout(() => { if (continuousMode) safeStart(); }, 300);
    else setOrbState('idle');
  }
}

/* ══════════════════════════════════════════════════════════
   TEXT INPUT
   ══════════════════════════════════════════════════════════ */
async function sendText() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  stopSpeaking(); stopListening();
  addUserMsg(text);
  chatHistory.push({ role: 'user', content: text });
  sessionMessages++;
  document.getElementById('btn-send').disabled = true;
  setOrbState('thinking');
  try {
    const reply = await callGemini(chatHistory);
    chatHistory.push({ role: 'assistant', content: reply });
    addAIMsg(reply);
    if (reply.includes('Say it like this:')) sessionCorrections++;
    speakText(extractSpeakText(reply));
  } catch (err) {
    addAIMsg('⚠ Error: ' + err.message);
    setOrbState('idle');
  }
  document.getElementById('btn-send').disabled = false;
}

document.getElementById('btn-send').addEventListener('click', sendText);
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});

/* ══════════════════════════════════════════════════════════
   ANALYZE TAB
   ══════════════════════════════════════════════════════════ */
document.querySelectorAll('.ftype-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ftype-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedFeedbackType = btn.dataset.type;
  });
});

document.getElementById('btn-analyze').addEventListener('click', async () => {
  const text = document.getElementById('feedback-text').value.trim();
  if (!text) { alert('Please enter some text to analyze!'); return; }
  const btn = document.getElementById('btn-analyze');
  const resultCard = document.getElementById('result-card');
  btn.disabled = true; btn.textContent = '⏳ Analyzing...';
  resultCard.style.display = 'none';

  const prompts = {
    grammar:    'Check grammar only. List each error with a correction. Give a Grammar Score out of 10. Be friendly.',
    vocabulary: 'Analyze vocabulary. Suggest stronger words. Give a Vocabulary Score out of 10.',
    fluency:    'Analyze fluency and natural flow. Give tips. Give a Fluency Score out of 10.',
    all:        'Full English analysis:\n1. Grammar Score /10\n2. Vocabulary Score /10\n3. Fluency Score /10\n4. Overall Score /10\n5. Top 3 tips\nBe friendly. Plain text only.'
  };
  const sys = 'You are Dragon, a real human English teacher. Give feedback like a teacher sitting next to the student. Warm, honest, helpful. Simple words. Show CORRECT version clearly. No markdown symbols. Short and encouraging.';
  try {
    const msgs = [{ role: 'user', content: prompts[selectedFeedbackType] + '\n\nText to analyze:\n"' + text + '"' }];
    const reply = await callGemini(msgs, 700);
    resultCard.innerHTML = reply.replace(/\n/g,'<br>');
    resultCard.style.display = 'block';
  } catch (err) {
    resultCard.innerHTML = '⚠ Error: ' + err.message;
    resultCard.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = '🔍 ANALYZE';
});

/* ══════════════════════════════════════════════════════════
   TOPICS TAB
   ══════════════════════════════════════════════════════════ */
document.querySelectorAll('.topic-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const topic = btn.dataset.topic;
    switchTab('voice');
    stopSpeaking(); stopListening();
    continuousMode = false; chatHistory = [];
    document.getElementById('chat-box').innerHTML = '';
    sessionMessages = 0; sessionCorrections = 0;
    setOrbState('thinking');
    const starter = [{ role: 'user', content: `Start an English practice conversation about: "${topic}". Give ONE short natural opening line, then ask me one simple specific question. Be casual and friendly.` }];
    try {
      const reply = await callGemini(starter, 160);
      chatHistory.push({ role: 'assistant', content: reply });
      addAIMsg(reply); speakText(reply);
    } catch (err) { addAIMsg('Error: ' + err.message); setOrbState('idle'); }
  });
});

/* ══════════════════════════════════════════════════════════
   VOICE SETTINGS
   ══════════════════════════════════════════════════════════ */
function populateVoiceList() {
  const sel = document.getElementById('voice-select');
  if (!sel) return;
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) return;
  sel.innerHTML = '';
  const sorted = [...voices.filter(v => v.lang.startsWith('en')), ...voices.filter(v => !v.lang.startsWith('en'))];
  sorted.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = v.name + ' (' + v.lang + ')' + (v.default ? ' ★' : '');
    sel.appendChild(opt);
  });
  let bestIdx = sorted.findIndex(v => v.name.toLowerCase().includes('microsoft david'));
  if (bestIdx < 0) bestIdx = sorted.findIndex(v => v.lang === 'en-US' && v.name.toLowerCase().includes('david'));
  if (bestIdx < 0) bestIdx = sorted.findIndex(v => v.lang === 'en-US' && v.name.toLowerCase().includes('microsoft'));
  if (bestIdx < 0) bestIdx = sorted.findIndex(v => v.lang === 'en-US');
  if (bestIdx >= 0) sel.value = bestIdx;
}

document.getElementById('voice-rate').addEventListener('input', function() {
  document.getElementById('rate-val').textContent = parseFloat(this.value).toFixed(2);
});
document.getElementById('voice-pitch').addEventListener('input', function() {
  document.getElementById('pitch-val').textContent = parseFloat(this.value).toFixed(2);
});

document.getElementById('btn-preview-voice').addEventListener('click', () => {
  const sel = document.getElementById('voice-select');
  const voices = window.speechSynthesis.getVoices();
  const sorted = [...voices.filter(v => v.lang.startsWith('en')), ...voices.filter(v => !v.lang.startsWith('en'))];
  const v = sorted[parseInt(sel.value)];
  if (!v) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance("Hey! I am Dragon, your English coach. Let's practice!");
  u.voice = v;
  u.rate  = parseFloat(document.getElementById('voice-rate').value);
  u.pitch = parseFloat(document.getElementById('voice-pitch').value);
  window.speechSynthesis.speak(u);
});

document.getElementById('btn-apply-voice').addEventListener('click', () => {
  const sel = document.getElementById('voice-select');
  const voices = window.speechSynthesis.getVoices();
  const sorted = [...voices.filter(v => v.lang.startsWith('en')), ...voices.filter(v => !v.lang.startsWith('en'))];
  selectedVoice  = sorted[parseInt(sel.value)] || null;
  voiceRate      = parseFloat(document.getElementById('voice-rate').value);
  voicePitch     = parseFloat(document.getElementById('voice-pitch').value);
  useCustomVoice = false;
  const name = selectedVoice ? selectedVoice.name : 'Default';
  document.getElementById('current-voice-mode').textContent =
    'MODE: SYSTEM — ' + name + ' | RATE ' + voiceRate.toFixed(2) + ' | PITCH ' + voicePitch.toFixed(2);
});

document.getElementById('custom-voice-file').addEventListener('change', function() {
  if (this.files[0]) handleVoiceFile(this.files[0]);
});

document.getElementById('upload-label').addEventListener('click', () => {
  document.getElementById('custom-voice-file').click();
});
document.getElementById('upload-label').addEventListener('dragover', e => {
  e.preventDefault();
  document.getElementById('upload-label').classList.add('drag-over');
});
document.getElementById('upload-label').addEventListener('dragleave', () => {
  document.getElementById('upload-label').classList.remove('drag-over');
});
document.getElementById('upload-label').addEventListener('drop', e => {
  e.preventDefault();
  document.getElementById('upload-label').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) handleVoiceFile(f);
});

function handleVoiceFile(file) {
  if (customVoiceURL) URL.revokeObjectURL(customVoiceURL);
  customVoiceURL = URL.createObjectURL(file);
  useCustomVoice = true;
  document.getElementById('custom-file-name').textContent   = file.name;
  document.getElementById('custom-voice-label').textContent = '✅ ' + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
  document.getElementById('custom-voice-info').style.display = 'block';
  document.getElementById('current-voice-mode').textContent  = 'MODE: CUSTOM FILE — ' + file.name;
}

document.getElementById('btn-preview-custom').addEventListener('click', () => {
  if (!customVoiceURL) return;
  if (customAudio) { customAudio.pause(); customAudio = null; }
  customAudio = new Audio(customVoiceURL); customAudio.play();
});

document.getElementById('btn-remove-custom').addEventListener('click', () => {
  if (customVoiceURL) URL.revokeObjectURL(customVoiceURL);
  customVoiceURL = null; useCustomVoice = false;
  document.getElementById('custom-voice-info').style.display = 'none';
  document.getElementById('custom-file-name').textContent    = 'No file selected';
  document.getElementById('custom-voice-file').value         = '';
  document.getElementById('current-voice-mode').textContent  = 'MODE: SYSTEM VOICE';
});

// Voice list init
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', populateVoiceList);
  setTimeout(populateVoiceList, 600);
}

window.addEventListener('beforeunload', () => { saveSessionToDb(); });
