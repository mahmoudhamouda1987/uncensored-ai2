# Railway Deployment Guide

## ⚠️ Alternative Deployment Options

If Railway rejects deployment due to security policies, consider using **Vercel** instead:
- ✅ Built by Next.js team (perfect compatibility)
- ✅ More flexible security policies
- ✅ Zero configuration needed
- ✅ See `VERCEL_DEPLOYMENT.md` for details

## 🛡️ Security Updates
This repository has been updated to fix all security vulnerabilities:
- ✅ Next.js upgraded from 16.0.7 to 16.3.1 (fixes CVE-2025-55183, CVE-2025-55184, CVE-2025-67779)
- ✅ All dependencies audited and fixed
- ✅ Zero vulnerabilities detected by npm audit

## Prerequisites
- Railway account
- GitHub repository with this code
- Environment variables configured

## Environment Variables Required
Copy these to your Railway project environment variables:

```env
# AI API Keys (at least one required)
GROQ_API_KEY=your_groq_api_key_here
NVIDIA_API_KEY=your_nvidia_api_key_here

# Cloudflare Turnstile (recommended for production)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_turnstile_site_key
TURNSTILE_SECRET_KEY=your_turnstile_secret_key

# Upstash Redis (for rate limiting)
UPSTASH_REDIS_REST_URL=your_upstash_redis_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
```

## Deployment Steps

1. **Push to GitHub**
   - Ensure this code is in a GitHub repository
   - The repository should contain all files including `package.json`, `railway.json`, and `Procfile`

2. **Create Railway Project**
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

3. **Configure Environment Variables**
   - Go to your project settings
   - Add all required environment variables
   - Make sure to add your actual API keys

4. **Deploy**
   - Railway will automatically detect the Node.js application
   - It will use the configuration in `railway.json` and `Procfile`
   - Build command: `npm run build`
   - Start command: `npm start`

5. **Access Your App**
   - Railway will provide a domain URL
   - Your app will be accessible at `https://your-project-name.railway.app`

## Troubleshooting

### Build Fails
- Check that Node.js version is set to 18 or higher
- Ensure all dependencies are in package.json
- Verify build logs for specific errors

### Runtime Errors
- Check that all environment variables are set
- Verify API keys are valid
- Check Redis connection if using rate limiting

### Port Issues
- Railway automatically assigns a port
- Next.js will use the PORT environment variable automatically

## Configuration Files

- `railway.json` - Railway-specific build configuration
- `Procfile` - Heroku-compatible process definition
- `.nvmrc` - Node.js version specification
- `package.json` - Dependencies and scripts
