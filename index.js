const { chromium } = require('playwright');
const fetch = require('node-fetch');
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

    // Monitor main page responses
    page.on('response', async (response) => {
        const url = response.url();
        console.log("Main Network:", url);
        if (url.includes('.m3u8') || url.includes('rr.vip')) {
            m3u8Urls.add(url);
            console.log("Found m3u8/rr.vip:", url);
        } else if (url.includes('challenges.cloudflare.com')) {
            console.log("Cloudflare Turnstile detected");
        }
    });

    // Monitor iframe responses
    page.on('framenavigated', async (frame) => {
        if (frame.url().includes('embedstreams.top')) {
            console.log("Iframe detected:", frame.url());
            frame.on('response', async (response) => {
                const url = response.url();
                console.log("Iframe Network:", url);
                if (url.includes('.m3u8') || url.includes('rr.vip')) {
                    m3u8Urls.add(url);
                    console.log("Found iframe m3u8/rr.vip:", url);
                }
            });
        }
    });

    page.on('console', msg => console.log("Console:", msg.text()));

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);

    try {
        await page.waitForTimeout(Math.floor(Math.random() * 3000) + 2000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        const cfChallenge = await page.$('iframe[src*="challenges.cloudflare.com"]');
        if (cfChallenge) {
            console.log("Cloudflare challenge detected, waiting 20s...");
            await page.waitForTimeout(20000);
            if (await page.$('iframe[src*="challenges.cloudflare.com"]')) {
                console.log("Cloudflare persists, proceeding anyway...");
            }
        }

        // Debug player and iframe state
        const playerState = await page.evaluate(() => {
            const video = document.querySelector('video');
            const player = document.querySelector('[id*="player"], [class*="player"]');
            const iframe = document.querySelector('iframe[src*="embedstreams"]');
            return {
                video: !!video,
                player: !!player,
                videoSrc: video?.src || 'none',
                iframeSrc: iframe?.src || 'none',
                buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean)
            };
        });
        console.log("Player state:", JSON.stringify(playerState));

        // Interact with player
        await page.evaluate(() => {
            const triggers = document.querySelectorAll('video, [id*="player"], [class*="player"], button, iframe');
            triggers.forEach((trigger, index) => {
                setTimeout(() => {
                    trigger.click();
                    const move = new MouseEvent('mousemove', { bubbles: true, clientX: 400 + index * 10, clientY: 300 + index * 10 });
                    document.dispatchEvent(move);
                }, index * 1000); // Stagger clicks
            });
            window.scrollTo(0, 500);
        });
        await page.waitForTimeout(60000); // 60s for stream

        // Final check
        console.log("Final m3u8/rr.vip count:", m3u8Urls.size);

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
        '--disable-web-security',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ];

    const browser = await chromium.launch({ headless: true, args: browserArgs });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'userAgent', {
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        });
        window.chrome = { runtime: {}, app: {}, webstore: {} };
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel';
            if (parameter === 37446) return 'Mesa Intel(R) UHD Graphics';
            return getParameter.apply(this, arguments);
        };
    });

    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
        "Referer": "https://streamed.su/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
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
                    await newContext.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => false });
                        Object.defineProperty(navigator, 'userAgent', {
                            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                        });
                        window.chrome = { runtime: {}, app: {}, webstore: {} };
                        const getParameter = WebGLRenderingContext.prototype.getParameter;
                        WebGLRenderingContext.prototype.getParameter = function(parameter) {
                            if (parameter === 37445) return 'Intel';
                            if (parameter === 37446) return 'Mesa Intel(R) UHD Graphics';
                            return getParameter.apply(this, arguments);
                        };
                    });
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
                        await newContext.addInitScript(() => {
                            Object.defineProperty(navigator, 'webdriver', { get: () => false });
                            Object.defineProperty(navigator, 'userAgent', {
                                get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                            });
                            window.chrome = { runtime: {}, app: {}, webstore: {} };
                            const getParameter = WebGLRenderingContext.prototype.getParameter;
                            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                                if (parameter === 37445) return 'Intel';
                                if (parameter === 37446) return 'Mesa Intel(R) UHD Graphics';
                                return getParameter.apply(this, arguments);
                            };
                        });
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
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                                    "Referer": "https://streamed.su/"
                                }
                            }))
                        });
                        console.log(`Added ${game.id} (${source}) with ${m3u8Urls.length} streams`);
                    }
                    await page.waitForTimeout(7000);
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