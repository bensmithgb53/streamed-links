const puppeteer = require('puppeteer');
const fs = require('fs').promises;

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
        if (request.url().endsWith('.m3u8')) {
            m3u8Url = request.url();
            console.log(`Found m3u8 for ${id}: ${m3u8Url}`);
        }
    });

    console.log(`Navigating to: https://streamed.su/watch/${id}/${source}/${streamNo}`);
    await page.goto(`https://streamed.su/watch/${id}/${source}/${streamNo}`, { waitUntil: 'networkidle2' });

    // Wait longer and try to start the stream
    await page.waitForTimeout(10000); // Increased to 10 seconds
    await page.evaluate(() => {
        const playButton = document.querySelector('button.play'); // Adjust selector if needed
        if (playButton) playButton.click();
    });
    await page.waitForTimeout(5000); // Wait after clicking

    await browser.close();
    return m3u8Url || "No m3u8 found";
}

async function updateStreams() {
    const data = {
        "1743016500000-tindastoll-w-stjarnan-w-1743016500000-tindastoll-w-stjarnan-w": {
            "matchId": "1743016500000-tindastoll-w-stjarnan-w", "source": "bravo", "m3u8_url": ""
        },
        "1743016500000-thor-ak-akureyri-w-keflavik-w-1743016500000-thor-ak-akureyri-w-keflavik-w": {
            "matchId": "1743016500000-thor-ak-akureyri-w-keflavik-w", "source": "bravo", "m3u8_url": ""
        },
        // Add more entries from your JSON here
        "maccabi-tel-aviv-vs-panathinaikos-maccabi-tel-aviv-vs-panathinaikos": {
            "matchId": "maccabi-tel-aviv-vs-panathinaikos", "source": "alpha", "m3u8_url": ""
        },
        "sky-sports-darts": { // Simplified for testing
            "matchId": "sky-sports-darts", "source": "alpha", "m3u8_url": ""
        }
    };

    for (const key in data) {
        const { source, matchId } = data[key];
        const m3u8Url = await getM3u8(source, matchId, 1);
        data[key].m3u8_url = m3u8Url;
    }

    // Save updated JSON
    await fs.writeFile('streams.json', JSON.stringify(data, null, 2));
    console.log("Updated streams.json with m3u8 URLs");
}

updateStreams().catch(err => console.error(err));