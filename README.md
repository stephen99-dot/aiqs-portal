# AI QS — Customer Portal

A client-facing web app for AI-powered quantity surveying. Customers can create accounts, upload construction drawings, submit project briefs, and track their BOQ orders.

## Tech Stack
- **Frontend:** React 18 + React Router
- **Backend:** Express.js REST API
- **Database:** SQLite (via better-sqlite3)
- **Auth:** JWT tokens + bcrypt
- **Uploads:** Multer (local file storage)

---

## 🚀 Replit Setup (Step by Step)

### 1. Create a new Replit
- Go to [replit.com](https://replit.com) and click **Create Repl**
- Choose **Node.js** as the template
- Name it `aiqs-portal` (or whatever you like)

### 2. Upload the project files
- Delete any default files Replit created
- Upload ALL the files from this project, keeping the folder structure:
  ```
  ├── .replit
  ├── package.json
  ├── public/
  │   └── index.html
  ├── server/
  │   ├── index.js
  │   ├── database.js
  │   ├── routes.js
  │   └── auth.js
  └── src/
      ├── index.js
      ├── App.js
      ├── styles.css
      ├── components/
      │   └── Layout.js
      ├── context/
      │   └── AuthContext.js
      ├── pages/
      │   ├── LoginPage.js
      │   ├── RegisterPage.js
      │   ├── DashboardPage.js
      │   ├── NewProjectPage.js
      │   └── ProjectDetailPage.js
      └── utils/
          └── api.js
  ```

### 3. Set up Secrets (Environment Variables)
- In Replit, click the **Secrets** tab (lock icon in the sidebar)
- Add these secrets:
  - `JWT_SECRET` = any random string (e.g. `aiqs-secret-key-2025-change-this`)
  - `NODE_ENV` = `production`
  - `PORT` = `3001`

### 4. Install dependencies
- Open the **Shell** tab and run:
  ```bash
  npm install
  ```

### 5. Build and run
- In the Shell, run:
  ```bash
  npm run build
  npm start
  ```
- Or just hit the **Run** button — the `.replit` config handles it

### 6. Your app is live!
- Replit will show your app URL (e.g. `https://aiqs-portal.yourname.repl.co`)
- You can connect a custom domain in Replit's settings

---

## 📝 How It Works

### For Customers:
1. **Register** — Create an account with name, email, company
2. **New Project** — Fill in project details and upload drawings
3. **Dashboard** — See all submitted projects and their status
4. **Project Detail** — View progress, uploaded files, add more files

### For You (Admin):
Currently you'd update project statuses directly in the SQLite database.
The next phase would be an admin panel where you can:
- View all incoming projects
- Update statuses (submitted → in review → in progress → completed)
- Upload completed BOQ files for customers to download
- Send notifications

---

## 🔧 Customisation

### Branding
All colors, fonts, and styling are in `src/styles.css` using CSS variables.
The key variables to tweak are at the top of the file.

### Email Notifications
To add email notifications when projects are submitted, you could integrate:
- **Resend** (free tier) — add to server/routes.js
- **SendGrid** — good free tier
- Or connect to your existing Pipedream workflow via webhook

### File Storage
Currently files are stored locally on the Replit server.
For production, consider migrating to:
- **Cloudflare R2** (free tier, S3-compatible)
- **AWS S3**
- **Google Drive API** (if you want files to land in your Drive)

---

## 📁 Project Structure

```
server/
  index.js       — Express server, serves API + React build
  database.js    — SQLite schema and connection
  routes.js      — All API endpoints (auth, projects, files)
  auth.js        — JWT token generation and middleware

src/
  App.js         — React router setup
  styles.css     — All application styles
  context/
    AuthContext.js — Authentication state management
  components/
    Layout.js     — Sidebar navigation and app shell
  pages/
    LoginPage.js       — Sign in
    RegisterPage.js    — Create account
    DashboardPage.js   — Project list + stats
    NewProjectPage.js  — Upload form
    ProjectDetailPage.js — Project detail + progress
  utils/
    api.js        — API fetch helper with auth headers
```
