const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set();
    let referer = '';
    let userAgent = '';

    // Capture referer and userAgent from m3u8 requests
    page.on("request", (request) => {
        if (request.url().includes('.m3u8')) {
            referer = request.headers()['referer'] || '';
            userAgent = request.headers()['user-agent'] || '';
        }
    });

    // Collect m3u8 URLs from responses
    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
            console.log("Found m3u8:", url);
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        const content = await page.content();
        console.log("Page content length:", content.length);
        if (content.length < 1000) {
            console.warn("Page might not have loaded correctly (content too small).");
        }

        const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
        console.log("Title extracted:", title);

        // Extract m3u8 URLs from page elements
        const pageM3u8 = await page.evaluate(() => {
            const m3u8Links = Array.from(document.querySelectorAll('a[href$=".m3u8"], source[src$=".m3u8"], video[src$=".m3u8"]'));
            return m3u8Links.map(link => link.href || link.src).filter(url => url);
        });
        pageM3u8.forEach(url => m3u8Urls.add(url));

        console.log("Waiting for network responses...");
        await new Promise(resolve => setTimeout(resolve, 15000));

        const uniqueM3u8Array = Array.from(m3u8Urls);
        console.log("Final m3u8Urls:", uniqueM3u8Array.length > 0 ? uniqueM3u8Array : "Not found");
        return { title, m3u8Urls: uniqueM3u8Array.length > 0 ? uniqueM3u8Array : [], referer, userAgent };
    } catch (error) {
        console.error(`Error navigating to ${url}:`, error.message);
        return { title: id, m3u8Urls: [], referer: '', userAgent: '' };
    }
}

async function scrapeSpecificCategories() {
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

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts',
        'https://streamed.su/category/other'
    ];
    let allGames = [];

    // Scrape games from categories
    for (const categoryUrl of categories) {
        console.log(`Scraping ${categoryUrl}...`);
        try {
            await page.goto(categoryUrl, { waitUntil: 'networkidle0', timeout: 30000 });

            const games = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="/watch/"]'));
                return links.map(link => {
                    const href = link.getAttribute('href');
                    const id = href.split('/watch/')[1]?.split('/')[0];
                    const title = link.textContent.trim() || href.split('/')[2];
                    return { id, title, href };
                }).filter(game => game.id);
            });

            console.log(`Found ${games.length} games in ${categoryUrl}:`, games.map(g => g.href));
            allGames = allGames.concat(games);
        } catch (error) {
            console.error(`Error scraping ${categoryUrl}:`, error.message);
        }
    }
    console.log("Total games:", allGames.length);
    console.log("All game IDs:", allGames.map(g => g.id));

    const sources = ['admin', 'alpha', 'charlie', 'delta', 'echo', 'foxtrot'];
    const maxStreamNo = 3; // Check up to 3 streams per source
    let streams = [];
    let globalReferer = '';
    let globalUserAgent = '';

    // Fetch streams for each game
    for (const game of allGames) {
        let gameStreams = {
            id: game.id,
            title: game.title,
            sources: []
        };

        for (const source of sources) {
            for (let streamNo = 1; streamNo <= maxStreamNo; streamNo++) {
                const { title, m3u8Urls, referer, userAgent } = await getM3u8(source, game.id, streamNo, page);
                if (m3u8Urls.length > 0) {
                    gameStreams.sources.push({
                        source,
                        m3u8: m3u8Urls
                    });
                    // Capture referer and userAgent only once
                    if (!globalReferer && referer) globalReferer = referer;
                    if (!globalUserAgent && userAgent) globalUserAgent = userAgent;
                }
            }
        }

        if (gameStreams.sources.length > 0) {
            streams.push(gameStreams);
        }
    }

    // Structure the output JSON
    const output = {
        user_agent: globalUserAgent,
        referer: globalReferer,
        streams: streams
    };

    fs.writeFileSync('streams.json', JSON.stringify(output, null, 2));
    console.log("Overwrote streams.json with new data");

    await browser.close();
}

scrapeSpecificCategories().then(() => console.log("Scraping completed")).catch(err => console.error("Scraping failed:", err));