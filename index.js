const { chromium } = require('playwright');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

async function getFreeProxy() {
    try {
        const response = await fetch('https://free-proxy-list.net/');
        const text = await response.text();
        const proxies = text.match(/\d+\.\d+\.\d+\.\d+:\d+/g)?.slice(0, 5) || [];
        if (proxies.length === 0) throw new Error("No proxies available");
        const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
        console.log("Using proxy:", randomProxy);
        return randomProxy;
    } catch (error) {
        console.error("Failed to fetch proxy:", error.message);
        return null;
    }
}

async function getM3u8(source, id, streamNo, page, proxy) {
    let m3u8Urls = new Set();
    page.on('response', async (response) => {
        const url = response.url();
        console.log("Network response:", url);
        if (url.includes('.m3u8')) {
            m3u8Urls.add(url);
            console.log("Found m3u8:", url);
        } else if (url.includes('challenges.cloudflare.com')) {
            throw new Error("Cloudflare block encountered");
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
    ];
    if (proxy) {
        browserArgs.push(`--proxy-server=http://${proxy}`);
    }

    let title;
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
        // Click a video element to start the stream
        await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) video.click();
        });
        await page.evaluate(() => window.scrollBy(0, 500)); // Fallback scroll
        await page.waitForTimeout(20000); // 20s to catch stream
        title = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
        console.log("Title extracted:", title);
    } catch (error) {
        throw new Error(`Navigation failed for ${id}/${source}/${streamNo}: ${error.message}`);
    }

    const m3u8Array = Array.from(m3u8Urls);
    console.log("Final m3u8Urls:", m3u8Array.length > 0 ? m3u8Array : "Not found");
    return { title, m3u8Urls: m3u8Array };
}

async function scrapeSpecificCategories() {
    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
    ];

    const browser = await chromium.launch({ headless: true, args: browserArgs });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    const categories = [
        'https://streamed.su/category/football',
        'https://streamed.su/category/fight',
        'https://streamed.su/category/darts'
    ];
    let allGames = [];

    for (const categoryUrl of categories) {
        console.log(`Scraping ${categoryUrl}...`);
        let proxy = null;
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts) {
            try {
                await page.goto(categoryUrl, { waitUntil: 'networkidle0', timeout: 60000 });
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
                break;
            } catch (error) {
                console.error(`Attempt ${attempts + 1} failed for ${categoryUrl} with proxy ${proxy || 'none'}: ${error.message}`);
                attempts++;
                if (attempts === maxAttempts) {
                    await browser.close();
                    throw new Error(`Category scrape failed for ${categoryUrl} after ${maxAttempts} attempts`);
                }
                proxy = await getFreeProxy();
            }
        }
    }
    console.log("Total games:", allGames.length);

    const sources = ['alpha', 'bravo', 'charlie'];
    let streams = [];
    let proxy = null;

    for (const game of allGames) {
        for (const source of sources) {
            let attempts = 0;
            const maxAttempts = 2;
            while (attempts < maxAttempts) {
                try {
                    const { title, m3u8Urls } = await getM3u8(source, game.id, 1, page, proxy);
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
                    break;
                } catch (error) {
                    console.error(`Attempt ${attempts + 1} failed for ${game.id}/${source}/1 with proxy ${proxy || 'none'}: ${error.message}`);
                    attempts++;
                    if (attempts === maxAttempts) {
                        await browser.close();
                        throw new Error(`Failed after ${maxAttempts} attempts for ${game.id}/${source}/1`);
                    }
                    proxy = await getFreeProxy();
                }
            }
        }
    }

    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log("Wrote streams.json with new data");
    await browser.close();
}

scrapeSpecificCategories()
    .then(() => console.log("Scraping completed"))
    .catch(err => {
        console.error("Scraping aborted:", err.message);
        process.exit(1);
    });