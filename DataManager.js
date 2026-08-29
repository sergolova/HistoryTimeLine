 class DataManager {
    static GROUP_COLORS = {
        wars: '#c62828',
        states: '#4a148c',
        people: '#0d47a1',
        events: '#1b5e20',
        culture: '#311b92',
        disasters: '#212121',
        economics: '#f57f17',
        literature: '#4e342e',
        rulers: '#006064',
        science: '#004d40'
    };

    constructor() {
        this.rawData = null;
        this.activeTags = new Set();
        this.activeGroups = new Set();
        this.excludedTags = new Set();
        this.selectedItemId = null;
        this.searchQuery = '';
        this.highlightQuery = '';
        this.tagSearchQuery = '';
    }

    normalizeData(data) {
        if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items)) {
            throw new Error('Ожидался объект с массивами groups и items');
        }

        const groups = data.groups
            .map(g => ({ id: String(g.id).trim(), content: String(g.content || g.id).trim() }))
            .filter(g => g.id.length > 0);

        const seenIds = new Set();
        const items = [];

        data.items.forEach(item => {
            const id = String(item.id || '').trim();
            if (!id || seenIds.has(id)) return;
            seenIds.add(id);

            items.push({
                id,
                group: String(item.group || groups[0]?.id || '').trim(),
                content: String(item.content || id).trim(),
                start: String(item.start || '').trim(),
                end: item.end ? String(item.end).trim() : undefined,
                type: item.type === 'range' ? 'range' : 'point',
                tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : [],
                description: String(item.description || '').trim(),
                related: Array.isArray(item.related) ? item.related.map(r => String(r).trim()).filter(Boolean) : []
            });
        });

        const tags = new Set(Array.isArray(data.tags) ? data.tags.map(t => String(t).trim()).filter(Boolean) : []);
        items.forEach(i => i.tags.forEach(t => tags.add(t)));

        return { groups, items, tags: [...tags].sort((a, b) => a.localeCompare(b, 'ru')) };
    }

    setData(data) {
        this.rawData = this.normalizeData(data);
        this.selectedItemId = null;
        this.activeTags.clear();
        this.activeGroups.clear();
        this.rawData.groups.forEach(g => this.activeGroups.add(g.id));
    }

    findItemById(id) {
        return this.rawData?.items.find(item => String(item.id) === String(id));
    }

    getFilteredItems() {
        return this.rawData?.items.filter(item => {
            if (!this.activeGroups.has(item.group)) return false;
            if ((item.tags || []).some(tag => this.excludedTags.has(tag))) return false;

            const matches = !this.searchQuery ||
                (item.content || '').toLowerCase().includes(this.searchQuery) ||
                (item.description || '').toLowerCase().includes(this.searchQuery) ||
                (item.tags || []).some(t => t.toLowerCase().includes(this.searchQuery));

            if (!matches) return false;
            if (!this.activeTags.size) return true;
            return (item.tags || []).some(tag => this.activeTags.has(tag));
        });
    }

    isItemHighlighted(item) {
        if (!this.highlightQuery) return false;
        const fields = [item.id, item.content, item.description, item.group, ...(item.tags || [])];
        return fields.some(val => String(val || '').toLowerCase().includes(this.highlightQuery));
    }

    getSearchTargets() {
        let items = this.getFilteredItems() || [];
        if (this.highlightQuery) {
            items = items.filter(item => this.isItemHighlighted(item));
        }
        return items;
    }

    toggleTagInclusion(tag) {
        if (this.excludedTags.has(tag)) this.excludedTags.delete(tag);
        if (this.activeTags.has(tag)) this.activeTags.delete(tag);
        else this.activeTags.add(tag);
    }

    toggleTagExclusion(tag) {
        if (this.excludedTags.has(tag)) {
            this.excludedTags.delete(tag);
        } else {
            this.excludedTags.add(tag);
            this.activeTags.delete(tag);
        }
    }

    deleteTag(tag) {
        this.rawData.tags = this.rawData.tags.filter(x => x !== tag);
        this.rawData.items.forEach(item => {
            item.tags = (item.tags || []).filter(x => x !== tag);
        });
        this.activeTags.delete(tag);
        this.excludedTags.delete(tag);
    }

    syncTagCatalogFromItems() {
        const next = new Set(this.rawData.tags);
        this.rawData.items.forEach(item => (item.tags || []).forEach(tag => next.add(tag)));
        this.rawData.tags = [...next].sort((a, b) => a.localeCompare(b, 'ru'));
    }

     getTagUsageMap() {
         const map = new Map();
         (this.rawData?.items || []).forEach(item => {
             (item.tags || []).forEach(tag => {
                 map.set(tag, (map.get(tag) || 0) + 1);
             });
         });
         return map;
     }

     deleteGroup(groupId) {
         if (!this.rawData) return;
         this.rawData.groups = this.rawData.groups.filter(g => g.id !== groupId);
         this.rawData.items = this.rawData.items.filter(i => i.group !== groupId);
         this.activeGroups.delete(groupId);
     }
}