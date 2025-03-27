const puppeteer = require('puppeteer');
const fs = require('fs').promises;

async function getM3u8FromEmbed(embedUrl) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    const m3u8Urls = new Set();
    page.on('request', request => {
        const url = request.url();
        if (url.endsWith('.m3u8')) {
            m3u8Urls.add(url);
            console.log(`Found m3u8: ${url}`);
        }
    });

    console.log(`Navigating to embed URL: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'networkidle2' });

    // Try to start the stream
    await page.waitForTimeout(10000);
    await page.evaluate(() => {
        const playButton = document.querySelector('button[class*="play"], video, #player, .vjs-big-play-button');
        if (playButton) playButton.click();
    });
    await page.waitForTimeout(10000);

    await browser.close();
    return Array.from(m3u8Urls); // Return all found m3u8 URLs
}

async function findEmbedLinksAndGetM3u8(source, id, streamNo) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        "Referer": "https://streamed.su/",
        "Origin": "https://streamed.su",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    const watchUrl = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log(`Navigating to hub URL: ${watchUrl}`);
    await page.goto(watchUrl, { waitUntil: 'networkidle2' });

    // Wait for dynamic content
    await page.waitForTimeout(5000);

    // Find all embed links
    const embedLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, iframe, script[src]'));
        return links
            .map(link => link.href || link.src)
            .filter(url => url && url.includes('https://embedme.top/embed/'));
    });

    console.log(`Found ${embedLinks.length} embed links:`);
    embedLinks.forEach(link => console.log(link));

    await browser.close();

    // Visit each embed link and collect m3u8 URLs
    const allM3u8Urls = [];
    for (const embedLink of embedLinks) {
        const m3u8Urls = await getM3u8FromEmbed(embedLink);
        allM3u8Urls.push(...m3u8Urls);
    }

    return allM3u8Urls.length > 0 ? allM3u8Urls : ["No m3u8 found"];
}

async function updateStreams() {
    const data = {
        "sky-sports-darts": {
            "matchId": "sky-sports-darts",
            "source": "alpha",
            "m3u8_urls": [] // Changed to array to store multiple URLs
        },
        "maccabi-tel-aviv-vs-panathinaikos-maccabi-tel-aviv-vs-panathinaikos": {
            "matchId": "maccabi-tel-aviv-vs-panathinaikos",
            "source": "alpha",
            "m3u8_urls": []
        }
        // Add more entries as needed
    };

    for (const key in data) {
        const { source, matchId } = data[key];
        const m3u8Urls = await findEmbedLinksAndGetM3u8(source, matchId, 1);
        data[key].m3u8_urls = m3u8Urls;
    }

    await fs.writeFile('streams.json', JSON.stringify(data, null, 2));
    console.log("Updated streams.json with m3u8 URLs");
}

updateStreams().catch(err => console.error(err));