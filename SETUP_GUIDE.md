# DR4G0N 5P34K — Full Setup Guide
## Professional Version with Google Login + Database

---

## WHAT YOU NEED (All 100% FREE)
1. Firebase account (free) — Google login
2. Supabase account (free) — Database
3. Vercel account (free) — Website hosting
4. Gemini API key (free) — AI engine (users get their own)

---

## STEP 1: FIREBASE SETUP (Google Login)

1. Go to: https://console.firebase.google.com
2. Click "Add project" → Name it "dr4g0n-5p34k" → Continue
3. Disable Google Analytics → Create project
4. Click "Authentication" → "Get Started"
5. Click "Google" provider → Enable it → Save
6. Click the gear ⚙️ → "Project Settings"
7. Scroll down → "Your apps" → Click web icon `</>`
8. Register app name "dr4g0n-5p34k-web" → Register app
9. **COPY the firebaseConfig object**

**Paste into index.html:**
Find this section and replace with your values:
```javascript
const firebaseConfig = {
  apiKey:            "AIza...",           // ← your values
  authDomain:        "your-app.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123"
};
```

10. In Firebase Console → Authentication → Settings → Authorized domains
    → Add your Vercel domain (after you deploy)

---

## STEP 2: SUPABASE SETUP (Database)

1. Go to: https://supabase.com → Sign up free
2. New Project → Name: "dr4g0n-5p34k" → Set a DB password → Create
3. Wait ~2 minutes for setup
4. Go to "SQL Editor" → "New query" → Paste and run this SQL:

```sql
-- Users table
CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  uid         TEXT UNIQUE NOT NULL,
  email       TEXT,
  name        TEXT,
  photo       TEXT,
  gemini_key  TEXT,
  sessions    INT DEFAULT 0,
  messages    INT DEFAULT 0,
  corrections INT DEFAULT 0,
  streak      INT DEFAULT 0,
  last_active TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions history table  
CREATE TABLE sessions (
  id          BIGSERIAL PRIMARY KEY,
  uid         TEXT NOT NULL,
  messages    INT DEFAULT 0,
  corrections INT DEFAULT 0,
  duration    INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Allow public access (your app uses anon key)
ALTER TABLE users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON users   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sessions FOR ALL USING (true) WITH CHECK (true);
```

5. Go to Settings → API
6. **COPY "Project URL"** and **"anon public" key**

**Paste into assets/script.js:**
```javascript
const SUPABASE_URL  = 'https://xxxx.supabase.co';  // ← your URL
const SUPABASE_ANON = 'eyJhbGc...';                 // ← your anon key
```

---

## STEP 3: DEPLOY TO VERCEL (Free Hosting)

1. Go to: https://vercel.com → Sign up with GitHub
2. Push your project to GitHub:
   ```
   git init
   git add .
   git commit -m "DR4G0N 5P34K launch"
   git remote add origin https://github.com/YOUR_USERNAME/dr4g0n-5p34k.git
   git push -u origin main
   ```
3. In Vercel → "New Project" → Import your GitHub repo
4. Framework: "Other" → Deploy
5. Your site is live at: https://dr4g0n-5p34k.vercel.app

6. **Go back to Firebase** → Authentication → Settings → Authorized domains
   → Add: `dr4g0n-5p34k.vercel.app`

---

## STEP 4: HOW USERS LOG IN (The Full Flow)

**First time user:**
1. Opens your website
2. Clicks "Continue with Google" → Google popup → Selects their account
3. Sees "ONE-TIME SETUP" screen
4. Clicks "Open Google AI Studio" → Gets their free key (30 seconds)
5. Pastes key → Clicks "SAVE & LAUNCH"
6. **App opens. Key is saved forever in database.**

**Returning user:**
1. Opens your website
2. Clicks "Continue with Google"
3. **App opens immediately** — no key entry needed

---

## WHAT THE DATABASE STORES PER USER
- Their Google account info (name, email, photo)
- Their Gemini API key (encrypted in transit)
- Total sessions, messages, corrections
- Daily streak
- Session history (last 20 sessions)

---

## SECURITY NOTES
- Gemini API keys are stored in Supabase (not in code)
- Firebase handles all Google OAuth (industry standard)
- No passwords stored anywhere
- Each user's key is tied to their Google account

---

## FILES OVERVIEW
```
dr4g0n_5p34k_pro/
├── index.html          ← Main app (edit Firebase config here)
├── assets/
│   ├── style.css       ← All styles
│   └── script.js       ← All logic (edit Supabase config here)
├── backend/
│   ├── server.js       ← Node.js API server
│   ├── package.json    ← Dependencies
│   └── .env.example    ← Copy to .env and fill in
├── vercel.json         ← Vercel deployment config
└── SETUP_GUIDE.md      ← This file
```
