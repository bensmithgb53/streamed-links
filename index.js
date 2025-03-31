const { chromium } = require('playwright');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

async function getFreeProxy() {
    try {
        const response = await fetch('https://www.proxy-list.download/api/v1/get?type=http');
        const text = await response.text();
        const proxies = text.split('\r\n').filter(line => line.trim()).slice(0, 5);
        const proxy = proxies[Math.floor(Math.random() * proxies.length)];
        console.log("Using proxy:", proxy);
        return proxy || null;
    } catch (error) {
        console.error("Proxy fetch failed:", error.message);
        return null;
    }
}

async function getM3u8(source, id, streamNo, page, proxy) {
    let m3u8Urls = new Set();
    page.on('response', async (response) => {
        const url = response.url();
        console.log("Network:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
            console.log("Found m3u8:", url);
        } else if (url.includes('challenges.cloudflare.com')) {
            throw new Error("Cloudflare block detected");
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);

    try {
        // Random delay to mimic human navigation
        await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        // Check for Cloudflare challenge
        const cfChallenge = await page.$('iframe[src*="challenges.cloudflare.com"]');
        if (cfChallenge) {
            console.log("Cloudflare challenge detected, attempting to wait...");
            await page.waitForTimeout(10000); // Wait for potential auto-solve
            if (await page.$('iframe[src*="challenges.cloudflare.com"]')) {
                throw new Error("Cloudflare challenge persists");
            }
        }

        // Wait for video player and simulate human interaction
        await page.waitForSelector('video, [class*="player"], button', { timeout: 15000 });
        await page.evaluate(() => {
            const trigger = document.querySelector('video, [class*="player"], button');
            if (trigger) {
                trigger.click();
                // Simulate mouse movement
                const event = new MouseEvent('mousemove', {
                    bubbles: true,
                    clientX: Math.random() * 500,
                    clientY: Math.random() * 500
                });
                document.dispatchEvent(event);
            }
        });
        await page.waitForTimeout(20000); // Wait for stream

        const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
        console.log("Title:", title);
        return { title, m3u8Urls: Array.from(m3u8Urls) };
    } catch (error) {
        throw new Error(`Failed ${id}/${source}/${streamNo}: ${error.message}`);
    }
}

async function scrapeSpecificCategories() {
    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    ];

    const browser = await chromium.launch({ headless: true, args: browserArgs });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
        "Referer": "https://streamed.su/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin"
    });

    // Spoof navigator properties
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
    });

    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts'
    ];
    let allGames = [];

    for (const categoryUrl of categories) {
        console.log(`Scraping ${categoryUrl}...`);
        let proxy = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                if (proxy) {
                    await context.close();
                    const newContext = await browser.newContext({ proxy: { server: `http://${proxy}` } });
                    page.close();
                    page = await newContext.newPage();
                    await page.setExtraHTTPHeaders({ "Referer": "https://streamed.su/" });
                }
                await page.goto(categoryUrl, { waitUntil: 'networkidle', timeout: 60000 });
                const games = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a[href*="/watch/"]')).map(link => {
                        const href = link.getAttribute('href');
                        const id = href.split('/watch/')[1]?.split('/')[0];
                        const title = link.textContent.trim() || href.split('/')[2];
                        return { id, title };
                    }).filter(game => game.id);
                });
                allGames = allGames.concat(games);
                console.log(`Found ${games.length} games`);
                break;
            } catch (error) {
                console.error(`Attempt ${attempts + 1} failed for ${categoryUrl}: ${error.message}`);
                attempts++;
                if (attempts === maxAttempts) throw new Error(`Failed ${categoryUrl} after ${maxAttempts} attempts`);
                proxy = await getFreeProxy();
            }
        }
    }
    console.log("Total games:", allGames.length);

    const sources = ['alpha', 'bravo', 'charlie'];
    let streams = [];
    let proxy = null;

    for (const game of allGames) {
        for (const source of sources) {
            let attempts = 0;
            const maxAttempts = 3;
            while (attempts < maxAttempts) {
                try {
                    if (proxy) {
                        await context.close();
                        const newContext = await browser.newContext({ proxy: { server: `http://${proxy}` } });
                        page.close();
                        page = await newContext.newPage();
                        await page.setExtraHTTPHeaders({ "Referer": "https://streamed.su/" });
                    }
                    const { title, m3u8Urls } = await getM3u8(source, game.id, 1, page, proxy);
                    if (m3u8Urls.length > 0) {
                        streams.push({
                            id: game.id,
                            title: game.title,
                            source: source,
                            m3u8: m3u8Urls.map(url => ({
                                m3u8: url,
                                headers: {
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                                    "Referer": "https://streamed.su/"
                                }
                            }))
                        });
                        console.log(`Added ${game.id} (${source}) with ${m3u8Urls.length} streams`);
                    }
                    await page.waitForTimeout(5000); // Delay between requests
                    break;
                } catch (error) {
                    console.error(`Attempt ${attempts + 1} failed for ${game.id}/${source}: ${error.message}`);
                    attempts++;
                    if (attempts === maxAttempts) {
                        console.warn(`Skipping ${game.id}/${source} after ${maxAttempts} attempts`);
                        break;
                    }
                    proxy = await getFreeProxy();
                }
            }
        }
    }

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Wrote streams.json");
    await browser.close();
}

scrapeSpecificCategories()
    .then(() => console.log("Done"))
    .catch(err => {
        console.error("Aborted:", err.message);
        process.exit(1);
    });