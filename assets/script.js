/* ══════════════════════════════════════════════════════════
   DR4G0N 5P34K — script.js
   Email/Password Auth → Supabase → Gemini AI (auto)
   ══════════════════════════════════════════════════════════ */

/* ─── SUPABASE CONFIG ─────────────────────────────────────── */
const SUPABASE_URL  = 'https://libioplsnfabkjpsgbwf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpYmlvcGxzbmZhYmtqcHNnYndmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzY0OTMsImV4cCI6MjA5NTM1MjQ5M30._L-Ue7OiSWiEz4nzCC07jjDzuQG67v86LAbRI2Dz8lk';

/* ─── SUPABASE HELPER ─────────────────────────────────────── */
async function dbQuery(table, method = 'GET', body = null, filter = '') {
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
      const txt = await res.text();
      console.warn(`Supabase ${method} ${table}:`, res.status, txt);
      return null;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
  } catch (e) {
    console.warn('Supabase error:', e.message);
    return null;
  }
}

/* ─── GEMINI CONFIG ───────────────────────────────────────── */
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models/';

const SYSTEM_PROMPT = `You are Dragon, a friendly English teacher. You understand Tamil, Tanglish, and English perfectly.

YOUR REPLY MUST ALWAYS FOLLOW THIS EXACT FORMAT — no exceptions:

[One emoji] [One warm short sentence — max 10 words.]

[If they made a mistake:]
✏️ Say it like this: "[The correct sentence in double quotes]"

[One short teaching tip — max 1 sentence.]

[One short question to keep talking.]
[If hard, also write in Tamil: தமிழில்: [Tamil question]]

SPECIAL RULES:
- WHEN USER SPEAKS TAMIL OR TANGLISH: First line: 🌐 You said: "[English meaning]" then help them say it in English.
- WHEN USER SPEAKS CORRECT ENGLISH: Reply naturally. One emoji. Two short sentences. One question.
- Max 3 lines total. Never more. Short is better.
- Correct sentence MUST be in double quotes on its own line with ✏️
- Simple words only. No bullet points. No bold stars. Clean plain text with emojis.
- You are called Dragon. Never say DR4G0N 5P34K out loud.`;

/* ─── STATE ───────────────────────────────────────────────── */
let currentUser      = null;   // { id, name, email, phone, ... }
let GEMINI_KEY       = '';     // fetched from Supabase config table
let workingModel     = null;
let chatHistory      = [];
let isMuted          = false;
let isListening      = false;
let isSpeaking       = false;
let recognition      = null;
let selectedFeedbackType = 'grammar';
let volAnimFrame     = null;
let silenceTimer     = null;
let interimText      = '';
let continuousMode   = false;
let suppressRestart  = false;
const SILENCE_MS     = 2000;
let selectedVoice    = null;
let voiceRate        = 0.80;
let voicePitch       = 1.0;
let useCustomVoice   = false;
let customVoiceURL   = null;
let customAudio      = null;
let sessionStartTime = null;
let sessionMessages  = 0;
let sessionCorrections = 0;

/* ══════════════════════════════════════════════════════════
   SIMPLE PASSWORD HASH (SHA-256 via Web Crypto)
   ══════════════════════════════════════════════════════════ */
