/* ══════════════════════════════════════════════════════════
   DR4G0N 5P34K — script.js  (Professional Version)
   ══════════════════════════════════════════════════════════ */

/* ─── SUPABASE CONFIG ────────────────────────────────────────
   Go to: supabase.com → Your Project → Settings → API
   Copy Project URL and anon/public key
   ─────────────────────────────────────────────────────────── */
const SUPABASE_URL  = 'https://libioplsnfabkjpsgbwf.supabase.co';   // e.g. https://xxxx.supabase.co
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpYmlvcGxzbmZhYmtqcHNnYndmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzY0OTMsImV4cCI6MjA5NTM1MjQ5M30._L-Ue7OiSWiEz4nzCC07jjDzuQG67v86LAbRI2Dz8lk';

// Supabase REST API helper (no npm needed — pure fetch)
const db = {
  async query(table, method = 'GET', body = null, filter = '') {
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
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
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

/* ─── GEMINI CONFIG ─────────────────────────────────────────── */
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

/* ─── STATE ──────────────────────────────────────────────────── */
let currentUser       = null;   // Firebase user object
let currentUserData   = null;   // Supabase user row
let GEMINI_KEY        = '';
let workingModel      = null;
let chatHistory       = [];
let isMuted           = false;
let isListening       = false;
let isSpeaking        = false;
let recognition       = null;
let currentUtterance  = null;
let selectedFeedbackType = 'grammar';
let volAnimFrame      = null;
let silenceTimer      = null;
let interimText       = '';
let continuousMode    = false;
let suppressRestart   = false;
const SILENCE_MS      = 2000;
let selectedVoice     = null;
let voiceRate         = 0.80;
let voicePitch        = 1.0;
let useCustomVoice    = false;
let customVoiceURL    = null;
let customAudio       = null;
let sessionStartTime  = null;
let sessionMessages   = 0;
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

// Wait for Firebase to be ready then set up auth listener
document.addEventListener('firebaseReady', () => {
  // Handle redirect result first (for mobile/popup-blocked fallback)
  if (window._getRedirectResult) {
    window._getRedirectResult().then(async (result) => {
      if (result && result.user) {
        showLoading('Loading your profile...');
        await handleAuthSuccess(result.user);
      }
    }).catch(() => {});
  }

  let authHandled = false;
  window._onAuthChanged(async (firebaseUser) => {
    console.log('AUTH STATE CHANGED:', firebaseUser ? firebaseUser.email : 'null');
    if (authHandled) { console.log('Already handled, skipping'); return; }
    if (firebaseUser) {
      authHandled = true;
      showLoading('Signing you in... (' + firebaseUser.email + ')');
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
    // Try popup first, fall back to redirect if blocked
    await window._firebaseSignIn();
    // onAuthChanged will handle the rest
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      // Fallback to redirect method
      showLoading('Redirecting to Google...');
      try {
        await window._firebaseSignInRedirect();
      } catch (redirectErr) {
        showStep('step-google');
        errEl.textContent = '⚠ Error: ' + redirectErr.message;
      }
    } else {
      showStep('step-google');
      errEl.textContent = '⚠ Error: ' + err.message;
    }
  }
});

async function handleAuthSuccess(firebaseUser) {
  currentUser = firebaseUser;

  let userData = null;
  try {
    // Try Supabase with timeout
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
    userData = await Promise.race([db.getUser(firebaseUser.uid), timeout]);

    if (!userData) {
      const upsertTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      await Promise.race([db.upsertUser(firebaseUser.uid, {
        email:      firebaseUser.email,
        name:       firebaseUser.displayName,
        photo:      firebaseUser.photoURL,
        gemini_key: null,
        sessions:   0,
        messages:   0,
        corrections:0,
        streak:     0,
        last_active: new Date().toISOString()
      }), upsertTimeout]);
      const getTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      userData = await Promise.race([db.getUser(firebaseUser.uid), getTimeout]);
    }
  } catch (err) {
    console.warn('Supabase error (continuing anyway):', err.message);
    // Continue without DB — use local storage as fallback
    userData = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      name: firebaseUser.displayName,
      gemini_key: localStorage.getItem('gemini_key_' + firebaseUser.uid) || null
    };
  }

  currentUserData = userData;

  console.log('handleAuthSuccess done, gemini_key:', userData?.gemini_key ? 'EXISTS' : 'NONE');

  // Check if they have an API key saved
  if (!userData?.gemini_key) {
    console.log('No API key - showing step-apikey');
    document.getElementById('screen-login').style.display = 'flex';
    showStep('step-apikey');
  } else {
    console.log('Has API key - launching app');
    GEMINI_KEY = userData.gemini_key;
    launchApp();
  }
}

function toggleKeyVisibility() {
  const inp = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-show');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

// Validate and save API key to Supabase
async function saveApiKey() {
  const key     = document.getElementById('api-key-input').value.trim();
  const hint    = document.getElementById('api-key-hint');
  const saveBtn = document.getElementById('btn-save-key');

  if (!key) { hint.textContent = '⚠ Please paste your API key.'; hint.style.color = '#ff6060'; return; }
  if (!key.startsWith('AIza')) { hint.textContent = '⚠ Key should start with AIza...'; hint.style.color = '#ff6060'; return; }

  hint.textContent = '⏳ Verifying key...'; hint.style.color = '#888';
  saveBtn.disabled = true;

  // Test the key with a quick API call
  try {
    const testUrl = GEMINI_BASE + 'gemini-2.5-flash:generateContent?key=' + key;
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 5 } })
    });
    if (!res.ok && res.status === 400) {
      // 400 means key works but bad request — that's OK for our test
    } else if (!res.ok && res.status === 401) {
      hint.textContent = '❌ Invalid API key. Please check and try again.';
      hint.style.color = '#ff6060';
      saveBtn.disabled = false;
      return;
    }
  } catch (e) { /* network error — proceed anyway */ }

  // Save to Supabase + localStorage fallback
  GEMINI_KEY = key;
  localStorage.setItem('gemini_key_' + currentUser.uid, key);
  try {
    await db.updateUser(currentUser.uid, { gemini_key: key });
  } catch(e) { console.warn('Supabase save failed, key saved locally'); }
  if (currentUserData) currentUserData.gemini_key = key;

  hint.textContent = '✅ Key saved! Launching...';
  hint.style.color = '#1ad96b';

  setTimeout(() => launchApp(), 800);
}

function launchApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-app').classList.remove('hidden');

  // Populate user UI
  const name  = currentUser.displayName || currentUser.email;
  const photo = currentUser.photoURL;
  document.getElementById('user-name-display').textContent = name.split(' ')[0];
  const avatarEl = document.getElementById('user-avatar');
  if (photo) {
    avatarEl.style.backgroundImage = `url(${photo})`;
    avatarEl.style.backgroundSize  = 'cover';
  } else {
    avatarEl.textContent = name[0].toUpperCase();
  }

  setupSpeechRecognition();
  loadProgress();
  updateLastActive();

  // Welcome message
  const welcome = `Hey ${name.split(' ')[0]}! I'm Dragon, your English teacher. Talk to me in Tamil, Tanglish, or English — I understand all three. What's on your mind today?`;
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
  document.getElementById('chat-box').innerHTML     = '';
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-login').style.display = 'flex';
  showLoading('Signing out...');
  await window._firebaseSignOut();
  showStep('step-google');
}

/* ══════════════════════════════════════════════════════════
   CHANGE API KEY (from settings tab)
   ══════════════════════════════════════════════════════════ */
function showChangeKey() {
  document.getElementById('apikey-change-form').classList.toggle('hidden');
}

async function updateApiKey() {
  const key = document.getElementById('new-api-key-input').value.trim();
  if (!key || !key.startsWith('AIza')) { alert('Please enter a valid Gemini key (starts with AIza...)'); return; }
  GEMINI_KEY   = key;
  workingModel = null;
  await db.updateUser(currentUser.uid, { gemini_key: key });
  document.getElementById('apikey-status').textContent      = '✅ Gemini API Connected';
  document.getElementById('apikey-change-form').classList.add('hidden');
  document.getElementById('new-api-key-input').value        = '';
  alert('✅ API key updated!');
}

/* ══════════════════════════════════════════════════════════
   PROGRESS & STATS
   ══════════════════════════════════════════════════════════ */
