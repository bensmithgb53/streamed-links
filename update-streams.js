const puppeteer = require('puppeteer');

async function getM3u8(source, id, streamNo) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add these flags
    });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        "Referer": "https://embedme.top/",
        "Origin": "https://embedme.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });

    let m3u8Url = null;
    page.on('request', request => {
        if (request.url().endsWith('.m3u8')) {
            m3u8Url = request.url();
        }
    });

    await page.goto(`https://streamed.su/watch/${id}/${source}/${streamNo}`, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(5000); // Wait for stream to start

    await browser.close();
    return m3u8Url || "No m3u8 found";
}

const [,, source, id, streamNo] = process.argv;
getM3u8(source, id, parseInt(streamNo)).then(url => console.log(url));