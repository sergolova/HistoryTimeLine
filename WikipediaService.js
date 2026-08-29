 class WikipediaService {
    constructor(storageService) {
        this.storageService = storageService;
        this.imageCache = this.storageService.loadImageCache();
        this.ONE_DAY_MS = 24 * 60 * 60 * 1000;
    }

    async getSmartWikipediaData(content) {
        const query = content.trim();
        const fallbackSearchUrl = `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
        const searchApiUrl = `https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json&origin=*`;

        try {
            const searchResponse = await fetch(searchApiUrl);
            const searchData = await searchResponse.json();

            if (!searchData[1] || searchData[1].length === 0) {
                return { url: fallbackSearchUrl, image: null };
            }

            const exactTitle = searchData[1][0];
            const articleUrl = searchData[3][0];
            const cachedData = this.imageCache[query];
            const isExpired = cachedData && (new Date() - new Date(cachedData.timestamp) > this.ONE_DAY_MS);

            if (!cachedData || isExpired) {
                const imageApiUrl = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(exactTitle)}&prop=pageimages&piprop=original&redirects=1&format=json&origin=*`;
                const imgResponse = await fetch(imageApiUrl);
                const imgData = await imgResponse.json();
                const pages = imgData.query.pages;
                const pageId = Object.keys(pages)[0];

                let imageUrl = null;
                if (pageId && pageId !== "-1" && pages[pageId].original) {
                    imageUrl = pages[pageId].original.source;
                }

                this.imageCache[query] = { url: imageUrl, timestamp: new Date().toISOString() };
                this.storageService.saveImageCache(this.imageCache);
            }

            return { url: articleUrl, image: this.imageCache[query] ? this.imageCache[query].url : null };
        } catch (error) {
            console.error("Wikipedia API error:", error);
            return { url: fallbackSearchUrl, image: null };
        }
    }
}