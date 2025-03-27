const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo) {
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

    let m3u8Url = null;
    page.on("response", async (response) => {
        const url = response.url();
        console.log("Response:", url);
        if (url.endsWith('.m3u8')) {
            m3u8Url = url;
            console.log("Found m3u8:", m3u8Url);
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    const teamName = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
    await page.waitForTimeout(2000);

    try {
        await page.waitForSelector('video, #player, .vjs-tech', { timeout: 5000 });
        await page.evaluate(() => {
            const video = document.querySelector('video') || document.querySelector('.vjs-tech');
            if (video && video.paused) video.play();
            const playButton = document.querySelector('button[title="Play"], .vjs-play-control');
            if (playButton) playButton.click();
        });
        await page.waitForTimeout(3000);
    } catch (e) {
        console.log("Player interaction failed:", e.message);
    }

    await browser.close();

    if (m3u8Url) {
        let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];
        streams.push({ teamName, m3u8Url });
        fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
        console.log(`Saved: ${teamName} -> ${m3u8Url}`);
    }

    return m3u8Url || "No m3u8 found";
}

const [,, source, id, streamNo] = process.argv;
getM3u8(source, id, parseInt(streamNo)).then(url => console.log(url));