async function loadProgress() {
  if (!currentUserData) return;
  document.getElementById('stat-sessions').textContent    = currentUserData.sessions    || 0;
  document.getElementById('stat-messages').textContent    = currentUserData.messages    || 0;
  document.getElementById('stat-corrections').textContent = currentUserData.corrections || 0;
  document.getElementById('stat-streak').textContent      = currentUserData.streak      || 0;

  const sessions = await db.getSessions(currentUser.uid);
  const list     = document.getElementById('history-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="history-empty">No sessions yet. Start talking to Dragon! 🐉</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="history-item">
      <div class="history-date">${new Date(s.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}</div>
      <div class="history-stats">
        💬 ${s.messages || 0} messages &nbsp;|&nbsp; ✏️ ${s.corrections || 0} corrections &nbsp;|&nbsp; ⏱ ${s.duration || 0} min
      </div>
    </div>
  `).join('');
}

async function saveSessionToDb() {
  if (!currentUser || !sessionStartTime || sessionMessages === 0) return;
  const duration = Math.round((Date.now() - sessionStartTime) / 60000);
  await db.saveSession(currentUser.uid, {
    messages:    sessionMessages,
    corrections: sessionCorrections,
    duration
  });
  const newSessions    = (currentUserData?.sessions    || 0) + 1;
  const newMessages    = (currentUserData?.messages    || 0) + sessionMessages;
  const newCorrections = (currentUserData?.corrections || 0) + sessionCorrections;
  await db.updateUser(currentUser.uid, {
    sessions:    newSessions,
    messages:    newMessages,
    corrections: newCorrections,
    last_active: new Date().toISOString()
  });
  if (currentUserData) {
    currentUserData.sessions    = newSessions;
    currentUserData.messages    = newMessages;
    currentUserData.corrections = newCorrections;
  }
  sessionMessages    = 0;
  sessionCorrections = 0;
  sessionStartTime   = Date.now();
}

async function updateLastActive() {
  if (!currentUser) return;
  // Streak logic
  const lastActive = currentUserData?.last_active;
  if (lastActive) {
    const daysDiff = Math.floor((Date.now() - new Date(lastActive)) / 86400000);
    let streak = currentUserData?.streak || 0;
    if (daysDiff === 1) streak++;
    else if (daysDiff > 1) streak = 1;
    await db.updateUser(currentUser.uid, { streak, last_active: new Date().toISOString() });
    if (currentUserData) currentUserData.streak = streak;
    document.getElementById('stat-streak').textContent = streak;
  }
}

function clearChat() {
  chatHistory = [];
  document.getElementById('chat-box').innerHTML = '';
  sessionMessages    = 0;
  sessionCorrections = 0;
}

/* ══════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════ */
function switchTab(name) {
  ['voice','analyze','topics','progress','voice-settings'].forEach(t => {
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
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function removeThinking() { const t = document.getElementById('thinking'); if (t) t.remove(); }
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════
   ORB STATE
   ══════════════════════════════════════════════════════════ */
function setOrbState(state) {
  const btn    = document.getElementById('orb-btn');
  const status = document.getElementById('voice-status');
  const rings  = ['ring1','ring2','ring3'].map(id => document.getElementById(id));
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
   TTS — TEXT TO SPEECH
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
    customAudio.play();
    return;
  }
  if (!window.speechSynthesis) return;
  isSpeaking = true; setOrbState('speaking');
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang  = 'en-US'; utter.rate = voiceRate || 0.80; utter.pitch = voicePitch || 1.0;
  if (selectedVoice) { utter.voice = selectedVoice; }
  else {
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
function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('mute-btn');
  if (isMuted) { stopSpeaking(); btn.textContent='🔇 OFF'; btn.classList.add('muted'); }
  else { btn.textContent='🔊 ON'; btn.classList.remove('muted'); }
}

/* ══════════════════════════════════════════════════════════
   SPEECH RECOGNITION — CONTINUOUS MODE
   ══════════════════════════════════════════════════════════ */
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById('no-speech-msg').style.display = 'block';
    document.getElementById('orb-btn').disabled = true;
    document.getElementById('orb-btn').style.opacity = '0.4';
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
    if (live) { silenceTimer = setTimeout(() => submitSpeech(interimText.trim() || live), SILENCE_MS); }
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

async function callClaude(messages, maxTokens = 500) {
  if (workingModel) return callGeminiWithModel(workingModel, messages, maxTokens);
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const result = await callGeminiWithModel(model, messages, maxTokens);
      workingModel = model;
      return result;
    } catch (err) { lastErr = err; }
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
    const reply = await callClaude(chatHistory);
    removeThinking();
    chatHistory.push({ role: 'assistant', content: reply });
    addAIMsg(reply);
    if (reply.includes('Say it like this:')) sessionCorrections++;
    speakText(extractSpeakText(reply));
    // Auto-save every 10 messages
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
    const reply = await callClaude(chatHistory);
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
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});

/* ══════════════════════════════════════════════════════════
   ANALYZE TAB
   ══════════════════════════════════════════════════════════ */
function selectType(btn, type) {
  document.querySelectorAll('.ftype-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedFeedbackType = type;
}

async function analyzeText() {
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
    const modelsToTry = workingModel ? [workingModel, ...GEMINI_MODELS.filter(m => m !== workingModel)] : GEMINI_MODELS;
    let reply = 'No response.';
    for (const m of modelsToTry) {
      try {
        const url = GEMINI_BASE + m + ':generateContent?key=' + GEMINI_KEY;
        const r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: sys }] },
            contents: msgs.map(msg => ({ role: 'user', parts: [{ text: msg.content }] })),
            generationConfig: { maxOutputTokens: 700, temperature: 0.65 }
          })
        });
        if (!r.ok) continue;
        const d = await r.json();
        reply = d.candidates?.[0]?.content?.parts?.[0]?.text || reply;
        workingModel = m; break;
      } catch(e) { continue; }
    }
    resultCard.innerHTML = reply.replace(/\n/g,'<br>');
    resultCard.style.display = 'block';
  } catch (err) {
    resultCard.innerHTML = '⚠ Error: ' + err.message;
    resultCard.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = '🔍 ANALYZE';
}

/* ══════════════════════════════════════════════════════════
   TOPICS TAB
   ══════════════════════════════════════════════════════════ */
async function startTopic(topic) {
  switchTab('voice');
  stopSpeaking(); stopListening();
  continuousMode = false; chatHistory = [];
  document.getElementById('chat-box').innerHTML = '';
  sessionMessages = 0; sessionCorrections = 0;
  setOrbState('thinking');
  const starter = [{ role: 'user', content: `Start an English practice conversation about: "${topic}". Give ONE short natural opening line, then ask me one simple specific question. Be casual and friendly.` }];
  try {
    const reply = await callClaude(starter, 160);
    chatHistory.push({ role: 'assistant', content: reply });
    addAIMsg(reply); speakText(reply);
  } catch (err) { addAIMsg('Error: ' + err.message); setOrbState('idle'); }
}

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

function previewVoice() {
  const sel = document.getElementById('voice-select');
  const voices = window.speechSynthesis.getVoices();
  const sorted = [...voices.filter(v => v.lang.startsWith('en')), ...voices.filter(v => !v.lang.startsWith('en'))];
  const v = sorted[parseInt(sel.value)];
  if (!v) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance("Hey! I am Dragon, your English coach. Let's practice!");
  u.voice = v; u.rate = parseFloat(document.getElementById('voice-rate').value);
  u.pitch = parseFloat(document.getElementById('voice-pitch').value);
  window.speechSynthesis.speak(u);
}

function applyVoiceSettings() {
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
}

function loadCustomVoice(input) { const f = input.files[0]; if (f) handleVoiceFile(f); }
function handleVoiceDrop(e) {
  e.preventDefault();
  document.getElementById('upload-label').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) handleVoiceFile(f);
}
function handleVoiceFile(file) {
  if (customVoiceURL) URL.revokeObjectURL(customVoiceURL);
  customVoiceURL = URL.createObjectURL(file);
  useCustomVoice = true;
  document.getElementById('custom-file-name').textContent   = file.name;
  document.getElementById('custom-voice-label').textContent = '✅ ' + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)';
  document.getElementById('custom-voice-info').style.display = 'block';
  document.getElementById('current-voice-mode').textContent  = 'MODE: CUSTOM FILE — ' + file.name;
}
function previewCustomVoice() {
  if (!customVoiceURL) return;
  if (customAudio) { customAudio.pause(); customAudio = null; }
  customAudio = new Audio(customVoiceURL); customAudio.play();
}
function clearCustomVoice() {
  if (customVoiceURL) URL.revokeObjectURL(customVoiceURL);
  customVoiceURL = null; useCustomVoice = false;
  document.getElementById('custom-voice-info').style.display = 'none';
  document.getElementById('custom-file-name').textContent    = 'No file selected';
  document.getElementById('custom-voice-file').value         = '';
  document.getElementById('current-voice-mode').textContent  = 'MODE: SYSTEM VOICE';
}

// Voice list init
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', populateVoiceList);
  setTimeout(populateVoiceList, 600);
}
document.getElementById('upload-label').addEventListener('click', () => {
  document.getElementById('custom-voice-file').click();
});

// Save session before page unload
window.addEventListener('beforeunload', () => { saveSessionToDb(); });
