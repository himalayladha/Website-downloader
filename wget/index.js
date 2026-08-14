const path = require('path');
const fs = require('fs');
const archiver = require('../archiver');

module.exports = async (io, data) => {
    let websiteUrl = data.website ? data.website.trim() : "";
    if (!websiteUrl) {
        io.emit(data.token, { progress: "Invalid URL provided." });
        return;
    }

    if (!/^https?:\/\//i.test(websiteUrl)) {
        websiteUrl = 'http://' + websiteUrl;
    }

    const websiteFolder = getWebsiteFolderName(websiteUrl);
    const targetDir = path.join(__dirname, '../', websiteFolder);

    // Clean up existing directory if present
    if (fs.existsSync(targetDir)) {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
        } catch (e) {
            console.error("Error cleaning existing dir:", e);
        }
    }

    try {
        const { default: scrape } = await import('website-scraper');

        class ProgressPlugin {
            apply(registerAction) {
                registerAction('onResourceSaved', ({ resource }) => {
                    const url = resource.getUrl();
                    io.emit(data.token, { progress: `200 OK ${url}` });
                });
                registerAction('onResourceError', ({ resource, error }) => {
                    if (resource) {
                        io.emit(data.token, { progress: `Error ${resource.getUrl()}: ${error.message}` });
                    }
                });
            }
        }

        const recursive = !!data.recursive;
        const maxRecursiveDepth = (data.maxRecursiveDepth !== undefined && data.maxRecursiveDepth !== null) ? parseInt(data.maxRecursiveDepth, 10) : null;

        const parsedBaseUrl = new URL(websiteUrl);
        const baseHostname = parsedBaseUrl.hostname.replace(/^www\./i, '');

        const isSameDomain = (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                const currentHostname = parsedUrl.hostname.replace(/^www\./i, '');
                return currentHostname === baseHostname || currentHostname.endsWith('.' + baseHostname);
            } catch (e) {
                return false;
            }
        };

        const isAsset = (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                const pathname = parsedUrl.pathname.toLowerCase();
                const assetExtensions = [
                    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', 
                    '.woff', '.woff2', '.ttf', '.eot', '.otf', '.ico', '.webp',
                    '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.pdf'
                ];
                return assetExtensions.some(ext => pathname.endsWith(ext)) || urlStr.includes('/wp-content/uploads/') || urlStr.includes('/assets/');
            } catch (e) {
                return false;
            }
        };

        const hasDirectoryLoop = (urlStr) => {
            try {
                const parsed = new URL(urlStr);
                const segments = parsed.pathname.split('/').filter(Boolean);
                if (segments.length > 5) {
                    const uniqueSegments = new Set(segments);
                    if (uniqueSegments.size !== segments.length) {
                        return true;
                    }
                }
            } catch (e) {
                // invalid URL
            }
            return false;
        };

        const urlFilter = (urlStr) => {
            // Block recursive folder loops immediately
            if (hasDirectoryLoop(urlStr)) {
                return false;
            }
            // Always allow if it's on the same domain (including subdomains)
            if (isSameDomain(urlStr)) {
                return true;
            }
            // For other domains, only download if it's a static asset (fonts, styles, scripts, images, etc.)
            return isAsset(urlStr);
        };


        io.emit(data.token, { progress: `200 OK Fetching website structure...` });

        await scrape({
            urls: [websiteUrl],
            directory: targetDir,
            recursive: recursive,
            maxRecursiveDepth: recursive ? maxRecursiveDepth : null,
            urlFilter: urlFilter,
            request: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            },
            plugins: [new ProgressPlugin()]
        });


        // Check if download was intercepted by Cloudflare challenge
        const indexHtmlPath = path.join(targetDir, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
            const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
            const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
            const pageTitle = titleMatch ? titleMatch[1].trim().toLowerCase() : '';

            const isCloudflareBlock = 
                pageTitle === 'just a moment...' || 
                pageTitle.includes('attention required') || 
                (pageTitle.includes('cloudflare') && (htmlContent.includes('challenge-error-text') || htmlContent.includes('enable javascript and cookies to continue')));

            if (isCloudflareBlock) {
                // Delete the folder so it doesn't try to archive it
                try {
                    fs.rmSync(targetDir, { recursive: true, force: true });
                } catch (rmErr) {
                    console.error("Error removing Cloudflare index folder:", rmErr);
                }
                throw new Error("Scraping was blocked by Cloudflare anti-bot protection. Please use the direct demo URL instead of the ThemeForest preview wrapper.");
            }
        }


        io.emit(data.token, { progress: "Converting" });
        archiver(websiteFolder, io, data);

    } catch (err) {
        console.error("Scrape error:", err);
        if (fs.existsSync(targetDir)) {
            io.emit(data.token, { progress: "Converting" });
            archiver(websiteFolder, io, data);
        } else {
            io.emit(data.token, { progress: `Scraping failed: ${err.message}` });
        }
    }
};

function getWebsiteFolderName(websiteUrl) {
    try {
        const parsedUrl = new URL(websiteUrl);
        return parsedUrl.port ? `${parsedUrl.hostname}_${parsedUrl.port}` : parsedUrl.hostname;
    } catch (error) {
        return "downloaded_website";
    }
}

