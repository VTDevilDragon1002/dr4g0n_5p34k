# DR4G0N 5P34K — Deploy Guide

## What You Have
- Google Login (Firebase) ✅
- User data saved in Supabase ✅  
- Gemini AI (user's own free key) ✅
- Voice, Analyze, Topics, Progress — all features ✅

---

## STEP 1 — Fix Supabase Tables (ONE TIME)

1. Go to **supabase.com** → your project `libioplsnfabkjpsgbwf`
2. Click **SQL Editor** → **New Query**
3. Paste the contents of `SUPABASE_SETUP.sql` and click **Run**
4. You should see "Success" — done!

---

## STEP 2 — Fix Firebase Authorized Domains

This is the #1 reason Google Login fails on Vercel!

1. Go to **console.firebase.google.com**
2. Select project **dr4g0n-5p34k**
3. Left menu → **Authentication** → **Settings** tab
4. Scroll to **Authorized domains**
5. Click **Add domain** and add:
   - `your-app-name.vercel.app` (your actual Vercel URL)
   - `localhost` (already there)

---

## STEP 3 — Deploy to Vercel

### Option A: GitHub (Recommended)
1. Push this folder to your GitHub repo
2. Go to **vercel.com** → Import → select your repo
3. No build settings needed — just click Deploy
4. Copy your Vercel URL (e.g. `dr4g0n-5p34k.vercel.app`)
5. Add that URL to Firebase Authorized Domains (Step 2)

### Option B: Vercel CLI
```bash
npm i -g vercel
cd dr4g0n_final
vercel --prod
```

---

## HOW IT WORKS FOR USERS

1. User visits your site
2. Clicks **Continue with Google** → picks their Google account
3. **First time only:** paste their free Gemini API key from aistudio.google.com
4. Key is saved → next login they go straight to the app
5. All their progress saved automatically

---

## TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| "auth/unauthorized-domain" | Add your Vercel URL to Firebase Authorized Domains |
| Google popup blocked | Tell user to allow popups for the site |
| API key not saving | Run SUPABASE_SETUP.sql to create tables |
| "All models failed" | User's Gemini key is wrong or expired |

