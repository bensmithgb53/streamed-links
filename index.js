const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo, page) {
    let m3u8Urls = new Set(); // Use Set to avoid duplicates
    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url); // Add to Set (duplicates ignored)
            console.log("Found m3u8:", url);
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    const title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
    console.log("Title extracted:", title);

    console.log("Waiting for network responses...");
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10s wait

    const uniqueM3u8Array = Array.from(m3u8Urls); // Convert Set back to array
    console.log("Final m3u8Urls:", uniqueM3u8Array.length > 0 ? uniqueM3u8Array : "Not found");
    return { title, m3u8Urls: uniqueM3u8Array.length > 0 ? uniqueM3u8Array : [] };
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

    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts',
        'https://streamed.su/category/other' // Added new category
    ];
    let allGames = [];

    for (const categoryUrl of categories) {
        console.log(`Scraping ${categoryUrl}...`);
        await page.goto(categoryUrl, { waitUntil: 'networkidle0', timeout: 0 });

        const games = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/watch/"]'));
            return links.map(link => {
                const href = link.getAttribute('href');
                const id = href.split('/watch/')[1]?.split('/')[0];
                const title = link.textContent.trim() || href.split('/')[2];
                return { id, title };
            }).filter(game => game.id);
        });
        allGames = allGames.concat(games);
        console.log(`Found ${games.length} games in ${categoryUrl}`);
    }
    console.log("Total games:", allGames.length);

    const sources = ['admin', 'alpha', 'charlie', 'delta', 'echo', 'foxtrot']; // Updated sources
    const maxStreamNo = 1; // Still 1 for speed, adjust if needed
    let streams = [];

    for (const game of allGames) {
        for (const source of sources) {
            const { title, m3u8Urls } = await getM3u8(source, game.id, 1, page);
            if (m3u8Urls.length > 0) {
                streams.push({
                    id: game.id,
                    title: game.title,
                    source: source,
                    m3u8: m3u8Urls // Simplified, no headers
                });
                console.log(`Added ${game.id} (${source}) with ${m3u8Urls.length} streams`);
            }
        }
    }

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Overwrote streams.json with new data");

    await browser.close();
}

scrapeSpecificCategories().then(() => console.log("Scraping completed"));