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
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();

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
        if (url.includes('.m3u8')) { // Broaden to catch any .m3u8
            m3u8Url = url;
            console.log("Found m3u8:", m3u8Url);
        }
    });

    const url = `https://streamed.su/watch/${id}/${source}/${streamNo}`;
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    const teamName = await page.evaluate(() => document.title || window.location.pathname.split('/')[2]);
    console.log("Team name extracted:", teamName);

    // Wait longer to capture all network responses
    console.log("Waiting for network responses...");
    await new Promise(resolve => setTimeout(resolve, 20000)); // 20s total wait

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