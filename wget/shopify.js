const got = require('got');
const fs = require('fs');
const path = require('path');
const archiver = require('../archiver');

module.exports = async (io, data) => {
    let shop = data.website ? data.website.trim() : "";
    let apiCredentials = data.apiCredentials ? data.apiCredentials.trim() : "";
    let themeId = data.themeId ? data.themeId.trim() : "";

    if (!shop || !apiCredentials || !themeId) {
        io.emit(data.token, { progress: "Scraping failed: Missing Shopify Store URL, Access Token, or Theme ID." });
        return;
    }

    // Clean shop name, e.g. "my-store.myshopify.com"
    shop = shop.replace(/^https?:\/\//i, '').split('/')[0];
    if (!shop.endsWith('.myshopify.com')) {
        shop = shop + '.myshopify.com';
    }

    const websiteFolder = `${shop}-${themeId}`;
    const targetDir = path.join(__dirname, '../', websiteFolder);

    // Clean up existing directory if present
    if (fs.existsSync(targetDir)) {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
        } catch (e) {
            console.error("Error cleaning existing dir:", e);
        }
    }
    fs.mkdirSync(targetDir, { recursive: true });

    // Setup headers
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (apiCredentials.includes(':')) {
        headers['Authorization'] = 'Basic ' + Buffer.from(apiCredentials).toString('base64');
    } else {
        headers['X-Shopify-Access-Token'] = apiCredentials;
    }

    try {
        io.emit(data.token, { progress: "Connecting to Shopify Admin API..." });
        
        // 1. Get assets list
        const listUrl = `https://${shop}/admin/api/2023-10/themes/${themeId}/assets.json`;
        const response = await got(listUrl, { headers, responseType: 'json' });
        const assets = response.body.assets;
        
        if (!assets || assets.length === 0) {
            throw new Error("No assets found in this theme, or authorization denied.");
        }
        
        const totalAssets = assets.length;
        io.emit(data.token, { progress: `Total theme assets to download: ${totalAssets}` });

        // 2. Download assets sequentially with rate limiting
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < totalAssets; i++) {
            const assetKey = assets[i].key;
            const currentIndex = i + 1;
            const percentComplete = Math.round((currentIndex / totalAssets) * 100);

            // Fetch individual asset detail
            const assetDetailUrl = `https://${shop}/admin/api/2023-10/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`;
            
            try {
                const assetResponse = await got(assetDetailUrl, { headers, responseType: 'json' });
                const asset = assetResponse.body.asset;

                if (asset) {
                    const filePath = path.join(targetDir, assetKey);
                    const fileDir = path.dirname(filePath);

                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }

                    // Save file: decode base64 for attachment, otherwise write text value
                    if (asset.attachment) {
                        fs.writeFileSync(filePath, Buffer.from(asset.attachment, 'base64'));
                    } else if (asset.value !== undefined) {
                        fs.writeFileSync(filePath, asset.value, 'utf8');
                    }
                    
                    io.emit(data.token, { progress: `200 OK [${currentIndex}/${totalAssets}] ${percentComplete}% | ${assetKey}` });
                }
            } catch (assetErr) {
                console.error(`Failed to download asset ${assetKey}:`, assetErr);
                io.emit(data.token, { progress: `Error [${currentIndex}/${totalAssets}] Failed to download: ${assetKey}` });
            }

            // Shopify Rest API limits: wait 300ms to stay within limits (2 calls per second)
            await delay(300);
        }

        // Package files
        io.emit(data.token, { progress: "Converting" });
        archiver(websiteFolder, io, data);

    } catch (err) {
        console.error("Shopify download error:", err);
        if (fs.existsSync(targetDir)) {
            try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (rmErr) {}
        }
        io.emit(data.token, { progress: `Scraping failed: ${err.message}` });
    }
};
