# Website Downloader (Production Release)

A modern, high-speed website scraper and asset extraction tool with support for single and bulk URL downloads, recursive link crawling, asset exclusions, structured markdown text extraction, and automated SEO audits.

---

## 🚀 Quick Start (Windows)

### Step 1: Run Setup (Once)
Double-click **`setup.bat`**:
* Verifies Node.js & npm.
* Installs all dependencies into `node_modules` locally so the app is **100% offline-ready**.
* Automatically generates **`start.bat`**.
* Optionally starts the application immediately.

### Step 2: Everyday Use
Whenever you want to use the app, simply double-click **`start.bat`**:
* Launches the server in the background instantly (no installation delays).
* Automatically opens **`http://localhost:3000`** in your default browser.
* Provides a clean dashboard with options to Open Browser, Stop, Restart, or Exit.
* Automatically shuts down when you close all browser tabs.

---

## 💻 Manual Launch (Any OS)

```bash
# 1. Install dependencies
npm install --omit=dev

# 2. Start the server
npm start

# 3. Open your browser
http://localhost:3000
```

---

## ⚡ Features & Capabilities

* **Single & Bulk Downloads**: Enter one URL or paste multiple URLs (one per line) for batch scraping.
* **Two Output Formats**:
  * **Full ZIP Archive**: Downloads HTML, CSS, JavaScript, images, and fonts with relative paths for offline browsing.
  * **Structured Text**: Extracts clean Markdown/text per page and compiles an offline interactive sitemap reader (`index.html`) inside the package.
* **Recursive Crawl Depth**: Download just the single page or crawl linked pages recursively (unlimited or 1-5 levels deep).
* **Asset Exclusions**: Easily exclude heavy media (Images, Videos, PDFs) to save bandwidth and speed up downloads.
* **Domain Whitelisting**: Specify extra subdomains or sister domains to crawl (e.g. `shop.example.com, blog.example.com`).
* **Automated SEO & Accessibility Audit**: Generates an automated `seo-report.txt` auditing missing page titles, meta descriptions, and missing image alt tags.
* **Crawl Control**: "Stop & Package" button lets you abort long crawls early and still receive a clean ZIP of all assets downloaded up to that point.
* **Auto-Shutdown**: Server automatically detects when all browser tabs are closed and shuts down cleanly after a 5-second grace period.

---

## 📁 Directory Structure

```
website-downloader-production/
├── bin/
│   ├── www                    # Server HTTP & Socket.IO listener
│   └── generate-start-bat.js  # Generator script for start.bat
├── public/
│   ├── stylesheets/
│   │   └── style.css          # Shadcn dark design system
│   └── sites/                 # Output directory for generated archives (.zip / .txt)
├── routes/
│   └── index.js               # Route endpoints
├── socket/
│   └── socket.js              # Real-time WebSocket streaming & auto-shutdown handler
├── views/
│   ├── index.hbs              # Main workbench interface
│   ├── layout.hbs             # Base HTML template & client scripts
│   └── error.hbs              # Error page template
├── wget/                      # Scraper engine, parser & SEO auditor
├── archiver/                  # ZIP archiver module
├── app.js                     # Express application configuration
├── package.json               # Package dependencies & metadata
├── README.md                  # Documentation
├── setup.bat                  # 1-Click initial setup (offline install & generator)
└── start.bat                  # 1-Click daily launcher & control panel
```

---

## 🔒 Requirements

* **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
* **Port**: 3000 (configurable via `PORT` environment variable)
