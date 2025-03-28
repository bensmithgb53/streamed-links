const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set();
    const responseHandler = async (response) => {
        const url = response.url();
        console.log("Response:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
        } else if (url.includes('challenges.cloudflare.com')) {
            console.log("Cloudflare Turnstile detected! Attempting to wait...");
            throw new Error("Cloudflare block encountered");
        }
    };
    page.on("response", responseHandler);

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    try {
        // Simulate human-like navigation
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(Math.random() * 2000 + 1000); // Random 1-3s delay
        await page.mouse.move(Math.random() * 800, Math.random() * 600); // Random mouse movement
        await page.evaluate(() => window.scrollBy(0, 500)); // Scroll a bit

        // Wait for network to settle
        await page.waitForNetworkIdle({ idleTime: 5000, timeout: 30000 });
    } catch (error) {
        console.error(`Navigation failed: ${error.message}`);
        throw error;
    }

    const title = await page.evaluate(() => document.title || "Unknown");
    console.log("Title extracted:", title);

    page.off("response", responseHandler);
    return { title, m3u8Urls: Array.from(m3u8Urls) };
}

async function fetchMatches(page) {
    console.log("Fetching matches from API...");
    try {
        await page.goto('https://streamed.su/api/matches/all', { waitUntil: 'networkidle0', timeout: 60000 });
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

async function scrapeMatches(source, id, streamNo) {
    const browser = await puppeteer.launch({
        headless: true, // Set to false for debugging if needed
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
        Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
    });

    await page.setExtraHTTPHeaders({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://streamed.su/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
    });

    // Fetch matches if no specific ID provided
    let matches = [];
    if (!id) {
        try {
            matches = await fetchMatches(page);
        } catch (error) {
            await browser.close();
            console.log("Script terminated due to API access failure.");
            return;
        }
    } else {
        matches = [{ id, sources: [{ source }] }]; // Single match mode
    }

    // Headers for m3u8 scraping
    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];

    for (const match of matches) {
        let gameStreams = [];
        const matchSources = id ? [source] : match.sources.map(s => s.source); // Use CLI source or API sources
        for (const src of matchSources) {
            for (let num = id ? streamNo : 1; num <= (id ? streamNo : 3); num++) {
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
                    await browser.close();
                    console.log("Script terminated due to access failure.");
                    return;
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
}

const [source, id, streamNo] = process.argv.slice(2);
scrapeMatches(source, id, parseInt(streamNo))
    .then(() => console.log("Scraping completed"))
    .catch(err => console.error("Scraping failed:", err));