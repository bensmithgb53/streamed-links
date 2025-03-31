.const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch'); // Added for API fetching
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    const m3u8Set = new Set();
    const m3u8Urls = [];

    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes('.m3u8')) {
            const urlParams = new URLSearchParams(url.split('?')[1] || '');
            const md5 = urlParams.get('md5') || '';
            const expiry = urlParams.get('expiry') || '';
            const key = `${md5}:${expiry}`;
            if (!m3u8Set.has(key)) {
                m3u8Set.add(key);
                m3u8Urls.push(url);
                console.log("Found unique m3u8:", url);
            } else {
                console.log("Skipping duplicate m3u8 (same md5/expiry):", url);
            }
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    // Fallback to embedstreams.top if no m3u8 found yet
    if (m3u8Urls.length === 0) {
        const fallbackUrl = `https://embedstreams.top/embed/${source}/${id}/${streamNo}`;
        console.log("No m3u8 found, trying fallback:", fallbackUrl);
        await page.goto(fallbackUrl, { waitUntil: 'networkidle0', timeout: 0 });
    }

    const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
    console.log("Title extracted:", title);

    console.log("Waiting for network responses...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log("Final m3u8Urls:", m3u8Urls.length > 0 ? m3u8Urls : "Not found");
    return { title, m3u8Urls: m3u8Urls.length > 0 ? m3u8Urls : [] };
}

async function scrapeFromApi() {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
    });

    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    // Automatically fetch API data from streamed.su/api/matches/all
    console.log("Fetching API data from https://streamed.su/api/matches/all...");
    let apiData;
    try {
        const response = await fetch('https://streamed.su/api/matches/all', {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                "Referer": "https://streamed.su/"
            }
        });
        if (!response.ok) {
            throw new Error(`API request failed with status: ${response.status}`);
        }
        apiData = await response.json();
        console.log(`Retrieved ${apiData.length} games from API`);
    } catch (error) {
        console.error("Failed to fetch API data:", error.message);
        await browser.close();
        return; // Exit if API fetch fails
    }

    let streams = [];

    for (const game of apiData) {
        for (const sourceObj of game.sources) {
            const source = sourceObj.source;
            const { title, m3u8Urls } = await getM3u8(source, game.id, 1, page);
            if (m3u8Urls.length > 0) {
                streams.push({
                    id: game.id,
                    title: game.title,
                    source: source,
                    m3u8: m3u8Urls.map(url => ({
                        m3u8: url,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                            "Referer": "https://embedme.top/"
                        }
                    }))
                });
                console.log(`Added ${game.id} (${source}) with ${m3u8Urls.length} streams`);
            }
        }
    }

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Overwrote streams.json with new data");

    await browser.close();
}

scrapeFromApi().then(() => console.log("Scraping completed")).catch(err => {
    console.error("Error:", err);
});