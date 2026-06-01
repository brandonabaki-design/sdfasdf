# AISA Student Hub — Setup

End-to-end first slice: student signs in with their `aisa.sch.ae` Google account,
clicks **I'm here**, and the event lands in a Google Sheet. Workspace Studio /
Apps Script can then crunch that sheet.

Set up the backend first (steps 1–2), then the frontend (steps 3–4).

---

## 1. Create the Google OAuth client ID

1. Go to https://console.cloud.google.com/ → create or pick a project owned by
   your `aisa.sch.ae` Workspace.
2. **APIs & Services → OAuth consent screen**
   - User type: **Internal** (restricts to the Workspace automatically).
   - App name: `AISA Student Hub`, support email: yours.
   - Scopes: leave default (`openid`, `email`, `profile`).
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - Authorized JavaScript origins:
     - `http://localhost:8000` (for local testing)
     - `https://<your-github-username>.github.io` (for GitHub Pages)
   - Authorized redirect URIs: leave empty (we use the JS library, not redirects).
4. Copy the **Client ID** (looks like `1234-abc.apps.googleusercontent.com`).

---

## 2. Deploy the Apps Script backend

1. Open https://script.google.com/ and create a new project.
2. Replace the contents of `Code.gs` with the file at `apps-script/Code.gs`
   in this repo.
3. **Project Settings (gear icon) → Script properties → Add script property**:
   - `GOOGLE_CLIENT_ID` = the Client ID from step 1.
   - `TEACHER_EMAILS` = comma-separated list of teacher accounts allowed to
     create prompts (e.g. `you@aisa.sch.ae,other.teacher@aisa.sch.ae`).
   - `GEMINI_API_KEY` = API key from https://aistudio.google.com/app/apikey.
     Used to generate AI feedback on student responses. If unset, responses
     are still saved but feedback fields stay blank.
   - (Optional) `GEMINI_MODEL` = model name (default `gemini-2.5-flash`).
   - (Optional) `STUDENT_RESOURCE_MESSAGE` = the message shown to a student
     when their response triggers Gemini's safety filter. If unset, a default
     message pointing them to the school counsellor is used.
   - (Optional) `ALERT_EMAIL` = additional CC for distress alerts (e.g. a
     school admin). The teacher who created the prompt is always the primary
     recipient.
   - (Optional) `SHEET_ID` = an existing spreadsheet ID if you want to reuse one.
     If omitted, the first request creates a new spreadsheet called
     *AISA Student Hub - Events* in your Drive.

> The first time the script sends an email, you'll be re-prompted to
> authorize a new scope (Gmail send). Click through; without it, distress
> alerts will silently fail (the failure is logged in Executions).
4. **Deploy → New deployment → Type: Web app**
   - Description: `v1`
   - Execute as: **Me** (your aisa.sch.ae account)
   - Who has access: **Anyone**
     (this is OK — every request must carry a valid Google ID token issued for
     our Client ID and from the `aisa.sch.ae` domain, otherwise the server
     rejects it.)
5. Authorize the prompts. Copy the **Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfy.../exec`.
6. Run `doGet` once from the editor (Run menu) to trigger the spreadsheet
   creation and grab the link from the logs — or just wait for the first
   `I'm here` click to create it.

---

## 3. Wire up `config.js`

Edit `config.js` in this repo and paste in your two IDs:

```js
window.AISA_CONFIG = {
  GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy.../exec',
  ALLOWED_HD: 'aisa.sch.ae',
};
```

Test locally:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

---

## 4. Publish on GitHub Pages

1. Push this branch to GitHub.
2. Repo **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: `main` (merge this branch first) or pick the current branch
   - Folder: `/ (root)`
3. Wait a minute; your page is at `https://<user>.github.io/<repo>/`.
4. Add that exact URL as an Authorized JavaScript origin in the OAuth client
   (step 1.3) if you didn't already.

---

## Data model

The Apps Script auto-creates two tabs in *AISA Student Hub - Events*:

**`StudentEvents`** — one row per student action.

| column            | source                                       |
|-------------------|----------------------------------------------|
| server_timestamp  | when Apps Script wrote the row               |
| email             | from the verified ID token                   |
| name              | from the verified ID token                   |
| google_sub        | stable Google user ID (use this as the key)  |
| action            | string from the client (e.g. `im_here`)      |
| client_timestamp  | client-side ISO timestamp                    |

**`Prompts`** — one row per teacher-created prompt.

| column         | source                                          |
|----------------|-------------------------------------------------|
| id             | UUID generated by Apps Script                   |
| created_at     | when the prompt was published                   |
| teacher_email  | from the verified ID token (must be allow-listed)|
| title          | from the teacher form                           |
| body           | from the teacher form                           |
| status         | `active` (the only state for now)               |

**`Responses`** — one row per student submission.

| column           | source                                              |
|------------------|-----------------------------------------------------|
| id               | UUID generated by Apps Script                       |
| created_at       | when the response was submitted                     |
| student_email    | from the verified ID token                          |
| student_name     | from the verified ID token                          |
| google_sub       | stable Google user ID for the student               |
| prompt_id        | the prompt this response is for                     |
| prompt_title     | snapshot of the prompt title at submit time         |
| body             | the student's response                              |
| ai_feedback      | feedback generated by Gemini on submit              |
| ai_reviewed_at   | when the feedback was generated                     |
| ai_model         | model used, or `safety_blocked` when filter triggered |
| flagged          | `TRUE` if Gemini's classifier or safety filter flagged distress |
| flag_reason      | brief explanation from the classifier (teacher-only) |

## Re-deploying after backend changes

When `apps-script/Code.gs` changes, re-deploy as a new **version** of the
existing deployment so the URL stays the same:

1. Apps Script editor → **Deploy → Manage deployments**
2. Click the ✏️ edit icon on your existing Web app deployment.
3. **Version** dropdown → **New version**, optional description.
4. **Deploy**. The Web app URL is unchanged; `config.js` doesn't need updates.

---

## Next iterations to consider

- Add real student activities (each one POSTs a new `action` + payload).
- Add a teacher-only page (check `email` against an allow-list in Apps Script).
- Pipe the sheet into Workspace Studio / Gemini for the AI review loop you
  described: teacher designs → student works → AI checks → AI feedback → AI
  informs teacher.
