const fetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent'); // Correct import
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

async function fetchMatches(proxy) {
    const url = 'https://streamed.su/api/matches/all';
    console.log("Fetching matches from API with proxy:", proxy || 'none');
    const options = {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            "Referer": "https://streamed.su/",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive"
        }
    };
    if (proxy) {
        options.agent = new HttpsProxyAgent(`http://${proxy}`); // Fixed constructor
    }

    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`API fetch failed: ${response.statusText}`);
    const text = await response.text();
    if (text.includes('challenges.cloudflare.com')) throw new Error("Cloudflare blocked API access");
    const matches = JSON.parse(text);
    console.log("Found matches:", matches.length);
    return matches;
}

async function getM3u8FromEmbed(source, id, streamNo, proxy) {
    const url = `https://embedstreams.top/embed/${source}/${id}/${streamNo}`;
    console.log("Scraping embed URL:", url);
    const options = {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            "Referer": "https://streamed.su/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive"
        }
    };
    if (proxy) {
        options.agent = new HttpsProxyAgent(`http://${proxy}`); // Fixed constructor
    }

    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Embed fetch failed: ${response.statusText}`);
    const html = await response.text();
    if (html.includes('challenges.cloudflare.com')) throw new Error("Cloudflare block encountered");

    const m3u8Match = html.match(/https?:\/\/[^\s'"]+\.m3u8/);
    const m3u8Url = m3u8Match ? m3u8Match[0] : null;
    console.log("Found m3u8:", m3u8Url || "none");
    return m3u8Url;
}

async function scrapeMatches() {
    const maxAttempts = 5;
    const sportsFilter = ['football', 'darts', 'other', 'fighting'];
    let streams = fs.existsSync('streams.json') ? JSON.parse(fs.readFileSync('streams.json', 'utf8')) : [];
    let proxy = await getFreeProxy();

    // Fetch matches with retries
    let matches;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            matches = await fetchMatches(proxy);
            break;
        } catch (error) {
            console.error(`API attempt ${attempt + 1} failed with proxy ${proxy || 'none'}: ${error.message}`);
            proxy = attempt + 1 < maxAttempts ? await getFreeProxy() : null;
            if (!proxy) {
                console.log("No more proxies available for API. Terminating.");
                return;
            }
        }
    }

    if (!matches) {
        console.log("Failed to fetch matches after all attempts.");
        return;
    }

    const filteredMatches = matches.filter(match => {
        const sport = match.title?.toLowerCase() || '';
        return sportsFilter.some(category => sport.includes(category));
    });
    console.log(`Filtered ${filteredMatches.length} matches for football, darts, other, fighting`);

    // Scrape each match
    for (const match of filteredMatches) {
        let gameStreams = [];
        const matchSources = match.sources.map(s => s.source);
        proxy = await getFreeProxy(); // New proxy per match

        for (const src of matchSources) {
            for (let num = 1; num <= 3; num++) {
                let streamAttempts = 0;
                let currentProxy = proxy;
                while (streamAttempts < maxAttempts) {
                    try {
                        const m3u8Url = await getM3u8FromEmbed(src, match.id, num, currentProxy);
                        if (m3u8Url) {
                            gameStreams.push({
                                source: src,
                                m3u8: m3u8Url,
                                headers: {
                                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                                    "Referer": "https://embedme.top/"
                                }
                            });
                        }
                        break; // Success, move to next stream
                    } catch (error) {
                        console.error(`Attempt ${streamAttempts + 1} failed for ${match.id}/${src}/${num} with proxy ${currentProxy || 'none'}: ${error.message}`);
                        streamAttempts++;
                        currentProxy = streamAttempts < maxAttempts ? await getFreeProxy() : null;
                        if (!currentProxy) break;
                    }
                }
            }
        }

        if (gameStreams.length > 0) {
            const uniqueStreams = [];
            const seenUrls = new Set();
            for (const stream of gameStreams) {
                if (!seenUrls.has(stream.m3u8)) {
                    seenUrls.add(stream.m3u8);
                    uniqueStreams.push(stream);
                }
            }

            let existingEntry = streams.find(s => s.id === match.id);
            if (existingEntry) {
                const existingUrls = new Set(existingEntry.m3u8.map(item => item.m3u8));
                uniqueStreams.forEach(newStream => {
                    if (!existingUrls.has(newStream.m3u8)) {
                        existingEntry.m3u8.push(newStream);
                    }
                });
            } else {
                streams.push({
                    id: match.id,
                    title: match.title || `Stream ${match.id}`,
                    m3u8: uniqueStreams
                });
            }
            console.log(`Added ${match.id} with ${uniqueStreams.length} unique streams`);
            fs.writeFileSync('streams.json', JSON.stringify(streams, null, 2)); // Save incrementally
        }
    }

    console.log("Saved all streams to streams.json");
}

scrapeMatches()
    .then(() => console.log("Scraping completed"))
    .catch(err => console.error("Scraping failed:", err));