async function hashPassword(password) {
  const enc  = new TextEncoder();
  const buf  = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ══════════════════════════════════════════════════════════
   AUTH UI HELPERS
   ══════════════════════════════════════════════════════════ */
function showForm(formId) {
  ['form-signin','form-register','form-forgot','form-loading'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(formId).classList.remove('hidden');
}

function setError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

function setSuccess(elId, msg) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg;
  showForm('form-loading');
}

/* ══════════════════════════════════════════════════════════
   AUTH TABS
   ══════════════════════════════════════════════════════════ */
document.getElementById('tab-signin').addEventListener('click', () => {
  document.getElementById('tab-signin').classList.add('active');
  document.getElementById('tab-register').classList.remove('active');
  showForm('form-signin');
});

document.getElementById('tab-register').addEventListener('click', () => {
  document.getElementById('tab-register').classList.add('active');
  document.getElementById('tab-signin').classList.remove('active');
  showForm('form-register');
});

/* ══════════════════════════════════════════════════════════
   PASSWORD VISIBILITY TOGGLES
   ══════════════════════════════════════════════════════════ */
document.getElementById('eye-signin').addEventListener('click', () => {
  const inp = document.getElementById('signin-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  document.getElementById('eye-signin').textContent = inp.type === 'password' ? '👁' : '🙈';
});

document.getElementById('eye-reg').addEventListener('click', () => {
  const inp = document.getElementById('reg-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  document.getElementById('eye-reg').textContent = inp.type === 'password' ? '👁' : '🙈';
});

/* ══════════════════════════════════════════════════════════
   REGISTER
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-register').addEventListener('click', async () => {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim().toLowerCase();
  const phone    = document.getElementById('reg-phone').value.trim();
  const password = document.getElementById('reg-password').value;

  setError('register-error', '');
  setSuccess('register-success', '');

  if (!name)              return setError('register-error', '⚠ Please enter your name.');
  if (!email || !email.includes('@')) return setError('register-error', '⚠ Please enter a valid email.');
  if (!phone)             return setError('register-error', '⚠ Please enter your phone number.');
  if (password.length < 6) return setError('register-error', '⚠ Password must be at least 6 characters.');

  document.getElementById('btn-register').disabled = true;
  document.getElementById('btn-register').textContent = '⏳ Creating account...';

  // Check if email already exists
  const existing = await dbQuery('users', 'GET', null, `?email=eq.${encodeURIComponent(email)}&limit=1`);
  if (existing && existing.length > 0) {
    setError('register-error', '⚠ This email is already registered. Please sign in.');
    document.getElementById('btn-register').disabled = false;
    document.getElementById('btn-register').textContent = '🚀 CREATE ACCOUNT';
    return;
  }

  const hashed = await hashPassword(password);
  const result = await dbQuery('users', 'POST', {
    name, email, phone, password: hashed,
    sessions: 0, messages: 0, corrections: 0, streak: 0,
    last_active: new Date().toISOString()
  });

  document.getElementById('btn-register').disabled = false;
  document.getElementById('btn-register').textContent = '🚀 CREATE ACCOUNT';

  if (!result) {
    return setError('register-error', '⚠ Registration failed. Please try again.');
  }

  setSuccess('register-success', '✅ Account created! You can now sign in.');
  document.getElementById('reg-name').value = '';
  document.getElementById('reg-email').value = '';
  document.getElementById('reg-phone').value = '';
  document.getElementById('reg-password').value = '';

  // Auto switch to sign in after 1.5s
  setTimeout(() => {
    document.getElementById('tab-signin').click();
  }, 1500);
});

/* ══════════════════════════════════════════════════════════
   SIGN IN
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-signin').addEventListener('click', handleSignIn);
document.getElementById('signin-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSignIn();
});

async function handleSignIn() {
  const email    = document.getElementById('signin-email').value.trim().toLowerCase();
  const password = document.getElementById('signin-password').value;

  setError('signin-error', '');

  if (!email)    return setError('signin-error', '⚠ Please enter your email.');
  if (!password) return setError('signin-error', '⚠ Please enter your password.');

  showLoading('Signing in...');

  const hashed = await hashPassword(password);
  const rows = await dbQuery('users', 'GET', null,
    `?email=eq.${encodeURIComponent(email)}&password=eq.${hashed}&limit=1`);

  if (!rows || rows.length === 0) {
    showForm('form-signin');
    return setError('signin-error', '⚠ Wrong email or password. Please try again.');
  }

  currentUser = rows[0];

  // Save session to localStorage so page refresh keeps login
  localStorage.setItem('dragon_user_id', currentUser.id);

  showLoading('Loading Dragon...');
  await loadGeminiKey();
  launchApp();
}

/* ══════════════════════════════════════════════════════════
   AUTO LOGIN (on page refresh)
   ══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  const savedId = localStorage.getItem('dragon_user_id');
  if (savedId) {
    showLoading('Welcome back...');
    const rows = await dbQuery('users', 'GET', null, `?id=eq.${savedId}&limit=1`);
    if (rows && rows.length > 0) {
      currentUser = rows[0];
      await loadGeminiKey();
      launchApp();
      return;
    }
    localStorage.removeItem('dragon_user_id');
  }
  showForm('form-signin');
});

/* ══════════════════════════════════════════════════════════
   LOAD GEMINI KEY FROM SUPABASE CONFIG
   ══════════════════════════════════════════════════════════ */
async function loadGeminiKey() {
  // Each user has their own gemini_key stored in their users row
  if (currentUser && currentUser.gemini_key) {
    GEMINI_KEY = currentUser.gemini_key;
  } else {
    GEMINI_KEY = '';
  }
}

/* ══════════════════════════════════════════════════════════
   FORGOT PASSWORD
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-forgot').addEventListener('click', () => showForm('form-forgot'));
document.getElementById('btn-back-login').addEventListener('click', () => showForm('form-signin'));

document.getElementById('btn-reset').addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim().toLowerCase();
  setError('forgot-error', '');
  setSuccess('forgot-success', '');

  if (!email || !email.includes('@')) return setError('forgot-error', '⚠ Please enter a valid email.');

  const rows = await dbQuery('users', 'GET', null, `?email=eq.${encodeURIComponent(email)}&limit=1`);
  if (!rows || rows.length === 0) {
    return setError('forgot-error', '⚠ No account found with this email.');
  }

  // Generate a reset token and store it
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await dbQuery('users', 'PATCH', { reset_token: token }, `?email=eq.${encodeURIComponent(email)}`);

  // Show instructions (in a real app you'd email the link)
  setSuccess('forgot-success',
    `✅ Reset link generated! In production, this would be emailed to ${email}.\n\nFor now, contact the admin with your email to reset your password.`
  );
});

/* ══════════════════════════════════════════════════════════
   LAUNCH APP
   ══════════════════════════════════════════════════════════ */
function launchApp() {
  document.getElementById('screen-login').style.display = 'none';

  // If user has no Gemini key yet, show key setup screen first
  if (!GEMINI_KEY) {
    document.getElementById('screen-apikey').classList.remove('hidden');
    document.getElementById('screen-app').classList.add('hidden');
    const name = currentUser.name?.split(' ')[0] || 'there';
    document.getElementById('apikey-welcome-name').textContent = name;
    return;
  }

  document.getElementById('screen-apikey').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');

  const name = currentUser.name || currentUser.email || 'Learner';
  document.getElementById('user-name-display').textContent = name.split(' ')[0];

  const avatarEl = document.getElementById('user-avatar');
  avatarEl.textContent = name[0].toUpperCase();
  avatarEl.style.backgroundImage = '';

  setupSpeechRecognition();
  loadProgress();
  updateStreak();

  const firstName = name.split(' ')[0];
  const welcome = `Hey ${firstName}! I'm Dragon, your English teacher. Talk to me in Tamil, Tanglish, or English — I understand all three. What's on your mind today?`;
  addAIMsg(welcome);
  speakText(welcome);
  sessionStartTime = Date.now();
}

/* ══════════════════════════════════════════════════════════
   LOGOUT
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-logout').addEventListener('click', async () => {
  await saveSessionToDb();
  stopSpeaking(); stopListening();
  continuousMode = false; suppressRestart = true;
  chatHistory = []; currentUser = null; GEMINI_KEY = ''; workingModel = null;
  localStorage.removeItem('dragon_user_id');
  document.getElementById('chat-box').innerHTML = '';
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-apikey').classList.add('hidden');
  document.getElementById('screen-login').style.display = 'flex';
  document.getElementById('signin-email').value = '';
  document.getElementById('signin-password').value = '';
  showForm('form-signin');
});

/* ══════════════════════════════════════════════════════════
   CHANGE PASSWORD
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-show-change-pass').addEventListener('click', () => {
  document.getElementById('change-pass-form').classList.toggle('hidden');
});

document.getElementById('btn-save-new-pass').addEventListener('click', async () => {
  const oldPass = document.getElementById('old-password').value;
  const newPass = document.getElementById('new-password').value;
  setError('change-pass-error', '');
  setSuccess('change-pass-success', '');

  if (!oldPass || !newPass) return setError('change-pass-error', '⚠ Fill both fields.');
  if (newPass.length < 6)   return setError('change-pass-error', '⚠ New password must be at least 6 chars.');

  const oldHash = await hashPassword(oldPass);
  if (oldHash !== currentUser.password) return setError('change-pass-error', '⚠ Current password is wrong.');

  const newHash = await hashPassword(newPass);
  const res = await dbQuery('users', 'PATCH', { password: newHash }, `?id=eq.${currentUser.id}`);
  if (res === null) return setError('change-pass-error', '⚠ Failed to update. Try again.');

  currentUser.password = newHash;
  document.getElementById('old-password').value = '';
  document.getElementById('new-password').value = '';
  setSuccess('change-pass-success', '✅ Password changed!');
});

/* ══════════════════════════════════════════════════════════
   PROGRESS & STATS
   ══════════════════════════════════════════════════════════ */
async function loadProgress() {
  if (!currentUser) return;
  document.getElementById('stat-sessions').textContent    = currentUser.sessions    || 0;
  document.getElementById('stat-messages').textContent    = currentUser.messages    || 0;
  document.getElementById('stat-corrections').textContent = currentUser.corrections || 0;
  document.getElementById('stat-streak').textContent      = currentUser.streak      || 0;

  const sessions = await dbQuery('sessions', 'GET', null,
    `?user_id=eq.${currentUser.id}&order=created_at.desc&limit=20`);
  const list = document.getElementById('history-list');
  if (!sessions || !sessions.length) {
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
  await dbQuery('sessions', 'POST', {
    user_id: currentUser.id, messages: sessionMessages,
    corrections: sessionCorrections, duration
  });
  const newSessions    = (currentUser.sessions    || 0) + 1;
  const newMessages    = (currentUser.messages    || 0) + sessionMessages;
  const newCorrections = (currentUser.corrections || 0) + sessionCorrections;
  await dbQuery('users', 'PATCH', {
    sessions: newSessions, messages: newMessages,
    corrections: newCorrections, last_active: new Date().toISOString()
  }, `?id=eq.${currentUser.id}`);
  currentUser.sessions = newSessions;
  currentUser.messages = newMessages;
  currentUser.corrections = newCorrections;
  sessionMessages = 0; sessionCorrections = 0; sessionStartTime = Date.now();
}

async function updateStreak() {
  if (!currentUser) return;
  const lastActive = currentUser.last_active;
  let streak = currentUser.streak || 0;
  if (lastActive) {
    const daysDiff = Math.floor((Date.now() - new Date(lastActive)) / 86400000);
    if (daysDiff === 1) streak++;
    else if (daysDiff > 1) streak = 1;
  }
  await dbQuery('users', 'PATCH', { streak, last_active: new Date().toISOString() }, `?id=eq.${currentUser.id}`);
  currentUser.streak = streak;
  document.getElementById('stat-streak').textContent = streak;
}

/* ══════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════ */
const APP_TABS = ['voice','analyze','topics','progress','voice-settings'];
APP_TABS.forEach(t => {
  document.getElementById('tab-' + t).addEventListener('click', () => switchTab(t));
});
function switchTab(name) {
  APP_TABS.forEach(t => {
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
    if (esc.includes('You said:') || esc.includes('தமிழில்:'))
      return '<div class="tamil-line">' + esc + '</div>';
    return '<div class="reply-line">' + esc + '</div>';
  });
  div.innerHTML = '<div class="msg-label">🐉 DRAGON</div>' + formatted.join('');
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function addUserMsg(text) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  const name = currentUser?.name?.split(' ')[0] || 'YOU';
  div.className = 'msg user';
  div.innerHTML = '<div class="msg-label">▶ ' + escapeHtml(name) + '</div>' + escapeHtml(text);
  box.appendChild(div); box.scrollTop = box.scrollHeight;
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
    btn.textContent = '🎙';
    status.textContent = continuousMode ? '⏸ PAUSED — TAP ORB TO STOP' : 'TAP ORB → HANDS-FREE CHAT';
    stopVolAnimation();
  } else if (state === 'listening') {
    btn.textContent = '⏹'; btn.classList.add('listening');
    rings.forEach(r => r && r.classList.add('listening'));
    status.textContent = '🔴 SPEAK — PAUSE 2s TO SEND';
    status.classList.add('active'); volBars.classList.add('visible'); startVolAnimation();
  } else if (state === 'thinking') {
    btn.textContent = '⏳'; status.textContent = '💭 THINKING...'; status.classList.add('active'); stopVolAnimation();
  } else if (state === 'speaking') {
    btn.textContent = '🔊'; btn.classList.add('speaking');
    rings.forEach(r => r && r.classList.add('speaking'));
    status.textContent = '🟢 DRAGON SPEAKING...';
    status.classList.add('speaking'); volBars.classList.add('visible'); startSpeakAnimation();
  }
}
function startVolAnimation() {
  const ids = ['b1','b2','b3','b4','b5'], base = [8,14,20,14,8];
  function frame() {
    ids.forEach((id,i) => { const el = document.getElementById(id); if (el) el.style.height = (base[i] + Math.random()*14)+'px'; });
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
  utter.lang = 'en-US'; utter.rate = voiceRate; utter.pitch = voicePitch;
  if (selectedVoice) {
    utter.voice = selectedVoice;
  } else {
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.name.toLowerCase().includes('microsoft david')) ||
      voices.find(v => v.lang === 'en-US' && v.name.toLowerCase().includes('david')) ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;
  }
  utter.onend = onSpeechEnd; utter.onerror = onSpeechEnd;
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
   SPEECH RECOGNITION
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
  recognition.continuous = true;
  recognition.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
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
   GEMINI API
   ══════════════════════════════════════════════════════════ */
async function callGeminiWithModel(modelName, messages, maxTokens) {
  if (!GEMINI_KEY) throw new Error('Gemini API key not loaded. Check Supabase config table.');
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
    catch(e) { workingModel = null; }
  }
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try { const r = await callGeminiWithModel(model, messages, maxTokens); workingModel = model; return r; }
    catch (err) { lastErr = err; }
  }
  throw new Error('AI error: ' + lastErr?.message);
}
function extractSpeakText(reply) {
  const m = reply.match(/Say it like this:\s*"([^"]+)"/i);
  if (m) return m[1];
  const lines = reply.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const out = [];
  for (const line of lines) {
    if (line.includes('You said:') || line.includes('தமிழில்:')) continue;
    const q = line.match(/"([^"]+)"/);
    if (q) return q[1];
    out.push(line);
    if (out.length >= 2) break;
  }
  return out.join(' ').slice(0, 200);
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
    addAIMsg('⚠ ' + err.message);
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
    addAIMsg('⚠ ' + err.message);
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
  if (!text) { alert('Please enter some text!'); return; }
  const btn = document.getElementById('btn-analyze');
  const resultCard = document.getElementById('result-card');
  btn.disabled = true; btn.textContent = '⏳ Analyzing...'; resultCard.style.display = 'none';
  const prompts = {
    grammar:    'Check grammar only. List each error with correction. Grammar Score /10. Be friendly.',
    vocabulary: 'Analyze vocabulary. Suggest stronger words. Vocabulary Score /10.',
    fluency:    'Analyze fluency. Give tips. Fluency Score /10.',
    all:        'Full analysis:\n1. Grammar Score /10\n2. Vocabulary Score /10\n3. Fluency Score /10\n4. Overall /10\n5. Top 3 tips. Plain text only.'
  };
  try {
    const msgs = [{ role: 'user', content: prompts[selectedFeedbackType] + '\n\nText:\n"' + text + '"' }];
    const reply = await callGemini(msgs, 700);
    resultCard.innerHTML = reply.replace(/\n/g,'<br>');
    resultCard.style.display = 'block';
  } catch (err) {
    resultCard.innerHTML = '⚠ ' + err.message;
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
    const starter = [{ role: 'user', content: `Start an English practice conversation about: "${topic}". One short opening line, then ask one simple question. Be casual.` }];
    try {
      const reply = await callGemini(starter, 160);
      chatHistory.push({ role: 'assistant', content: reply });
      addAIMsg(reply); speakText(reply);
    } catch (err) { addAIMsg('⚠ ' + err.message); setOrbState('idle'); }
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
  let best = sorted.findIndex(v => v.name.toLowerCase().includes('microsoft david'));
  if (best < 0) best = sorted.findIndex(v => v.lang === 'en-US');
  if (best >= 0) sel.value = best;
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
  u.voice = v; u.rate = parseFloat(document.getElementById('voice-rate').value);
  u.pitch = parseFloat(document.getElementById('voice-pitch').value);
  window.speechSynthesis.speak(u);
});
document.getElementById('btn-apply-voice').addEventListener('click', () => {
  const sel = document.getElementById('voice-select');
  const voices = window.speechSynthesis.getVoices();
  const sorted = [...voices.filter(v => v.lang.startsWith('en')), ...voices.filter(v => !v.lang.startsWith('en'))];
  selectedVoice = sorted[parseInt(sel.value)] || null;
  voiceRate  = parseFloat(document.getElementById('voice-rate').value);
  voicePitch = parseFloat(document.getElementById('voice-pitch').value);
  useCustomVoice = false;
  document.getElementById('current-voice-mode').textContent =
    'MODE: SYSTEM — ' + (selectedVoice?.name || 'Default') + ' | RATE ' + voiceRate.toFixed(2);
});
document.getElementById('upload-label').addEventListener('click', () => document.getElementById('custom-voice-file').click());
document.getElementById('upload-label').addEventListener('dragover', e => { e.preventDefault(); document.getElementById('upload-label').classList.add('drag-over'); });
document.getElementById('upload-label').addEventListener('dragleave', () => document.getElementById('upload-label').classList.remove('drag-over'));
document.getElementById('upload-label').addEventListener('drop', e => {
  e.preventDefault(); document.getElementById('upload-label').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) handleVoiceFile(f);
});
document.getElementById('custom-voice-file').addEventListener('change', function() { if (this.files[0]) handleVoiceFile(this.files[0]); });
function handleVoiceFile(file) {
  if (customVoiceURL) URL.revokeObjectURL(customVoiceURL);
  customVoiceURL = URL.createObjectURL(file); useCustomVoice = true;
  document.getElementById('custom-file-name').textContent   = file.name;
  document.getElementById('custom-voice-label').textContent = '✅ ' + file.name;
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
  document.getElementById('custom-file-name').textContent = 'No file selected';
  document.getElementById('custom-voice-file').value = '';
  document.getElementById('current-voice-mode').textContent = 'MODE: SYSTEM VOICE';
});
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', populateVoiceList);
  setTimeout(populateVoiceList, 600);
}
window.addEventListener('beforeunload', () => saveSessionToDb());

