# GitHub Setup Guide for Railway Deployment

## 🚨 Current Issue
Railway only sees `.gitattributes` in your repository, meaning the source code files aren't uploaded correctly.

## ✅ Step-by-Step Fix

### 1. Extract the Zip File
Extract `Uncensored-Ai-proper.zip` to get the `Uncensored-Ai` folder with all files.

### 2. Create a New GitHub Repository
1. Go to GitHub.com
2. Click "+" → "New repository"
3. Name it: `uncensored-ai` (or any name you prefer)
4. Make it **Public** or **Private** (both work)
5. **Do NOT** initialize with README, .gitignore, or license
6. Click "Create repository"

### 3. Upload Files to GitHub
**Option A: GitHub Web Interface (Easiest)**
1. In your new repository, click "uploading an existing file"
2. Drag and drop ALL files from the extracted `Uncensored-Ai` folder
3. **Important**: Upload the CONTENTS of the folder, not the folder itself
4. Make sure these files are included:
   - `package.json`
   - `railway.json`
   - `Procfile`
   - `.nvmrc`
   - `src/` folder (with all subfolders)
   - `public/` folder
   - All other files from the zip
5. Click "Commit changes"

**Option B: Git Command Line**
```bash
cd path/to/extracted/Uncensored-Ai
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/uncensored-ai.git
git push -u origin main
```

### 4. Verify GitHub Repository
Check that your GitHub repository contains:
- ✅ `package.json` in the root
- ✅ `railway.json` in the root
- ✅ `Procfile` in the root
- ✅ `.nvmrc` in the root
- ✅ `src/` folder with `app/` subfolder
- ✅ `public/` folder
- ✅ All other configuration files

### 5. Deploy to Railway
1. Go to Railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your new repository
4. Railway should now detect it as a Node.js app

## 🔍 Troubleshooting

### If Railway Still Fails
Check that your GitHub repository root contains these essential files:
```
your-repo/
├── package.json       # ← MUST be in root
├── railway.json       # ← MUST be in root  
├── Procfile           # ← MUST be in root
├── .nvmrc             # ← MUST be in root
├── src/
│   └── app/
├── public/
└── ...other files
```

### Common Mistakes
❌ Uploading the `Uncensored-Ai` folder instead of its contents
❌ Creating a subfolder structure like `repo/Uncensored-Ai/files`
❌ Missing `package.json` in the repository root
❌ Files are in a different branch than `main`

## 📋 File Checklist
Before deploying, ensure these files exist in your GitHub repository root:
- [ ] package.json
- [ ] railway.json
- [ ] Procfile
- [ ] .nvmrc
- [ ] next.config.mjs
- [ ] tailwind.config.js
- [ ] postcss.config.js
- [ ] .gitignore
- [ ] src/ folder
- [ ] public/ folder
- [ ] lib/ folder
