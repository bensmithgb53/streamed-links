const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteer.use(StealthPlugin());

async function getM3u8(source, id, streamNo) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Hide automation
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();

    // Extra stealth to bypass Cloudflare
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
    });

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
    console.log("Team name extracted:", teamName);
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s

    try {
        console.log("Looking for video player...");
        await page.waitForSelector('video, #player, .vjs-tech', { timeout: 15000 });
        await page.evaluate(() => {
            const video = document.querySelector('video') || document.querySelector('.vjs-tech');
            if (video) {
                console.log("Video found, playing...");
                if (video.paused) video.play();
            } else {
                console.log("No video element found");
            }
            const playButton = document.querySelector('button[title="Play"], .vjs-play-control');
            if (playButton) {
                console.log("Play button found, clicking...");
                playButton.click();
            } else {
                console.log("No play button found");
            }
        });
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s after play
    } catch (e) {
        console.log("Player interaction failed:", e.message);
    }

    console.log("Final m3u8Url value:", m3u8Url || "Not found");
    if (m3u8Url) {
        let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];
        streams.push({ teamName, m3u8Url });
        fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
        console.log(`Saved to streams.json: ${teamName} -> ${m3u8Url}`);
    } else {
        console.log("No m3u8 URL found, streams.json not updated");
    }

    await browser.close();
    return m3u8Url || "No m3u8 found";
}

const [,, source, id, streamNo] = process.argv;
getM3u8(source, id, parseInt(streamNo)).then(url => console.log("Script completed with:", url));