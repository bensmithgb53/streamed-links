const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set(); // Use Set to avoid duplicates within this call
    const responseHandler = async (response) => {
        const url = response.url();
        console.log("Response:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url); // Add unique URLs
            console.log("Found m3u8:", url);
        }
    };
    page.on("response", responseHandler);

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
    console.log("Title extracted:", title);

    // Wait to capture all network responses
    console.log("Waiting for network responses...");
    await new Promise(resolve => setTimeout(resolve, 20000)); // 20s wait

    // Remove the listener using page.off instead of page.removeListener
    page.off("response", responseHandler);

    console.log("Final m3u8Urls value:", m3u8Urls.size > 0 ? Array.from(m3u8Urls) : "Not found");
    return { title, m3u8Urls: Array.from(m3u8Urls) };
}

async function scrapeAllGames() {
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

    // Scrape game IDs from streamed.su
    console.log("Scraping game IDs from streamed.su...");
    await page.goto('https://streamed.su', { waitUntil: 'networkidle0', timeout: 0 });

    const games = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/watch/"]'));
        return links.map(link => {
            const href = link.getAttribute('href');
            const id = href.split('/watch/')[1]?.split('/')[0];
            const title = link.textContent.trim() || href.split('/')[2];
            return { id, title };
        }).filter(game => game.id);
    });
    console.log("Found games:", games);

    const sources = ['alpha', 'bravo', 'charlie']; // Expand as needed
    const maxStreamNo = 3; // Adjust based on how many streams per source
    let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];

    for (const game of games) {
        for (const source of sources) {
            let gameStreams = [];
            for (let streamNo = 1; streamNo <= maxStreamNo; streamNo++) {
                const { title, m3u8Urls } = await getM3u8(source, game.id, streamNo, page);
                if (m3u8Urls.length > 0) {
                    gameStreams.push(...m3u8Urls.map(url => ({
                        m3u8: url,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                            "Referer": "https://embedme.top/"
                        }
                    })));
                }
            }

            if (gameStreams.length > 0) {
                // Remove duplicates within this source
                const uniqueStreams = [];
                const seenUrls = new Set();
                for (const stream of gameStreams) {
                    if (!seenUrls.has(stream.m3u8)) {
                        seenUrls.add(stream.m3u8);
                        uniqueStreams.push(stream);
                    }
                }

                // Check if entry exists
                let existingEntry = streams.find(s => s.id === game.id && s.source === source);
                if (existingEntry) {
                    const existingUrls = new Set(existingEntry.m3u8.map(item => item.m3u8));
                    uniqueStreams.forEach(newStream => {
                        if (!existingUrls.has(newStream.m3u8)) {
                            existingEntry.m3u8.push(newStream);
                        }
                    });
                } else {
                    streams.push({
                        id: game.id,
                        title: game.title,
                        source: source,
                        m3u8: uniqueStreams
                    });
                }
                console.log(`Added ${game.id} (${source}) with ${uniqueStreams.length} unique streams`);
            }
        }
    }

    // Save to streams.json
    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Saved all streams to streams.json");

    await browser.close();
}

scrapeAllGames().then(() => console.log("Scraping completed"));