const puppeteer = require('puppeteer');

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
    page.on('request', request => {
        const url = request.url();
        console.log("Request:", url);
        if (url.endsWith('.m3u8')) {
            m3u8Url = url;
            console.log("Captured m3u8:", m3u8Url);
        }
    });

    console.log("Navigating to:", `https://streamed.su/watch/${id}/${source}/${streamNo}`);
    await page.goto(`https://streamed.su/watch/${id}/${source}/${streamNo}`, { waitUntil: 'networkidle0' }); // Wait for no network activity

    // Wait explicitly for 2 seconds (based on 1.4s timing)
    await page.waitForTimeout(2000);

    // Attempt to start the stream
    try {
        await page.waitForSelector('video, #player, .vjs-tech', { timeout: 5000 });
        await page.evaluate(() => {
            const video = document.querySelector('video') || document.querySelector('.vjs-tech');
            if (video && video.paused) video.play();
            const playButton = document.querySelector('button[title="Play"], .vjs-play-control');
            if (playButton) playButton.click();
        });
        await page.waitForTimeout(3000); // Additional wait after play
    } catch (e) {
        console.log("Player interaction failed:", e.message);
    }

    await browser.close();
    return m3u8Url || "No m3u8 found";
}

const [,, source, id, streamNo] = process.argv;
getM3u8(source, id, parseInt(streamNo)).then(url => console.log("Final m3u8 URL:", url));