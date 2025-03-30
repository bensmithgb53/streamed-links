const { chromium } = require('playwright');
const fs = require('fs');

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
        // Simulate human-like navigation
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(Math.random() * 5000 + 3000); // Random 3-8s delay
        await page.mouse.move(Math.random() * 800, Math.random() * 600); // Fake mouse movement
        await page.mouse.click(Math.random() * 800, Math.random() * 600); // Fake click
        await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200)); // Random scroll
        await page.keyboard.press('Tab'); // Fake keyboard input
        await page.waitForTimeout(Math.random() * 2000 + 1000); // Additional delay
        await page.waitForLoadState('networkidle', { timeout: 30000 }); // Wait for network
    } catch (error) {
        console.error(`Navigation failed: ${error.message}`);
        throw error;
    }

    const title = await page.title() || "Unknown";
    console.log("Title extracted:", title);

    return { title, m3u8Urls: Array.from(m3u8Urls) };
}

async function scrapeMatches(source, id, streamNo) {
    const browser = await chromium.launch({
        headless: true, // Required for GitHub Actions
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process' // Extreme measures for CI
        ]
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
        timezoneId: 'America/New_York' // Fake timezone
    });

    const page = await context.newPage();

    // Aggressive stealth
    await page.evaluateOnNewPage(() => {
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

    // Headers for m3u8 scraping
    await context.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top"
    });

    let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];

    const match = { id, sources: [{ source }] };
    let gameStreams = [];
    try {
        const { title, m3u8Urls } = await getM3u8(source, match  await page.waitForTimeout(Math.random() * 2000 + 1000); // Random delay
        if (m3u8Urls.length > 0) {
            gameStreams.push(...m3u8Urls.map(url => ({
                source,
                m3u8: url,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                    "Referer": "https://embedme.top/"
                }
            })));
        }
    } catch (error) {
        console.error(`Failed for ${match.id}/${source}/${streamNo}: ${error.message}`);
        await browser.close();
        console.log("Script terminated due to access failure.");
        return;
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

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Saved all streams to streams.json");

    await browser.close();
}

const [source, id, streamNo] = process.argv.slice(2);
if (!source || !id || !streamNo) {
    console.error("Please provide source, id, and streamNo: node index.js alpha sky-sports-darts 1");
    process.exit(1);
}

scrapeMatches(source, id, parseInt(streamNo))
    .then(() => console.log("Scraping completed"))
    .catch(err => console.error("Scraping failed:", err));