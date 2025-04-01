const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

// Function to capture m3u8 URLs from a stream page
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
        console.log("Waiting for network responses...");
        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15s for m3u8
        return { m3u8Urls: Array.from(m3u8Urls) };
    } catch (error) {
        console.error(`Error navigating to ${url}:`, error.message);
        return { m3u8Urls: [] };
    }
}

// Function to get up to two streams for a source
async function getStreamsForSource(source, id, page) {
    const sourceUrl = `https://streamed.su/watch/${id}/${source}`;
    console.log("Navigating to source page:", sourceUrl);
    try {
        await page.goto(sourceUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        const streams = await page.evaluate(() => {
            const h1Elements = document.querySelectorAll('h1.overflow-hidden.whitespace-nowrap.text-ellipsis');
            return Array.from(h1Elements).slice(0, 2).map(h1 => {
                const streamNo = h1.textContent.trim().replace('Stream ', '') || 'Unknown';
                const languageDiv = h1.nextElementSibling;
                const language = languageDiv?.textContent.trim() || 'Unknown';
                return { streamNo, language };
            });
        });
        console.log(`Found ${streams.length} streams for source ${source} (limited to 2)`);

        const streamData = [];
        for (const stream of streams) {
            const { m3u8Urls } = await getM3u8(source, id, stream.streamNo, page);
            if (m3u8Urls.length > 0) {
                streamData.push({
                    source,
                    streamNo: stream.streamNo,
                    language: stream.language,
                    m3u8: m3u8Urls
                });
            }
        }
        return streamData;
    } catch (error) {
        console.error(`Error scraping source page ${sourceUrl}:`, error.message);
        return [];
    }
}

// Main function to scrape categories and collect streams
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

    // Apply stealth settings to avoid detection
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
    });

    // Define categories to scrape
    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts',
        'https://streamed.su/category/other'
    ];
    let allGames = [];

    // Scrape games from each category
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
                    return { id, title };
                }).filter(game => game.id);
            });
            allGames = allGames.concat(games);
            console.log(`Found ${games.length} games in ${categoryUrl}`);
        } catch (error) {
            console.error(`Error scraping ${categoryUrl}:`, error.message);
        }
    }
    console.log("Total games:", allGames.length);

    // Define sources to check
    const sources = ['admin', 'alpha', 'charlie', 'delta', 'echo', 'foxtrot'];
    let streams = [];

    // Collect streams for each game
    for (const game of allGames) {
        const teamStreams = [];
        for (const source of sources) {
            const streamsForSource = await getStreamsForSource(source, game.id, page);
            teamStreams.push(...streamsForSource);
        }
        if (teamStreams.length > 0) {
            streams.push({
                id: game.id,
                title: game.title,
                streams: teamStreams
            });
        }
    }

    // Save to streams.json
    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Saved streams to streams.json");

    await browser.close();
}

scrapeSpecificCategories()
    .then(() => console.log("Scraping completed"))
    .catch(err => console.error("Scraping failed:", err));