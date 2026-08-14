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

        // If the format is text, convert the HTML files to structured Markdown
        if (data.outputFormat === 'text') {
            io.emit(data.token, { progress: "Structuring extracted text..." });
            compileTextExtraction(targetDir, websiteFolder, websiteUrl);
        }

        io.emit(data.token, { progress: "Converting" });
        archiver(websiteFolder, io, data);

    } catch (err) {
        console.error("Scrape error:", err);
        if (fs.existsSync(targetDir)) {
            if (data.outputFormat === 'text') {
                try {
                    compileTextExtraction(targetDir, websiteFolder, websiteUrl);
                } catch (compileErr) {
                    console.error("Failed to compile text after error:", compileErr);
                }
            }
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
    
    // Select headers, paragraphs, list items, code blocks, and blockquotes in document order
    $('h1, h2, h3, h4, h5, h6, p, li, pre, code, blockquote').each((i, el) => {
        const tagName = el.tagName.toLowerCase();
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
    const targetDirText = path.join(__dirname, '../', websiteFolder + '_text');
    
    // Clean up existing text dir if present
    if (fs.existsSync(targetDirText)) {
        fs.rmSync(targetDirText, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDirText, { recursive: true });
    fs.mkdirSync(path.join(targetDirText, 'pages'), { recursive: true });
    
    const htmlFiles = getHtmlFiles(targetDir);
    if (htmlFiles.length === 0) {
        throw new Error("No HTML pages found to extract text from.");
    }
    
    let masterContent = `# Structured Text Extraction from ${baseDomainUrl}\n\n`;
    masterContent += `*Extracted on: ${new Date().toUTCString()}*\n`;
    masterContent += `*Total pages extracted: ${htmlFiles.length}*\n\n---\n`;
    
    let toc = `## Table of Contents\n\n`;
    let pagesContent = '';
    
    const extractedPages = [];
    
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
        
        const cleanContent = extractCleanMarkdown(html);
        
        const cleanFilename = pageRoute === '/' ? 'home' : pageRoute.replace(/^\//, '').replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        const mdFilename = `${cleanFilename}.md`;
        
        const pageMarkdown = `# Page: ${pageTitle}\nURL: ${baseDomainUrl}${pageRoute}\nRoute: \`${pageRoute}\`\n\n---\n\n${cleanContent}`;
        
        // Write individual page md
        fs.writeFileSync(path.join(targetDirText, 'pages', mdFilename), pageMarkdown, 'utf8');
        
        extractedPages.push({
            route: pageRoute,
            title: pageTitle,
            filename: mdFilename
        });
        
        // Append to TOC and master content
        const anchor = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        toc += `- [${pageTitle} (Route: ${pageRoute})](#${anchor})\n`;
        
        pagesContent += `\n<a name="${anchor}"></a>\n\n${pageMarkdown}\n\n---\n`;
    }
    
    // Assemble master readme
    let readme = `# Extracted Website Text Content: ${baseDomainUrl}\n\n`;
    readme += `This directory contains the structured text extracted from **${baseDomainUrl}**.\n\n`;
    readme += `## Files\n`;
    readme += `- \`README.md\`: This file.\n`;
    readme += `- \`full_site_content.md\`: A single consolidated Markdown file containing text from all pages.\n`;
    readme += `- \`pages/\`: A folder containing separate Markdown files for each individual page.\n\n`;
    readme += `## Extracted Pages (${htmlFiles.length})\n\n`;
    for (const page of extractedPages) {
        readme += `- **${page.title}** (Route: \`${page.route}\`) -> [\`pages/${page.filename}\`](pages/${page.filename})\n`;
    }
    
    fs.writeFileSync(path.join(targetDirText, 'README.md'), readme, 'utf8');
    fs.writeFileSync(path.join(targetDirText, 'full_site_content.md'), masterContent + '\n' + toc + '\n' + pagesContent, 'utf8');
    
    // Clean up HTML directory and swap
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(targetDirText, targetDir);
}


