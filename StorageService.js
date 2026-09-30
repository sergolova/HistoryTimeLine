class StorageService {
    constructor() {
        this.STORAGE_KEY = 'historyTimeline:data:v1';
        this.IMAGE_CACHE_KEY = 'historyTimeline:images:v1';
    }

    loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn('localStorage read error:', e);
            return null;
        }
    }

    saveToStorage(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('localStorage write error:', e);
            return false;
        }
    }

    clearStorage() {
        localStorage.removeItem(this.STORAGE_KEY);
    }

    loadImageCache() {
        try {
            return JSON.parse(localStorage.getItem(this.IMAGE_CACHE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    saveImageCache(cache) {
        try {
            localStorage.setItem(this.IMAGE_CACHE_KEY, JSON.stringify(cache));
        } catch (e) {}
    }

    exportStorageToFile(data) {
        const payload = {
            format: 'history-timeline-storage',
            version: 1,
            exportedAt: new Date().toISOString(),
            storageKey: this.STORAGE_KEY,
            data: data || this.loadFromStorage()
        };
        const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `history-timeline-storage-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }
}