const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const gotModule = require('got');
const got = typeof gotModule === 'function' ? gotModule : (gotModule.got || gotModule.default || gotModule);
const archiver = require('../archiver');

class CancelError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CancelError';
    }
}

module.exports = async (io, data) => {
    // Reset cancellation flag for this request token
    if (global.cancelFlags && data.token) {
        delete global.cancelFlags[data.token];
    }

    let websiteInput = data.website ? data.website.trim() : "";
    if (!websiteInput) {
        io.emit(data.token, { progress: "Invalid URL(s) provided." });
        return;
    }

    // Parse urls (newline or comma separated)
    const urls = websiteInput
        .split(/[\r\n,;\t]+/)
        .map(url => url.trim())
        .filter(url => url.length > 0)
        .map(url => {
            if (!/^https?:\/\//i.test(url)) {
                return 'http://' + url;
            }
            return url;
        });

    if (urls.length === 0) {
        io.emit(data.token, { progress: "Invalid URL(s) provided." });
        return;
    }

    if (urls.length === 1) {
        await downloadSingleWebsite(urls[0], io, data);
    } else {
        await downloadBulkWebsites(urls, io, data);
    }
};

async function downloadSingleWebsite(websiteUrl, io, data) {
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

    // Setup request headers (using browser emulation)
    const preflightHeaders = {
        'User-Agent': data.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    };
    if (data.cookies) {
        let rawCookies = data.cookies.trim();
        if (rawCookies.toLowerCase().startsWith('cookie:')) {
            rawCookies = rawCookies.slice(7).trim();
        }
        preflightHeaders['Cookie'] = rawCookies;
    }

    try {
        io.emit(data.token, { progress: "Info Performing smart pre-flight check on destination URL..." });
        const response = await got(websiteUrl, {
            headers: preflightHeaders,
            timeout: { request: 8000 },
            retry: { limit: 0 },
            followRedirect: true
        });

        // Smart Analysis of the target HTML page
        const html = response.body || "";
        const isShopify = html.includes('myshopify.com') || html.includes('Shopify.shop') || response.headers['x-shopify-stage'] !== undefined;
        const isPasswordPage = html.includes('action="/password"') || html.includes('name="password"') || html.includes('storefront_digest') || response.url.includes('/password');

        if (isShopify) {
            io.emit(data.token, { progress: "Info Detected Shopify platform storefront." });
            if (isPasswordPage && !data.cookies) {
                io.emit(data.token, { progress: "System Warning: Shopify password protection detected! If scraping fails, enter your password in the browser and supply the storefront_digest cookie." });
            }
        }

        if (response.statusCode >= 400) {
            io.emit(data.token, { progress: `System Warning: Server returned status code ${response.statusCode}. Site might require login or be protected by Cloudflare.` });
        }
    } catch (preflightErr) {
        console.error("Preflight error:", preflightErr);
        if (preflightErr.response) {
            const status = preflightErr.response.statusCode;
            if (status === 403 || status === 401) {
                io.emit(data.token, { progress: `System Warning: Access Denied (${status}). Please supply valid session cookies in Request Cookies settings to bypass.` });
            } else {
                io.emit(data.token, { progress: `Info Pre-flight warning: Server returned status ${status}.` });
            }
        } else {
            io.emit(data.token, { progress: `Info Pre-flight lookup bypassed: ${preflightErr.message}.` });
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
        const baseHostname = parsedBaseUrl.hostname.replace(/^www\./i, '').toLowerCase();

        // Parse whitelisted domains
        const extraHosts = data.extraDomains 
            ? data.extraDomains.split(',').map(h => h.trim().replace(/^www\./i, '').toLowerCase()).filter(Boolean)
            : [];

        // Extract subpath base directory
        let basePath = parsedBaseUrl.pathname;
        if (!basePath.endsWith('/') && path.extname(basePath) !== '') {
            basePath = path.dirname(basePath);
        }
        if (!basePath.endsWith('/')) {
            basePath = basePath + '/';
        }

        const isSameDomain = (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                const currentHostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
                if (currentHostname === baseHostname || currentHostname.endsWith('.' + baseHostname)) {
                    return true;
                }
                return extraHosts.some(host => currentHostname === host || currentHostname.endsWith('.' + host));
            } catch (e) {
                return false;
            }
        };

        const isUnderSubpath = (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                const currentHostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
                
                // If it is on one of our allowed extra domains, skip primary domain subpath constraint
                if (extraHosts.some(host => currentHostname === host || currentHostname.endsWith('.' + host))) {
                    return true;
                }

                // Must be on the primary domain
                if (currentHostname !== baseHostname && !currentHostname.endsWith('.' + baseHostname)) {
                    return false;
                }

                // Check if the path starts with our basePath prefix
                let currentPath = parsedUrl.pathname;
                if (currentPath === basePath.slice(0, -1)) {
                    currentPath = currentPath + '/';
                }
                
                return currentPath.startsWith(basePath);
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

        const isHtmlPage = (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                const pathname = parsedUrl.pathname.toLowerCase();
                const assetExtensions = [
                    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', 
                    '.woff', '.woff2', '.ttf', '.eot', '.otf', '.ico', '.webp',
                    '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.pdf', '.zip', '.rar'
                ];
                const hasAssetExt = assetExtensions.some(ext => pathname.endsWith(ext));
                return !hasAssetExt;
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

            // Check cancel flag
            if (global.cancelFlags && global.cancelFlags[data.token]) {
                throw new CancelError("Scraping cancelled by user");
            }

            try {
                const parsedUrl = new URL(urlStr);
                const pathname = parsedUrl.pathname.toLowerCase();

                // Exclude Images
                if (data.excludeImages) {
                    const imgExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];
                    if (imgExtensions.some(ext => pathname.endsWith(ext)) || urlStr.includes('/wp-content/uploads/') || urlStr.includes('/assets/images/')) {
                        return false;
                    }
                }
                // Exclude Videos
                if (data.excludeVideos) {
                    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];
                    if (videoExtensions.some(ext => pathname.endsWith(ext))) {
                        return false;
                    }
                }
                // Exclude PDFs
                if (data.excludePdfs) {
                    if (pathname.endsWith('.pdf')) {
                        return false;
                    }
                }
            } catch (e) {
                // invalid URL
            }

            // Anti-bloat & tracking filter: ignore common ads, analytics, and trackers
            const bloatPatterns = [
                'google-analytics.com', 'googletagmanager.com', 'facebook.net',
                'doubleclick.net', 'hotjar.com', 'analytics.js', 'gtag/js',
                'connect.facebook.net', 'snapchat.com', 'pinterest.com',
                'tiktok.com', 'klaviyo.com', 'pixel', 'browser-sync',
                'quantserve.com', 'scorecardresearch.com', 'crazyegg.com'
            ];
            const lowerUrl = urlStr.toLowerCase();
            if (bloatPatterns.some(pattern => lowerUrl.includes(pattern))) {
                return false;
            }

            if (data.outputFormat === 'text') {
                // If it's a text extraction, only follow HTML pages under the specified subpath
                return isUnderSubpath(urlStr) && isHtmlPage(urlStr);
            } else {
                // If it's an HTML page, only download it if it's under the subpath
                if (isHtmlPage(urlStr)) {
                    return isUnderSubpath(urlStr);
                }
                // Always allow static assets if they are on the same domain
                if (isSameDomain(urlStr)) {
                    return true;
                }
                // For other domains, only download if it's a static asset (fonts, styles, scripts, images, etc.)
                return isAsset(urlStr);
            }
        };


        io.emit(data.token, { progress: `200 OK Fetching website structure...` });

        await scrape({
            urls: [websiteUrl],
            directory: targetDir,
            recursive: recursive,
            maxRecursiveDepth: recursive ? maxRecursiveDepth : null,
            urlFilter: urlFilter,
            request: {
                headers: (() => {
                    const headers = {
                        'User-Agent': data.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    };
                    if (data.cookies) {
                        let rawCookies = data.cookies.trim();
                        if (rawCookies.toLowerCase().startsWith('cookie:')) {
                            rawCookies = rawCookies.slice(7).trim();
                        }
                        headers['Cookie'] = rawCookies;
                    }
                    return headers;
                })()
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

        // Run SEO audit
        try {
            generateSeoReport(targetDir, websiteFolder, websiteUrl);
        } catch (seoErr) {
            console.error("SEO report error:", seoErr);
        }

        // If the format is text, convert the HTML files to structured TXT
        if (data.outputFormat === 'text') {
            io.emit(data.token, { progress: "Structuring extracted text..." });
            compileTextExtraction(targetDir, websiteFolder, websiteUrl);
            io.emit(data.token, { progress: "Completed", file: websiteFolder });
        } else {
            io.emit(data.token, { progress: "Converting" });
            archiver(websiteFolder, io, data);
        }

    } catch (err) {
        console.error("Scrape error:", err);
        const isCancelled = err.name === 'CancelError' || err.message.includes("cancelled");
        if (isCancelled) {
            io.emit(data.token, { progress: "System Cancellation request completed. Packaging downloaded files..." });
        }

        if (fs.existsSync(targetDir)) {
            // Run SEO audit even for incomplete/cancelled downloads
            try {
                generateSeoReport(targetDir, websiteFolder, websiteUrl);
            } catch (seoErr) {
                console.error("SEO report error:", seoErr);
            }

            if (data.outputFormat === 'text') {
                try {
                    compileTextExtraction(targetDir, websiteFolder, websiteUrl);
                    io.emit(data.token, { progress: "Completed", file: websiteFolder });
                } catch (compileErr) {
                    console.error("Failed to compile text after error:", compileErr);
                    io.emit(data.token, { progress: isCancelled ? "Cancelled" : `Scraping failed: ${err.message}` });
                }
            } else {
                io.emit(data.token, { progress: "Converting" });
                archiver(websiteFolder, io, data);
            }
        } else {
            io.emit(data.token, { progress: isCancelled ? "Cancelled" : `Scraping failed: ${err.message}` });
        }
    }
}

async function downloadBulkWebsites(urls, io, data) {
    const timestamp = Date.now();
    const bulkSessionName = `bulk-download-${timestamp}`;
    const bulkDir = path.join(__dirname, '../', bulkSessionName);
    
    // Setup target output folder
    const finalOutputDir = path.join(__dirname, '../public/sites', bulkSessionName);
    if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, { recursive: true });
    }
    if (!fs.existsSync(bulkDir)) {
        fs.mkdirSync(bulkDir, { recursive: true });
    }

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

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    io.emit(data.token, { progress: `Starting bulk download of ${urls.length} websites...` });

    for (let index = 0; index < urls.length; index++) {
        // Pre-check cancellation flag before starting next site in list
        if (global.cancelFlags && global.cancelFlags[data.token]) {
            io.emit(data.token, { progress: "System Cancellation request received. Bypassing remaining sites..." });
            break;
        }

        const websiteUrl = urls[index];
        const siteIndex = index + 1;
        
        io.emit(data.token, { progress: `Info [${siteIndex}/${urls.length}] Preparing to download: ${websiteUrl}` });
        
        try {
            const parsedBaseUrl = new URL(websiteUrl);
            const baseHostname = parsedBaseUrl.hostname.replace(/^www\./i, '').toLowerCase();
            const websiteFolder = getWebsiteFolderName(websiteUrl);

            // Parse whitelisted domains
            const extraHosts = data.extraDomains 
                ? data.extraDomains.split(',').map(h => h.trim().replace(/^www\./i, '').toLowerCase()).filter(Boolean)
                : [];

            // In bulk mode, targetDir is a subdirectory inside the bulkSession folder
            const targetDir = path.join(bulkDir, websiteFolder);
            if (fs.existsSync(targetDir)) {
                try {
                    fs.rmSync(targetDir, { recursive: true, force: true });
                } catch (rmErr) {
                    console.error("Error clearing existing targetDir:", rmErr);
                }
            }

            // 1. Extract subpath base directory
            let basePath = parsedBaseUrl.pathname;
            if (!basePath.endsWith('/') && path.extname(basePath) !== '') {
                basePath = path.dirname(basePath);
            }
            if (!basePath.endsWith('/')) {
                basePath = basePath + '/';
            }

            const isSameDomain = (urlStr) => {
                try {
                    const parsedUrl = new URL(urlStr);
                    const currentHostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
                    if (currentHostname === baseHostname || currentHostname.endsWith('.' + baseHostname)) {
                        return true;
                    }
                    return extraHosts.some(host => currentHostname === host || currentHostname.endsWith('.' + host));
                } catch (e) {
                    return false;
                }
            };

            const isUnderSubpath = (urlStr) => {
                try {
                    const parsedUrl = new URL(urlStr);
                    const currentHostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
                    
                    // If it is on one of our allowed extra domains, skip primary domain subpath constraint
                    if (extraHosts.some(host => currentHostname === host || currentHostname.endsWith('.' + host))) {
                        return true;
                    }

                    if (currentHostname !== baseHostname && !currentHostname.endsWith('.' + baseHostname)) {
                        return false;
                    }
                    let currentPath = parsedUrl.pathname;
                    if (currentPath === basePath.slice(0, -1)) {
                        currentPath = currentPath + '/';
                    }
                    return currentPath.startsWith(basePath);
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

            const isHtmlPage = (urlStr) => {
                try {
                    const parsedUrl = new URL(urlStr);
                    const pathname = parsedUrl.pathname.toLowerCase();
                    const assetExtensions = [
                        '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', 
                        '.woff', '.woff2', '.ttf', '.eot', '.otf', '.ico', '.webp',
                        '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.pdf', '.zip', '.rar'
                    ];
                    const hasAssetExt = assetExtensions.some(ext => pathname.endsWith(ext));
                    return !hasAssetExt;
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
                if (hasDirectoryLoop(urlStr)) return false;

                // Check cancel flag
                if (global.cancelFlags && global.cancelFlags[data.token]) {
                    throw new CancelError("Scraping cancelled by user");
                }

                try {
                    const parsedUrl = new URL(urlStr);
                    const pathname = parsedUrl.pathname.toLowerCase();

                    // Exclude Images
                    if (data.excludeImages) {
                        const imgExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];
                        if (imgExtensions.some(ext => pathname.endsWith(ext)) || urlStr.includes('/wp-content/uploads/') || urlStr.includes('/assets/images/')) {
                            return false;
                        }
                    }
                    // Exclude Videos
                    if (data.excludeVideos) {
                        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];
                        if (videoExtensions.some(ext => pathname.endsWith(ext))) {
                            return false;
                        }
                    }
                    // Exclude PDFs
                    if (data.excludePdfs) {
                        if (pathname.endsWith('.pdf')) {
                            return false;
                        }
                    }
                } catch (e) {
                    // invalid URL
                }

                const bloatPatterns = [
                    'google-analytics.com', 'googletagmanager.com', 'facebook.net',
                    'doubleclick.net', 'hotjar.com', 'analytics.js', 'gtag/js',
                    'connect.facebook.net', 'snapchat.com', 'pinterest.com',
                    'tiktok.com', 'klaviyo.com', 'pixel', 'browser-sync',
                    'quantserve.com', 'scorecardresearch.com', 'crazyegg.com'
                ];
                const lowerUrl = urlStr.toLowerCase();
                if (bloatPatterns.some(pattern => lowerUrl.includes(pattern))) {
                    return false;
                }

                if (data.outputFormat === 'text') {
                    return isUnderSubpath(urlStr) && isHtmlPage(urlStr);
                } else {
                    if (isHtmlPage(urlStr)) {
                        return isUnderSubpath(urlStr);
                    }
                    if (isSameDomain(urlStr)) {
                        return true;
                    }
                    return isAsset(urlStr);
                }
            };

            // Setup request headers (using browser emulation)
            const requestHeaders = {
                'User-Agent': data.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            };
            if (data.cookies) {
                let rawCookies = data.cookies.trim();
                if (rawCookies.toLowerCase().startsWith('cookie:')) {
                    rawCookies = rawCookies.slice(7).trim();
                }
                requestHeaders['Cookie'] = rawCookies;
            }

            // 2. Pre-flight check
            try {
                const response = await got(websiteUrl, {
                    headers: requestHeaders,
                    timeout: { request: 8000 },
                    retry: { limit: 0 },
                    followRedirect: true
                });
                const html = response.body || "";
                const isShopify = html.includes('myshopify.com') || html.includes('Shopify.shop');
                const isPasswordPage = html.includes('action="/password"') || html.includes('storefront_digest') || response.url.includes('/password');

                if (isShopify) {
                    io.emit(data.token, { progress: `Info [${siteIndex}/${urls.length}] Detected Shopify store.` });
                    if (isPasswordPage && !data.cookies) {
                        io.emit(data.token, { progress: `System Warning [${siteIndex}/${urls.length}]: Shopify password protection detected!` });
                    }
                }
            } catch (preflightErr) {
                console.error("Preflight error in bulk:", preflightErr);
            }

            io.emit(data.token, { progress: `200 OK Fetching site ${siteIndex}/${urls.length} structure...` });

            // 3. Scrape URL
            await scrape({
                urls: [websiteUrl],
                directory: targetDir,
                recursive: recursive,
                maxRecursiveDepth: recursive ? maxRecursiveDepth : null,
                urlFilter: urlFilter,
                request: {
                    headers: requestHeaders
                },
                plugins: [new ProgressPlugin()]
            });

            // Run SEO Report
            try {
                generateSeoReport(targetDir, websiteFolder, websiteUrl, finalOutputDir);
            } catch (seoErr) {
                console.error("SEO report error:", seoErr);
            }

            // 4. Post-processing
            if (data.outputFormat === 'text') {
                compileTextExtraction(targetDir, websiteFolder, websiteUrl, finalOutputDir);
            }

            io.emit(data.token, { progress: `Info [${siteIndex}/${urls.length}] Successfully downloaded ${websiteUrl}.` });

        } catch (err) {
            console.error(`Error downloading ${websiteUrl} in bulk:`, err);
            const isCancelled = err.name === 'CancelError' || err.message.includes("cancelled");
            if (isCancelled) {
                io.emit(data.token, { progress: `System Cancellation request received. Halting bulk crawl loop...` });
                
                // Run SEO report and compile text for the partial site
                if (fs.existsSync(targetDir)) {
                    try {
                        generateSeoReport(targetDir, websiteFolder, websiteUrl, finalOutputDir);
                    } catch (seoErr) {
                        console.error("SEO report error:", seoErr);
                    }
                    if (data.outputFormat === 'text') {
                        compileTextExtraction(targetDir, websiteFolder, websiteUrl, finalOutputDir);
                    }
                }
                
                break;
            } else {
                io.emit(data.token, { progress: `Error [${siteIndex}/${urls.length}] Failed to download ${websiteUrl}: ${err.message}` });
            }
        }

        await delay(1500);
    }

    // 5. Final bundling
    if (data.outputFormat === 'text') {
        try {
            generateBulkOfflineHtmlIndex(finalOutputDir, bulkSessionName);
        } catch (sitemapErr) {
            console.error("Failed to generate bulk offline HTML index:", sitemapErr);
        }

        io.emit(data.token, { progress: "Converting" });
        archiver(bulkSessionName, io, data, finalOutputDir);
        
        try {
            fs.rmSync(bulkDir, { recursive: true, force: true });
        } catch (rmErr) {}
    } else {
        io.emit(data.token, { progress: "Converting" });
        archiver(bulkSessionName, io, data, bulkDir);
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

function getHtmlFiles(dir, filesList = []) {
    if (!fs.existsSync(dir)) return filesList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getHtmlFiles(filePath, filesList);
        } else if (file.endsWith('.html') || file.endsWith('.htm')) {
            filesList.push(filePath);
        }
    }
    return filesList;
}

function extractCleanMarkdown(html) {
    const $ = cheerio.load(html);
    
    // Remove unwanted interactive/structural elements that clutter text extraction
    $('script, style, iframe, nav, header, footer, noscript, svg, form, .header, .footer, .nav, .menu, .sidebar, #header, #footer, #sidebar, .social-share, .comments, .ad, .advertisement').remove();
    
    let markdown = '';
    
    // Select headers, paragraphs, list items, code blocks, blockquotes, and images in document order
    $('h1, h2, h3, h4, h5, h6, p, li, pre, code, blockquote, img').each((i, el) => {
        const tagName = el.tagName.toLowerCase();
        
        if (tagName === 'img') {
            const alt = $(el).attr('alt') ? $(el).attr('alt').trim() : '';
            const src = $(el).attr('src') ? $(el).attr('src').trim() : '';
            if (alt) {
                markdown += `\n[Image: ${alt}]\n`;
            } else if (src) {
                const filename = path.basename(src.split('?')[0]);
                markdown += `\n[Image: ${filename}]\n`;
            }
            return;
        }

        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (!text) return;
        
        if (tagName === 'h1') {
            markdown += `\n# ${text}\n`;
        } else if (tagName === 'h2') {
            markdown += `\n## ${text}\n`;
        } else if (tagName === 'h3') {
            markdown += `\n### ${text}\n`;
        } else if (tagName === 'h4') {
            markdown += `\n#### ${text}\n`;
        } else if (tagName === 'h5' || tagName === 'h6') {
            markdown += `\n##### ${text}\n`;
        } else if (tagName === 'p') {
            markdown += `\n${text}\n`;
        } else if (tagName === 'blockquote') {
            markdown += `\n> ${text}\n`;
        } else if (tagName === 'li') {
            markdown += `- ${text}\n`;
        } else if (tagName === 'pre' || tagName === 'code') {
            if (text.length > 0) {
                markdown += `\n\`\`\`\n${text}\n\`\`\`\n`;
            }
        }
    });
    
    return markdown.trim();
}

function compileTextExtraction(targetDir, websiteFolder, baseDomainUrl, customOutputDir) {
    const htmlFiles = getHtmlFiles(targetDir);
    if (htmlFiles.length === 0) {
        throw new Error("No HTML pages found to extract text from.");
    }
    
    let content = `================================================================================\n`;
    content += `WEBSITE TEXT EXTRACTION & BUSINESS PROFILE\n`;
    content += `Target Website: ${baseDomainUrl}\n`;
    content += `Extracted on: ${new Date().toUTCString()}\n`;
    content += `Total Pages Extracted: ${htmlFiles.length}\n`;
    content += `================================================================================\n\n`;
    
    content += `--------------------------------------------------------------------------------\n`;
    content += `TABLE OF CONTENTS\n`;
    content += `--------------------------------------------------------------------------------\n`;
    
    const pages = [];
    let pageIndex = 1;
    
    for (const filePath of htmlFiles) {
        const relativePath = path.relative(targetDir, filePath);
        // Map to page route, e.g. "about/index.html" -> "/about"
        let pageRoute = '/' + relativePath.replace(/index\.html$/i, '').replace(/\\/g, '/');
        if (pageRoute.endsWith('/') && pageRoute.length > 1) {
            pageRoute = pageRoute.slice(0, -1);
        }
        
        const html = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(html);
        const pageTitle = $('title').text().trim() || pageRoute;
        const pageTextContent = extractCleanMarkdown(html);
        
        pages.push({
            index: pageIndex++,
            route: pageRoute,
            title: pageTitle,
            text: pageTextContent
        });
        
        content += `${pages.length}. Route: ${pageRoute} (Title: ${pageTitle})\n`;
    }
    
    content += `\n================================================================================\n`;
    content += `PAGE CONTENT\n`;
    content += `================================================================================\n\n`;
    
    for (const page of pages) {
        content += `--------------------------------------------------------------------------------\n`;
        content += `${page.index}. PAGE: ${page.title}\n`;
        content += `   Route: ${page.route}\n`;
        content += `   URL: ${baseDomainUrl.replace(/\/$/, '')}${page.route}\n`;
        content += `--------------------------------------------------------------------------------\n\n`;
        content += page.text ? page.text : `(No text content found on this page.)`;
        content += `\n\n`;
    }
    
    const outputDir = customOutputDir || path.join(__dirname, '../public/sites');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const txtPath = path.join(outputDir, `${websiteFolder}.txt`);
    fs.writeFileSync(txtPath, content, 'utf8');
    
    // Clean up HTML directory
    fs.rmSync(targetDir, { recursive: true, force: true });
}

function generateSeoReport(targetDir, websiteFolder, baseDomainUrl, customOutputDir) {
    const htmlFiles = getHtmlFiles(targetDir);
    if (htmlFiles.length === 0) return;

    let report = `================================================================================\n`;
    report += `WEBSITE SEO & QUALITY AUDIT REPORT\n`;
    report += `Target Website: ${baseDomainUrl}\n`;
    report += `Audited on: ${new Date().toUTCString()}\n`;
    report += `Total Pages Checked: ${htmlFiles.length}\n`;
    report += `================================================================================\n\n`;

    let missingTitles = [];
    let missingDescriptions = [];
    let missingAlts = [];

    // Check each HTML file
    for (const filePath of htmlFiles) {
        const relativePath = path.relative(targetDir, filePath);
        let pageRoute = '/' + relativePath.replace(/index\.html$/i, '').replace(/\\/g, '/');
        if (pageRoute.endsWith('/') && pageRoute.length > 1) {
            pageRoute = pageRoute.slice(0, -1);
        }

        const html = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(html);

        // 1. Audit Title
        const title = $('title').text().trim();
        if (!title) {
            missingTitles.push(pageRoute);
        }

        // 2. Audit Description
        const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
        if (!desc || desc.trim() === '') {
            missingDescriptions.push(pageRoute);
        }

        // 3. Audit Image Alts
        $('img').each((i, el) => {
            const alt = $(el).attr('alt');
            const src = $(el).attr('src') || '';
            if (alt === undefined || alt === null || alt.trim() === '') {
                missingAlts.push({
                    page: pageRoute,
                    imgSrc: src
                });
            }
        });
    }

    // Compile into report
    report += `--------------------------------------------------------------------------------\n`;
    report += `1. META TAG AUDIT\n`;
    report += `--------------------------------------------------------------------------------\n`;
    
    report += `\n[Missing Page Titles] (${missingTitles.length} pages):\n`;
    if (missingTitles.length > 0) {
        missingTitles.forEach(p => report += `  - Route: ${p}\n`);
    } else {
        report += `  (No pages missing titles. Good!)\n`;
    }

    report += `\n[Missing Meta Descriptions] (${missingDescriptions.length} pages):\n`;
    if (missingDescriptions.length > 0) {
        missingDescriptions.forEach(p => report += `  - Route: ${p}\n`);
    } else {
        report += `  (No pages missing meta descriptions. Good!)\n`;
    }

    report += `\n\n--------------------------------------------------------------------------------\n`;
    report += `2. IMAGE ACCESSIBILITY (ALT ATTRIBUTES) AUDIT\n`;
    report += `--------------------------------------------------------------------------------\n`;
    report += `Total images missing descriptive alt tags: ${missingAlts.length}\n\n`;
    if (missingAlts.length > 0) {
        missingAlts.slice(0, 100).forEach(item => {
            report += `  - Route: ${item.page} | Image Src: ${item.imgSrc}\n`;
        });
        if (missingAlts.length > 100) {
            report += `  ... and ${missingAlts.length - 100} more items.\n`;
        }
    } else {
        report += `  (All images have alt tags. Perfect!)\n`;
    }

    const outputDir = customOutputDir || path.join(__dirname, '../public/sites');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save report
    const reportPath = customOutputDir 
        ? path.join(customOutputDir, `${websiteFolder}_seo-report.txt`)
        : path.join(targetDir, `seo-report.txt`);
        
    fs.writeFileSync(reportPath, report, 'utf8');
}

function generateBulkOfflineHtmlIndex(finalOutputDir, bulkSessionName) {
    const files = fs.readdirSync(finalOutputDir);
    const txtFiles = files.filter(f => f.endsWith('.txt'));
    if (txtFiles.length === 0) return;

    let pagesJsonList = [];

    for (const file of txtFiles) {
        if (file.includes('seo-report')) continue;
        const filePath = path.join(finalOutputDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const domain = file.replace(/\.txt$/i, '');
        
        pagesJsonList.push({
            route: domain,
            title: domain,
            content: content
        });
    }

    const escapedJson = JSON.stringify(pagesJsonList).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bulk Website Reader - ${bulkSessionName}</title>
    <style>
        :root {
            --bg-sidebar: #0f172a;
            --bg-content: #f8fafc;
            --text-sidebar: #94a3b8;
            --text-active: #ffffff;
            --text-content: #1e293b;
            --border-color: #cbd5e1;
            --primary-color: #4f46e5;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            display: flex;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-content);
            color: var(--text-content);
            overflow: hidden;
        }
        .sidebar {
            width: 300px;
            background: var(--bg-sidebar);
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border-color);
            overflow-y: auto;
        }
        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid #1e293b;
            color: #ffffff;
        }
        .sidebar-header h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 4px; }
        .sidebar-header p { font-size: 0.75rem; color: var(--text-sidebar); }
        .page-list { list-style: none; padding: 12px 8px; }
        .page-item {
            padding: 10px 12px;
            border-radius: 6px;
            cursor: pointer;
            color: var(--text-sidebar);
            font-size: 0.85rem;
            margin-bottom: 4px;
            transition: background 0.2s, color 0.2s;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .page-item:hover { background: #1e293b; color: #ffffff; }
        .page-item.active { background: var(--primary-color); color: #ffffff; font-weight: 600; }
        .reader-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            background: #ffffff;
        }
        .reader-header {
            padding: 30px 40px;
            border-bottom: 1px solid #e2e8f0;
            background: #f8fafc;
        }
        .reader-header h1 { font-size: 1.8rem; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
        .reader-header p { font-size: 0.85rem; color: #64748b; }
        .reader-body {
            padding: 40px;
            font-size: 1rem;
            line-height: 1.6;
            max-width: 900px;
            margin: 0 auto;
            width: 100%;
        }
        .clean-text {
            white-space: pre-wrap;
            font-family: "Courier New", Courier, monospace;
            color: #334155;
            font-size: 0.95rem;
            background: #f1f5f9;
            padding: 24px;
            border-radius: 8px;
            border: 1px solid #cbd5e1;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">
            <h3>Bulk Reader Dashboard</h3>
            <p>Session: ${bulkSessionName}</p>
        </div>
        <ul id="pageList" class="page-list"></ul>
    </div>
    <div class="reader-pane">
        <div class="reader-header">
            <h1 id="pageTitle">Select a website</h1>
            <p id="pageRoute"></p>
        </div>
        <div class="reader-body">
            <pre id="pageContent" class="clean-text">Select a website from the sidebar list to view its compiled text profile.</pre>
        </div>
    </div>

    <script>
        const pages = ${escapedJson};
        const pageList = document.getElementById('pageList');
        const pageTitle = document.getElementById('pageTitle');
        const pageRoute = document.getElementById('pageRoute');
        const pageContent = document.getElementById('pageContent');

        function loadPage(index) {
            const page = pages[index];
            document.querySelectorAll('.page-item').forEach(el => el.classList.remove('active'));
            document.getElementById('item-' + index).classList.add('active');

            pageTitle.innerText = page.title;
            pageRoute.innerText = "Domain Profile: " + page.route;
            pageContent.innerText = page.content || "(No text content found.)";
        }

        pages.forEach((page, i) => {
            const li = document.createElement('li');
            li.id = 'item-' + i;
            li.className = 'page-item';
            li.title = page.title;
            li.innerText = page.title;
            li.onclick = () => loadPage(i);
            pageList.appendChild(li);
        });

        if (pages.length > 0) {
            loadPage(0);
        }
    </script>
</body>
</html>`;

    fs.writeFileSync(path.join(finalOutputDir, 'index.html'), htmlContent, 'utf8');
}


