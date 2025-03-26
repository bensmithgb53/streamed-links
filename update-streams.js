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

    // Fetch a current match
    console.log('Fetching matches...');
    await page.goto('https://streamed.su', { waitUntil: 'networkidle2' });
    const matchData = await page.evaluate(async () => {
      const response = await fetch('https://streamed.su/api/matches/all');
      const matches = await response.json();
      console.log('Raw matches:', JSON.stringify(matches.slice(0, 5))); // Log first 5 for debug
      const liveMatch = matches.find(m => m.date / 1000 > Math.floor(Date.now() / 1000) - 86400);
      if (liveMatch && liveMatch.name) {
        return {
          watchUrl: `https://streamed.su/watch/${liveMatch.name.replace(/\s+/g, '-').toLowerCase()}/alpha/1`,
          name: liveMatch.name,
          id: liveMatch.id,
          sources: liveMatch.sources
        };
      }
      return null;
    });
    if (!matchData) {
      console.log('No live match with a valid name found');
      await browser.close();
      process.exit(0);
    }
    console.log('Watch URL:', matchData.watchUrl);

    // Capture M3U8 URLs from network requests
    const m3u8Urls = new Set();
    page.on('response', response => {
      const url = response.url();
      if (url.endsWith('.m3u8')) {
        console.log('Found M3U8 URL:', url);
        m3u8Urls.add(url);
      }
    });

    console.log('Loading watch page to capture M3U8...');
    await page.goto(matchData.watchUrl, { waitUntil: 'networkidle2' });
    console.log('Current URL:', page.url());

    // Wait a bit for video to load (adjust as needed)
    await page.waitForTimeout(10000); // 10s to allow stream to start

    // Build streams object
    const streams = {};
    let index = 0;
    for (const m3u8Url of m3u8Urls) {
      const key = `${matchData.id}-${index++}`;
      streams[key] = {
        matchId: matchData.id,
        source: matchData.sources[0]?.source || 'unknown', // Fallback if sources empty
        m3u8_url: m3u8Url
      };
    }

    if (Object.keys(streams).length === 0) {
      console.log('No M3U8 URLs captured');
      for (const source of matchData.sources) {
        streams[`${matchData.id}-${source.id || index++}`] = {
          matchId: matchData.id,
          source: source.source,
          m3u8_url: ''
        };
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