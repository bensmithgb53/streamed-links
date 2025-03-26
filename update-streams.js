const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  try {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ 
      headless: 'new', 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

    console.log('Loading embed page...');
    await page.goto('https://streamed.su/embed/alpha/1743016500000-tindastoll-w-stjarnan-w/1', { 
      waitUntil: 'networkidle2' 
    });
    console.log('Waiting for window.decrypt to load...');
    await page.waitForFunction('typeof window.decrypt === "function"', { timeout: 30000 });
    console.log('window.decrypt loaded');

    console.log('Fetching matches...');
    await page.goto('https://streamed.su', { waitUntil: 'networkidle2' });
    const matches = await page.evaluate(async () => {
      const response = await fetch('https://streamed.su/api/matches/all', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return response.json();
    });
    console.log('Matches fetched:', matches.length);

    const currentTime = Math.floor(Date.now() / 1000);
    const liveMatches = matches.filter(m => m.date / 1000 >= currentTime - 86400);
    console.log('Live matches:', liveMatches.length);

    const streams = {};
    for (const match of liveMatches.slice(0, 5)) {
      for (const source of match.sources) {
        console.log('Fetching stream for:', match.id, source.source);
        try {
          const m3u8Url = await page.evaluate(async (source, id) => {
            const response = await fetch('https://embedme.top/fetch', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://streamed.su/',
                'Origin': 'https://streamed.su/',
                'Accept': '*/*'
              },
              body: JSON.stringify({ source, id, streamNo: '1' })
            });
            const enc = await response.text();
            return 'https://rr.vipstreams.in' + window.decrypt(enc);
          }, source.source, match.id);
          streams[`${match.id}-${source.id}`] = {
            matchId: match.id,
            source: source.source,
            m3u8_url: m3u8Url
          };
        } catch (e) {
          console.error('Error fetching stream:', match.id, source.source, e.message);
          streams[`${match.id}-${source.id}`] = {
            matchId: match.id,
            source: source.source,
            m3u8_url: ''
          };
        }
      }
    }

    console.log('Streams generated:', Object.keys(streams).length);
    fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2));
    console.log('streams.json written');

    await browser.close();
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
})();
