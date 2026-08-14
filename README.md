# Website Downloader Pro 💾

A Node.js web application designed to download the source code, templates, stylesheets, scripts, and media assets of any website, packaging them into a portable offline ZIP archive.

## Key Features 🚀

- **Node-Native Scraping Engine**: Replaced the external CLI `wget` command dependency with `website-scraper`, making the app fully cross-platform (compatible with Windows, macOS, and Linux out-of-the-box).
- **Download Modes**:
  - **Single Page**: Grab a single HTML page with all its dependent styles, scripts, and assets.
  - **All Linked Pages (Recursive)**: Recursively scrape linked subpages on the same site up to a specific depth, or crawl the entire site with **Unlimited** depth.
- **Loop Traversal Protection**: Integrated recursion protection that automatically detects and skips infinite directory loops (e.g. repeating path structures caused by relative references in pages without trailing slashes).
- **Same-Domain Constraint**: Limits recursive parsing strictly to the root domain and subdomains, ensuring the crawler never leaves the target site, while still allowing third-party CDN assets (like fonts, styles, and scripts) to download normally so layouts render perfectly offline.
- **Modern Flat UI & Progress Bar**: Styled with a clean, responsive layout featuring real-time download progress tracking, percentage completion indicators, and an interactive console logs terminal.

## Installation 🔨

1. Clone the repository:
   ```bash
   git clone <your-repository-url>
   cd website-downloader
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application:
   ```bash
   npm start
   ```

4. Open in your browser:
   [http://localhost:3000](http://localhost:3000)

## Tech Stack 🛠️

- **Backend**: Node.js, Express, Socket.io, Handlebars
- **Libraries**: `website-scraper` for assets extracting, `archiver` for ZIP compression
- **Frontend**: Vanilla HTML5, CSS3, FontAwesome 6 icons, Socket.io client