/* ══════════════════════════════════════════════════════════
   API KEY SETUP SCREEN (first time after login)
   ══════════════════════════════════════════════════════════ */
document.getElementById('btn-show-setup-key').addEventListener('click', () => {
  const inp = document.getElementById('setup-api-key');
  const btn = document.getElementById('btn-show-setup-key');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
});

document.getElementById('btn-save-setup-key').addEventListener('click', async () => {
  const key  = document.getElementById('setup-api-key').value.trim();
  const hint = document.getElementById('setup-key-hint');
  const btn  = document.getElementById('btn-save-setup-key');

  hint.textContent = ''; hint.style.color = '#888';

  if (!key) {
    hint.textContent = '⚠ Please paste your API key.';
    hint.style.color = '#ff6060'; return;
  }
  if (!key.startsWith('AIza')) {
    hint.textContent = '⚠ Key should start with AIza...';
    hint.style.color = '#ff6060'; return;
  }

  btn.disabled = true; btn.textContent = '⏳ Verifying...';
  hint.textContent = 'Checking your key with Google...'; hint.style.color = '#888';

  // Verify key works
  try {
    const testUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 5 }
      })
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const err = await res.json();
      hint.textContent = '❌ Invalid key: ' + (err.error?.message || 'Check your key and try again');
      hint.style.color = '#ff6060';
      btn.disabled = false; btn.textContent = '⚡ SAVE & START TALKING';
      return;
    }
  } catch (e) { /* network issue — proceed anyway */ }

  // Save key to user's Supabase row
  GEMINI_KEY = key;
  await dbQuery('users', 'PATCH', { gemini_key: key }, `?id=eq.${currentUser.id}`);
  currentUser.gemini_key = key;

  hint.textContent = '✅ Key saved! Launching Dragon...';
  hint.style.color = '#1ad96b';
  btn.textContent = '✅ Saved!';

  setTimeout(() => {
    document.getElementById('screen-apikey').classList.add('hidden');
    // Now fully launch the app
    document.getElementById('screen-app').classList.remove('hidden');
    const name = currentUser.name?.split(' ')[0] || 'there';
    document.getElementById('user-name-display').textContent = name;
    const avatarEl = document.getElementById('user-avatar');
    avatarEl.textContent = name[0].toUpperCase();
    setupSpeechRecognition();
    loadProgress();
    updateStreak();
    const welcome = `Hey ${name}! I'm Dragon, your English teacher. Talk to me in Tamil, Tanglish, or English. What's on your mind today?`;
    addAIMsg(welcome);
    speakText(welcome);
    sessionStartTime = Date.now();
    btn.disabled = false; btn.textContent = '⚡ SAVE & START TALKING';
  }, 1000);
});

document.getElementById('btn-apikey-logout').addEventListener('click', async () => {
  currentUser = null; GEMINI_KEY = '';
  localStorage.removeItem('dragon_user_id');
  document.getElementById('screen-apikey').classList.add('hidden');
  document.getElementById('screen-login').style.display = 'flex';
  showForm('form-signin');
});
