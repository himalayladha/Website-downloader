const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
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
            if (data.outputFormat === 'text') {
                // If it's a text extraction, only follow same-domain HTML pages
                return isSameDomain(urlStr) && isHtmlPage(urlStr);
            } else {
                // Always allow if it's on the same domain (including subdomains)
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
        if (fs.existsSync(targetDir)) {
            if (data.outputFormat === 'text') {
                try {
                    compileTextExtraction(targetDir, websiteFolder, websiteUrl);
                    io.emit(data.token, { progress: "Completed", file: websiteFolder });
                } catch (compileErr) {
                    console.error("Failed to compile text after error:", compileErr);
                    io.emit(data.token, { progress: `Scraping failed: ${err.message}` });
                }
            } else {
                io.emit(data.token, { progress: "Converting" });
                archiver(websiteFolder, io, data);
            }
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

function compileTextExtraction(targetDir, websiteFolder, baseDomainUrl) {
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
    
    const outputDir = path.join(__dirname, '../public/sites');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const txtPath = path.join(outputDir, `${websiteFolder}.txt`);
    fs.writeFileSync(txtPath, content, 'utf8');
    
    // Clean up HTML directory
    fs.rmSync(targetDir, { recursive: true, force: true });
}


