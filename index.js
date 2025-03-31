const { chromium } = require('playwright');
const fs = require('fs');
const fetch = require('node-fetch');

async function getFreeProxy() {
    try {
        const response = await fetch('https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all');
        const text = await response.text();
        const proxies = text.split('\r\n').filter(line => line.trim()).slice(0, 5); // Top 5 proxies
        if (proxies.length === 0) throw new Error("No proxies available");
        const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
        console.log("Using proxy:", randomProxy);
        return randomProxy;
    } catch (error) {
        console.error("Failed to fetch proxy:", error.message);
        return null;
    }
}

async function fetchMatches(page) {
    console.log("Fetching matches from API...");
    try {
        await page.goto('https://streamed.su/api/matches/all', { waitUntil: 'networkidle', timeout: 60000 });
        const content = await page.content();
        if (content.includes('challenges.cloudflare.com')) {
            throw new Error("Cloudflare blocked API access");
        }
        const matches = await page.evaluate(() => JSON.parse(document.body.textContent));
        console.log("Found matches:", matches.length);
        return matches;
    } catch (error) {
        console.error(`API fetch failed: ${error.message}`);
        throw error;
    }
}

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set();
    page.on('response', (response) => {
        const url = response.url();
        console.log("Response:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
        } else if (url.includes('challenges.cloudflare.com')) {
            console.log("Cloudflare Turnstile detected!");
            throw new Error("Cloudflare block encountered");
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(Math.random() * 5000 + 3000);
        await page.mouse.move(Math.random() * 800, Math.random() * 600);
        await page.mouse.click(Math.random() * 800, Math.random() * 600);
        await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200));
        await page.keyboard.press('Tab');
        await page.waitForTimeout(Math.random() * 2000 + 1000);
        await page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch (error) {
        console.error(`Navigation failed: ${error.message}`);
        throw error;
    }

    const title = await page.title() || "Unknown";
    console.log("Title extracted:", title);

    return { title, m3u8Urls: Array.from(m3u8Urls) };
}

async function scrapeMatches() {
    let proxy = await getFreeProxy();
    let attempts = 0;
    const maxAttempts = 5;
    const sportsFilter = ['football', 'darts', 'other', 'fighting'];

    while (attempts < maxAttempts) {
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ];
        if (proxy) {
            browserArgs.push(`--proxy-server=http://${proxy}`);
        }

        const browser = await chromium.launch({
            headless: true,
            args: browserArgs
        });
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                "Referer": "https://streamed.su/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            },
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        const page = await context.newPage();

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            window.navigator.chrome = { runtime: {} };
            Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
            Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
            Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
            Object.defineProperty(screen, 'availHeight', { get: () => 1080 });
            Object.defineProperty(screen, 'width', { get: () => 1920 });
            Object.defineProperty(screen, 'height', { get: () => 1080 });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
            Object.defineProperty(window, 'chrome', { get: () => ({}) });
            Object.defineProperty(window, 'performance', {
                get: () => ({
                    timing: {},
                    navigation: { type: 0 },
                    memory: { jsHeapSizeLimit: 4294705152 }
                })
            });
        });

        await context.setExtraHTTPHeaders({
            "Referer": "https://embedme.top/",
            "Origin": "https://embedme.top"
        });

        let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];

        try {
            const matches = await fetchMatches(page);
            const filteredMatches = matches.filter(match => {
                const sport = match.title?.toLowerCase() || '';
                return sportsFilter.some(category => sport.includes(category));
            });
            console.log(`Filtered ${filteredMatches.length} matches for football, darts, other, fighting`);

            for (const match of filteredMatches) {
                let gameStreams = [];
                const matchSources = match.sources.map(s => s.source);

                for (const src of matchSources) {
                    for (let num = 1; num <= 3; num++) {
                        try {
                            const { title, m3u8Urls } = await getM3u8(src, match.id, num, page);
                            if (m3u8Urls.length > 0) {
                                gameStreams.push(...m3u8Urls.map(url => ({
                                    source: src,
                                    m3u8: url,
                                    headers: {
                                        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                                        "Referer": "https://embedme.top/"
                                    }
                                })));
                            }
                        } catch (error) {
                            console.error(`Failed for ${match.id}/${src}/${num}: ${error.message}`);
                            throw error; // Retry with next proxy
                        }
                    }
                }

                if (gameStreams.length > 0) {
                    const uniqueStreams = [];
                    const seenUrls = new Set();
                    for (const stream of gameStreams) {
                        if (!seenUrls.has(stream.m3u8)) {
                            seenUrls.add(stream.m3u8);
                            uniqueStreams.push(stream);
                        }
                    }

                    let existingEntry = streams.find(s => s.id === match.id);
                    if (existingEntry) {
                        const existingUrls = new Set(existingEntry.m3u8.map(item => item.m3u8));
                        uniqueStreams.forEach(newStream => {
                            if (!existingUrls.has(newStream.m3u8)) {
                                existingEntry.m3u8.push(newStream);
                            }
                        });
                    } else {
                        streams.push({
                            id: match.id,
                            title: match.title || `Stream ${match.id}`,
                            m3u8: uniqueStreams
                        });
                    }
                    console.log(`Added ${match.id} with ${uniqueStreams.length} unique streams`);
                }
            }

            fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
            console.log("Saved all streams to streams.json");
            await browser.close();
            return;
        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed with proxy ${proxy || 'none'}: ${error.message}`);
            await browser.close();
            attempts++;
            proxy = attempts < maxAttempts ? await getFreeProxy() : null;
            if (!proxy) {
                console.log("No more proxies available. Terminating.");
                return;
            }
        }
    }
    console.log("All proxy attempts failed.");
}

scrapeMatches()
    .then(() => console.log("Scraping completed"))
    .catch(err => console.error("Scraping failed:", err));