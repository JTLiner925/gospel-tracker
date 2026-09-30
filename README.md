# Gospel Tracker

A phone-friendly web app for tracking gospel conversations while out fishing at apartment complexes.

- **Log** – choose the team members out today and the complex, building and apartment number, then tap what happened at the door. For a conversation, it records the person, what was shared (Care through Prayer, 15-second testimony, 3 Circles, Jesus Story, DBS), which tools you trained them on, the red/yellow/green light, the response (rejected / interested / accepted Christ) and the follow-up needed.
- **Follow-ups** – who needs a visit, what kind, who's assigned, and when it's due. Tap ✓ Done.
- **People** – search everyone. Each person has a timeline of every conversation and follow-up.
- **Map** – every door the team has knocked, on a street map. Pins are colored green/yellow/red by light, ✝ marks someone who accepted Christ, and a purple dot marks an open follow-up. Tap a pin to see the person, what was shared, who went and the next step. Filter by date, place, conversations only, accepted Christ, open follow-ups, or "no answer / come back" for doors to revisit. The **Door grid** tab shows the same doors as tiles by building or street.
- **Location** – each door is pinned using the phone's GPS when it's logged. The first time, the phone asks to allow location for the site: tap **Allow**. Doors logged with location off still count everywhere, but they don't appear on the map.
- **Deleting a person** – open the person → Edit details → Delete. Their details, prayer request, follow-ups and conversation notes are removed. Their door knocks stay in the map and stats without a name.
- **Stats** – doors knocked, conversations, gospel shares, salvations and breakdowns. **Copy report** puts a text summary on the clipboard for leaders.
- **Works offline** – entries save on the phone and sync automatically when signal comes back.
- **Team passcode** – the database returns nothing without it.

The code is hosted free on **GitHub Pages** and the data lives in **Supabase**, a free Postgres database. The code can be public because it holds no data.

---

## One-time setup (about 20 minutes)

### 1. Create the database (Supabase)
1. Go to <https://supabase.com>, sign up and click **New project**. Pick any name and a strong database password, and choose a US region.
2. When it finishes, open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this folder and copy all of it. **Change `CHANGE-ME-to-a-long-phrase`** to your team passcode. A short phrase is best, e.g. `fishers of men 419`.
4. Paste it into the editor and click **Run**. It should say "Success".
5. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Connect the app to the database
Open `config.js` and paste both values:
```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

### 3. Put it on GitHub and turn on Pages
1. On github.com click **New repository**, name it `gospel-tracker` and make it **Public**. Free GitHub Pages requires a public repo. That's fine here because no conversation data is stored in the code.
2. Upload every file in this folder: on the repo page, choose **Add file → Upload files** and drag them all in, keeping the `supabase` folder. Or use GitHub Desktop.
3. Go to **Settings → Pages**, set **Source** to "Deploy from a branch", choose **Branch** `main` / `(root)`, and click **Save**.
4. After a minute or two the app will be live at `https://YOUR-USERNAME.github.io/gospel-tracker/`.

### 4. First use
1. Open the link, enter the passcode and go to **⚙︎ Settings**.
2. Add your team members, then your places: choose **Apartment complex** or **Neighborhood (houses)** for each.
3. Send the link and passcode to the team, **separately** (don't put the passcode in the same text as the link).
4. On each phone, allow **location** when asked so doors show on the map.
5. On iPhone: in Safari, tap Share → **Add to Home Screen**. On Android: in Chrome, tap ⋮ → **Add to Home screen**. It then opens like a normal app.

---

## Good practices for protecting people's information
- Only record what you need to follow up well. First names are often enough.
- Change the passcode (Settings → Team passcode) when someone leaves the team.
- **Lock this phone** (in Settings) signs a borrowed or shared phone out.
- The Supabase dashboard is the "master key": keep that login to yourself and one other leader.
- Supabase's free tier pauses a project after about a week with no activity. Just open the dashboard and click **Restore** if that happens.

## Making changes
- Edit the dropdown options (methods, follow-up types, etc.) at the top of `app.js`.
- After uploading changes to GitHub, phones will pick them up on the second time they open the app. This is because the app is cached for offline use.
- Backups: Supabase → **Table Editor** → pick a table → **Export to CSV**.
