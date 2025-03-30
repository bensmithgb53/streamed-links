const puppeteer = require('puppeteer-extra');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Apply plugins
puppeteer.use(StealthPlugin());
puppeteer.use(
  RecaptchaPlugin({
    provider: { id: '2captcha', token: 'YOUR_2CAPTCHA_API_KEY_HERE' } // Replace with your real 2Captcha token
  })
);

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set();
    const responseHandler = async (response) => {
        const url = response.url();
        console.log("Response:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
        } else if (url.includes('challenges.cloudflare.com')) {
            console.log("Cloudflare Turnstile detected! Attempting to solve...");
        }
    };
    page.on("response", responseHandler);

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(Math.random() * 3000 + 2000); // Random 2-5s delay

        // Check for Turnstile and solve
        const turnstilePresent = await page.evaluate(() => !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
        if (turnstilePresent) {
            console.log("Solving Turnstile CAPTCHA...");
            const { captchas, solutions, solved, error } = await page.solveRecaptchas();
            if (solved && solved.length > 0) {
                console.log("✔️ Turnstile solved successfully");
            } else {
                throw new Error(`Failed to solve Turnstile: ${error || 'Unknown error'}`);
            }
            await page.waitForTimeout(5000); // Wait for page to update after solving
        }

        await page.mouse.move(Math.random() * 800, Math.random() * 600); // Fake mouse
        await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200)); // Random scroll
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

async function scrapeMatches(source, id, streamNo) {
    const browser = await puppeteer.launch({
        headless: true, // For GitHub Actions
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    const page = await browser.newPage();

    // Stealth tweaks
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        window.navigator.chrome = { runtime: {} };
    });

    await page.setExtraHTTPHeaders({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://streamed.su/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive"
    });

    // Headers for m3u8 scraping
    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top"
    });

    let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];

    const match = { id, sources: [{ source }] };
    let gameStreams = [];
    try {
        const { title, m3u8Urls } = await getM3u8(source, match.id, streamNo, page);
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
