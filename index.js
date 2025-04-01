const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set();
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
        
        // Check page content length to ensure it loaded
        const content = await page.content();
        console.log("Page content length:", content.length);
        if (content.length < 1000) {
            console.warn("Page might not have loaded correctly (content too small).");
        }

        const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
        console.log("Title extracted:", title);

        // Look for embedded m3u8 URLs in the page
        const pageM3u8 = await page.evaluate(() => {
            const m3u8Links = Array.from(document.querySelectorAll('a[href$=".m3u8"], source[src$=".m3u8"], video[src$=".m3u8"]'));
            return m3u8Links.map(link => link.href || link.src).filter(url => url);
        });
        pageM3u8.forEach(url => m3u8Urls.add(url));

        console.log("Waiting for network responses...");
        await new Promise(resolve => setTimeout(resolve, 15000)); // Increased to 15s

        const uniqueM3u8Array = Array.from(m3u8Urls);
        console.log("Final m3u8Urls:", uniqueM3u8Array.length > 0 ? uniqueM3u8Array : "Not found");
        return { title, m3u8Urls: uniqueM3u8Array.length > 0 ? uniqueM3u8Array : [] };
    } catch (error) {
        console.error(`Error navigating to ${url}:`, error.message);
        return { title: id, m3u8Urls: [] };
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

    // Log console errors from the page
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts',
        'https://streamed.su/category/other'
    ];
    let allGames = [];

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
                    return { id, title, href }; // Include href for debugging
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
    const maxStreamNo = 1;
    let streams = [];

    for (const game of allGames) {
        for (const source of sources) {
            const { title, m3u8Urls } = await getM3u8(source, game.id, 1, page);
            if (m3u8Urls.length > 0) {
                streams.push({
                    id: game.id,
                    title: game.title,
                    source: source,
                    m3u8: m3u8Urls
                });
                console.log(`Added ${game.id} (${source}) with ${m3u8Urls.length} streams`);
            }
        }
    }

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Overwrote streams.json with new data");

    await browser.close();
}

scrapeSpecificCategories().then(() => console.log("Scraping completed")).catch(err => console.error("Scraping failed:", err));