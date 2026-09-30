class UIController {
    constructor(dataManager, timelineComponent, storageService, wikiService) {
        this.data = dataManager;
        this.timeline = timelineComponent;
        this.storage = storageService;
        this.wiki = wikiService;
        this.editMode = 'create';
        this.editOriginalId = null;
        this._titleChangeTimer = null;
        this._poeticTitles = []; // пользователь заполнит сам
        this.titleChangeInterval = null;

        this.bindDOM();
        this.bindEvents();
    }

    bindDOM() {
        this.detailsEl = document.getElementById('details');
        this.tagsFilterEl = document.getElementById('tags');
        this.groupFiltersEl = document.getElementById('groupFilters');
        this.itemDialogEl = document.getElementById('itemDialog');
        this.itemDialogTitleEl = document.getElementById('itemDialogTitle');
        this.itemFormEl = document.getElementById('itemForm');
        this.importDialogEl = document.getElementById('importDialog');
        this.importFormEl = document.getElementById('importForm');
        this.importTextInputEl = document.getElementById('importTextInput');
        this.stateFileInputEl = document.getElementById('stateFileInput');
        this.tagSearchInputEl = document.getElementById('tagSearchInput');
        this.timelineWrapEl = document.getElementById('timelineWrap');
        // Group dialog
        this.groupDialogEl = document.getElementById('groupDialog');
        this.groupDialogTitleEl = document.getElementById('groupDialogTitle');
        this.groupFormEl = document.getElementById('groupForm');
    }

    bindEvents() {
        const searchInput = document.getElementById('search');
        const highlightInput = document.getElementById('highlightSearchCheckbox');
        const clearBtn = document.getElementById('clearSearch');

        searchInput.addEventListener('input', () => this.updateSearch());
        highlightInput.addEventListener('change', () => this.updateSearch());
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.setAttribute('hidden', '');
            searchInput.focus();
            searchInput.dispatchEvent(new Event('input'));
        });

        document.getElementById('clickableLogo').addEventListener('click', () => {
            this.applyRandomPoeticTitle();
            this.resetTitleChangeTimer();
        });

        document.getElementById('findBtn').addEventListener('click', () => this.findElement());
        document.getElementById('resetZoomBtn').addEventListener('click', () => this.resetTimelineZoom());
        document.getElementById('addItemBtn').addEventListener('click', () => this.openItemDialog('create'));
        document.getElementById('editItemBtn').addEventListener('click', () => this.openItemDialog('edit'));
        document.getElementById('deleteItemBtn').addEventListener('click', () => this.deleteSelectedItem());

        document.getElementById('showAllGroupsBtn').addEventListener('click', () => this.setAllGroupsVisibility(true));
        document.getElementById('hideAllGroupsBtn').addEventListener('click', () => this.setAllGroupsVisibility(false));
        document.getElementById('invertGroupsBtn').addEventListener('click', () => this.invertGroupVisibility());

        // Group dialog
        document.getElementById('addGroupBtn').addEventListener('click', () => this.openGroupDialog('create'));
        document.getElementById('saveGroupBtn').addEventListener('click', (e) => this.saveGroupFromDialog(e));
        document.getElementById('deleteGroupBtn').addEventListener('click', () => this.deleteGroupFromDialog());
        document.getElementById('closeGroupDialogBtn').addEventListener('click', () => this.groupDialogEl.close());
        this.groupFormEl.addEventListener('submit', (e) => e.preventDefault());

        // Color sync
        document.getElementById('groupColorInput').addEventListener('input', (e) => {
            document.getElementById('groupColorTextInput').value = e.target.value;
        });
        document.getElementById('groupColorTextInput').addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(val)) {
                document.getElementById('groupColorInput').value = val;
            }
        });

        this.itemFormEl.addEventListener('submit', (e) => this.saveItemFromDialog(e));
        document.getElementById('closeItemDialogBtn').addEventListener('click', () => this.itemDialogEl.close());

        // Clickable logo — случайный подзаголовок
        document.querySelector('.clickable-logo')?.addEventListener('click', () => this.applyRandomPoeticTitle());

        // File actions
        document.getElementById('exportStorageBtn').addEventListener('click', () => this.storage.exportStorageToFile(this.data.rawData));
        document.getElementById('importStorageBtn').addEventListener('click', () => this.stateFileInputEl.click());
        this.stateFileInputEl.addEventListener('change', (e) => this.importStorageFromFile(e));
        document.getElementById('importTextBtn').addEventListener('click', () => {
            this.importTextInputEl.value = '';
            this.importDialogEl.showModal();
            this.importTextInputEl.focus();
        });
        document.getElementById('copyExample').addEventListener('click', (e) => {
            if (!this.data.rawData || !this.data.rawData.groups.length) return;
            const groups = this.data.rawData.groups.map(g => g.id).join(', ');
            e.preventDefault();
            navigator.clipboard.writeText(`// known groups: ${groups}\n${this.eventJsonExample || ''}`);
            this.showToast('Пример JSON скопирован в буфер обмена', 'info');
        });
        this.importFormEl.addEventListener('submit', (e) => this.applyImportFromText(e));
        document.getElementById('applyImportBtn').addEventListener('click', (e) => this.applyImportFromText(e));
        document.getElementById('closeImportDialogBtn').addEventListener('click', () => this.importDialogEl.close());
        document.getElementById('resetStorageBtn').addEventListener('click', async () => {
            if (!window.confirm('Очистить localStorage и загрузить исходный data.json?')) return;
            this.storage.clearStorage();
            this.data.setData(null);
            await this.loadDefaultData();
        });

        // Tag search
        if (this.tagSearchInputEl) {
            this.tagSearchInputEl.addEventListener('input', () => {
                this.data.tagSearchQuery = this.tagSearchInputEl.value.trim().toLowerCase();
                this.renderTagsFilter();
            });
        }
    }

    async init() {
        this.eventJsonExample = `{\n  "items": [\n    {\n      "id": "example-id",\n      "group": "events",\n      "content": "Пример события",\n      "start": "1700",\n      "type": "point",\n      "tags": ["пример"],\n      "description": "Описание"\n    }\n  ]\n}`;

        const cached = this.storage.loadFromStorage();
        if (cached) {
            this.data.setData(cached);
        } else {
            await this.loadDefaultData();
        }
        this.applyFilter();
        this.refreshUI();
        this.resetTitleChangeTimer();
        this.applyRandomPoeticTitle();
    }

    async loadDefaultData() {
        try {
            const res = await fetch('example.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.data.setData(data);
        } catch (e) {
            console.error('Failed to load example.json:', e);
            this.showEmptyState();
        }
    }

    showEmptyState() {
        this.data.rawData = { groups: [], items: [], tags: [] };
        this.applyFilter();
        this.refreshUI();
        this.resetDetails('Данные не загружены. Нажмите «Данные» → «Загрузить...», чтобы импортировать файл с событиями.');
        this.showToast('Данные не найдены — загрузите файл вручную', 'error');
    }

    refreshUI() {
        this.renderTagsFilter();
        this.renderGroupFilters();
    }

    applyFilter() {
        if (!this.data.rawData) return;

        this.timeline.render(this.data);
        if (!this.timeline.timeline) return;

        const filtered = this.data.getFilteredItems();
        const hasSelectedVisible = filtered.some(item => String(item.id) === String(this.data.selectedItemId));

        if (!filtered.length) {
            this.data.selectedItemId = null;
            this.timeline.timeline.setSelection([]);
            this.timeline.hideSelectionGuideLines();
            this.resetDetails('Ничего не найдено. Попробуйте снять часть фильтров.');
            return;
        }

        if (!hasSelectedVisible) {
            this.data.selectedItemId = null;
            this.timeline.timeline.setSelection([]);
            this.timeline.hideSelectionGuideLines();
            this.resetDetails('Выберите событие на таймлайне');
            return;
        }

        this.timeline.updateSelectionGuideLines(this.data);
    }

    updateSearch() {
        const searchInput = document.getElementById('search');
        const highlightInput = document.getElementById('highlightSearchCheckbox');
        const clearBtn = document.getElementById('clearSearch');

        const query = searchInput.value.trim().toLowerCase();
        this.data.highlightQuery = highlightInput.checked ? query : '';
        this.data.searchQuery = highlightInput.checked ? '' : query;

        if (query.length > 0) {
            clearBtn.removeAttribute('hidden');
        } else {
            clearBtn.setAttribute('hidden', '');
        }

        this.applyFilter();

        const targets = this.getSearchTargets();
        const currentIndex = targets.findIndex(item => String(item.id) === String(this.data.selectedItemId));
        this.updateFindButtonCount(currentIndex >= 0 ? currentIndex + 1 : 0, targets.length);

        if (currentIndex >= 0 && targets[currentIndex]) {
            this.updateCurrentItemLabel(targets[currentIndex].content);
        } else if (currentIndex === -1 && targets.length > 1) {
            this.updateCurrentItemLabel(targets[0].content);
        } else {
            this.updateCurrentItemLabel('');
        }
    }

    getSearchTargets() {
        let items = this.data.getFilteredItems() || [];
        if (this.data.highlightQuery) {
            items = items.filter(item => this.data.isItemHighlighted(item));
        }
        return items;
    }

    findElement() {
        if (!this.timeline.timeline || !this.data.rawData) return;

        const items = this.getSearchTargets();
        if (!items.length) {
            this.showToast('Совпадающие элементы не найдены', 'error');
            this.updateFindButtonCount(0, 0);
            this.updateCurrentItemLabel('');
            return;
        }

        const currentIndex = items.findIndex(item => String(item.id) === String(this.data.selectedItemId));
        const nextIndex = (currentIndex + 1) % items.length;
        const nextItem = items[nextIndex];

        this.data.selectedItemId = nextItem.id;
        this.timeline.timeline.setSelection([this.data.selectedItemId]);
        this.centerOnItemWithoutZoom(this.data.selectedItemId);
        this.showDetails(this.data.selectedItemId);
        this.timeline.updateSelectionGuideLines(this.data);
        this.scrollToItemY(this.data.selectedItemId);
        this.updateFindButtonCount(nextIndex + 1, items.length);
        this.updateCurrentItemLabel(nextItem.content);
    }

    scrollToItemY(itemId) {
        if (!this.timelineWrapEl || !itemId) return;
        requestAnimationFrame(() => {
            const itemEl = this.timelineWrapEl.querySelector(`[data-item-id="${itemId}"]`)
                || this.timelineWrapEl.querySelector(`.vis-item[data-id="${itemId}"]`);
            if (!itemEl) return;
            const scrollContainer = this.timelineWrapEl.querySelector('.vis-panel.vis-center')
                || this.timelineWrapEl.querySelector('.vis-vertical-scroll');
            if (scrollContainer) {
                const itemRect = itemEl.getBoundingClientRect();
                const containerRect = scrollContainer.getBoundingClientRect();
                const isAbove = itemRect.top < containerRect.top;
                const isBelow = itemRect.bottom > containerRect.bottom;
                if (isAbove || isBelow) {
                    const targetScrollTop = scrollContainer.scrollTop
                        + (itemRect.top - containerRect.top)
                        - (containerRect.height / 2)
                        + (itemRect.height / 2);
                    scrollContainer.scrollTo({top: targetScrollTop, behavior: 'smooth'});
                }
            } else {
                itemEl.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            }
        });
    }

    centerOnItemWithoutZoom(id) {
        const timeline = this.timeline.timeline;
        if (!timeline) return;
        const item = this.data.findItemById(id);
        if (!item) return;

        const startDate = DateUtils.toVisDate(item.start, false);
        const endDate = item.end ? DateUtils.toVisDate(item.end, true) : startDate;
        if (!(startDate instanceof Date) || !(endDate instanceof Date)) return;

        let interval = null;
        try {
            const win = typeof timeline.getWindow === 'function' ? timeline.getWindow() : null;
            if (win && win.start instanceof Date && win.end instanceof Date) {
                interval = win.end.getTime() - win.start.getTime();
            }
        } catch (e) {
        }

        const middle = (startDate.getTime() + endDate.getTime()) / 2;
        if (!interval || !Number.isFinite(interval) || interval <= 0) {
            interval = 1000 * 60 * 60 * 24 * 14;
        }
        try {
            timeline.setWindow(new Date(middle - interval / 2), new Date(middle + interval / 2), {animation: true});
        } catch (e) {
            try {
                timeline.setWindow(new Date(middle - interval / 2), new Date(middle + interval / 2));
            } catch (err) {
            }
        }
    }

    updateFindButtonCount(current = 0, total = 0) {
        const findBtn = document.getElementById('findBtn');
        if (!findBtn) return;
        if (total > 0 && (this.data.searchQuery || this.data.highlightQuery)) {
            const displayIndex = current > 0 ? current : 1;
            findBtn.textContent = `Найти (${displayIndex}/${total})`;
        } else {
            findBtn.textContent = 'Найти';
        }
    }

    updateCurrentItemLabel(itemContent = '') {
        const labelEl = document.getElementById('currentFindItemLabel');
        if (!labelEl) return;
        if (itemContent && (this.data.searchQuery || this.data.highlightQuery)) {
            labelEl.textContent = itemContent;
            labelEl.title = itemContent;
        } else {
            labelEl.textContent = '';
            labelEl.title = '';
        }
    }

    resetTimelineZoom() {
        const timeline = this.timeline.timeline;
        if (!timeline || !this.data.rawData) return;
        timeline.setWindow(
            new Date(this.timeline.ACTUAL_DATE_START, 0, 1),
            new Date(this.timeline.ACTUAL_DATE_END, 0, 1),
            {animation: true}
        );
    }

    showDetails(id) {
        const item = this.data.findItemById(id);
        if (!item) {
            this.resetDetails('Событие не найдено');
            return;
        }

        const related = (item.related || [])
            .map(relId => {
                const rel = this.data.findItemById(relId);
                return rel ? `<li data-id="${this.escapeHtml(rel.id)}" class="related-link">${this.escapeHtml(rel.content)}</li>` : '';
            })
            .join('');

        const tags = item.tags?.length
            ? item.tags.map(tag => this.renderTagChipHtml(tag, 'detail-tag')).join(' ')
            : '<span class="muted">Нет тегов</span>';

        const dateLabel = this.escapeHtml(DateUtils.formatDateRange(item));
        const relations = related.trim().length ? `<ul>${related}</ul>` : '<p>Связанных событий нет.</p>';
        const initialWiki = `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(item.content.trim())}`;

        this.detailsEl.classList.remove('details-empty');
        this.detailsEl.innerHTML = `
            <a id="wiki-link" href="${initialWiki}" target="_blank"><h2>${this.escapeHtml(item.content)}</h2></a>
            <div id="wiki-image-container"></div>
            <p class="item-meta">ID: ${this.escapeHtml(item.id)} | Группа: ${this.escapeHtml(item.group)}</p>
            <p class="item-meta">Дата: ${dateLabel}</p>
            <p>${this.escapeHtml(item.description || 'Описание не заполнено')}</p>
            <p>Теги: ${tags}</p>
            <h3>Связи</h3>
            ${relations}
        `;

        this.wiki.getSmartWikipediaData(item.content).then(data => {
            const wikiLinkEl = document.getElementById('wiki-link');
            const imgContainer = document.getElementById('wiki-image-container');
            if (wikiLinkEl) wikiLinkEl.href = data.url;
            if (imgContainer && data.image) {
                imgContainer.innerHTML = `<img src="${data.image}" alt="${this.escapeHtml(item.content)}" style="max-width: 100%; height: auto; border-radius: 6px; margin-bottom: 15px;">`;
            }
        }).catch(err => console.error(err));

        this.bindRelatedLinks();
        this.bindDetailsTagClicks();
    }

    renderTagChipHtml(tag, extraClass = '') {
        const tagClass = [
            'tag',
            extraClass,
            this.data.activeTags.has(tag) ? 'active' : '',
            this.data.excludedTags.has(tag) ? 'excluded' : ''
        ].filter(Boolean).join(' ');
        return `<span class="${tagClass}" data-tag="${encodeURIComponent(tag)}"><span class="tag-text">${this.escapeHtml(tag)}</span><button type="button" class="tag-remove-btn" data-tag-action="exclude" title="Исключить тег ${this.escapeHtml(tag)} из видимости">—</button><button type="button" class="tag-remove-btn" data-tag-action="delete" title="Удалить тег ${this.escapeHtml(tag)} (удалит тег из всех событий)">x</button></span>`;
    }

    bindRelatedLinks() {
        this.detailsEl.querySelectorAll('.related-link').forEach(el => {
            el.onclick = () => {
                const id = el.dataset.id;
                if (!id) return;
                this.data.selectedItemId = id;
                this.centerOnItemWithoutZoom(id);
                this.timeline.timeline.setSelection([id]);
                this.showDetails(id);
                this.timeline.updateSelectionGuideLines(this.data);
            };
        });
    }

    bindDetailsTagClicks() {
        this.detailsEl.querySelectorAll('.detail-tag').forEach(el => {
            const raw = el.getAttribute('data-tag');
            if (!raw) return;
            const tag = decodeURIComponent(raw);

            const excludeBtn = el.querySelector('[data-tag-action="exclude"]');
            const deleteBtn = el.querySelector('[data-tag-action="delete"]');

            if (excludeBtn) {
                excludeBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.data.toggleTagExclusion(tag);
                    this.applyFilter();
                    this.refreshUI();
                });
            }
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!window.confirm(`Удалить тег "${tag}"? Тег будет удалён из всех событий.`)) return;
                    this.data.deleteTag(tag);
                    this.storage.saveToStorage(this.data.rawData);
                    this.applyFilter();
                    this.refreshUI();
                });
            }
        });
    }

    resetDetails(message) {
        this.detailsEl.classList.add('details-empty');
        this.detailsEl.textContent = message;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer') || this.createToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        // Анимация появления
        requestAnimationFrame(() => toast.classList.add('show'));

        // Автоматическое скрытие
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    parseCommaSeparatedTags(raw) {
        return [...new Set(
            String(raw || '').split(',').map(tag => tag.trim()).filter(Boolean)
        )];
    }

    getMultipleSelectValues(selectEl) {
        return [...selectEl.selectedOptions].map(option => option.value);
    }

    setMultipleSelect(selectEl, values) {
        const selected = new Set(values);
        [...selectEl.options].forEach(option => {
            option.selected = selected.has(option.value);
        });
    }

    renderTagsFilter() {
        this.tagsFilterEl.innerHTML = '';

        const usage = this.data.getTagUsageMap();
        const filteredTags = (this.data.rawData?.tags || [])
            .filter(tag => !this.data.tagSearchQuery || tag.toLowerCase().includes(this.data.tagSearchQuery))
            .sort((a, b) => {
                const diff = (usage.get(b) || 0) - (usage.get(a) || 0);
                if (diff !== 0) return diff;
                return a.localeCompare(b, 'ru');
            });

        const visibleTags = filteredTags.slice(0, 20);

        visibleTags.forEach(tag => {
            const div = document.createElement('div');
            div.className = [
                'tag',
                this.data.activeTags.has(tag) ? 'active' : '',
                this.data.excludedTags.has(tag) ? 'excluded' : ''
            ].filter(Boolean).join(' ');
            div.innerHTML = `<span class="tag-text">${this.escapeHtml(tag)}</span>`;

            const excludeBtn = document.createElement('button');
            excludeBtn.type = 'button';
            excludeBtn.className = 'tag-remove-btn';
            excludeBtn.title = `Исключить тег ${tag} из видимости`;
            excludeBtn.textContent = '—';
            excludeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.data.toggleTagExclusion(tag);
                this.applyFilter();
                this.refreshUI();
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'tag-remove-btn';
            removeBtn.title = `Удалить тег ${tag} (удалит тег из всех событий)`;
            removeBtn.textContent = 'x';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!window.confirm(`Удалить тег "${tag}"? Тег будет удалён из всех событий.`)) return;
                this.data.deleteTag(tag);
                this.storage.saveToStorage(this.data.rawData);
                this.applyFilter();
                this.refreshUI();
            });

            div.addEventListener('click', () => {
                this.data.toggleTagInclusion(tag);
                this.applyFilter();
                this.refreshUI();
            });

            div.append(excludeBtn, removeBtn);
            this.tagsFilterEl.append(div);
        });

        if (!visibleTags.length) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'tag-more-indicator';
            emptyEl.textContent = 'Ничего не найдено';
            this.tagsFilterEl.append(emptyEl);
            return;
        }

        if (filteredTags.length > 20) {
            const moreEl = document.createElement('div');
            moreEl.className = 'tag-more-indicator';
            moreEl.textContent = '...';
            this.tagsFilterEl.append(moreEl);
        }
    }

    renderGroupFilters() {
        this.groupFiltersEl.innerHTML = '';

        (this.data.rawData?.groups || []).forEach(group => {
            const label = document.createElement('label');
            label.className = 'group-filter-item';

            const left = document.createElement('span');
            left.className = 'group-filter-left';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.data.activeGroups.has(group.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.data.activeGroups.add(group.id);
                } else {
                    this.data.activeGroups.delete(group.id);
                }
                this.applyFilter();
            });

            const groupColor = DataManager.GROUP_COLORS[group.id] || 'var(--text)';
            const text = document.createElement('span');
            text.innerHTML = `${this.escapeHtml(group.content)} <span class="group-id-color" style="color:${groupColor}">(${this.escapeHtml(group.id)})</span>`;

            const actions = document.createElement('span');
            actions.className = 'group-filter-actions';

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'group-action-btn';
            addBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
            addBtn.title = `Добавить событие в группу ${group.content}`;
            addBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openItemDialog('create', group.id);
            });

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'group-action-btn';
            editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
            editBtn.title = `Редактировать группу ${group.content}`;
            editBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openGroupDialog('edit', group.id);
            });

            actions.append(addBtn, editBtn);

            left.append(checkbox, text);
            label.append(left, actions);
            this.groupFiltersEl.append(label);
        });
    }

    setAllGroupsVisibility(isVisible) {
        if (!this.data.rawData || !this.data.rawData.groups.length) return;
        this.data.activeGroups.clear();
        if (isVisible) {
            this.data.rawData.groups.forEach(group => this.data.activeGroups.add(group.id));
        }
        this.applyFilter();
        this.renderGroupFilters();
    }

    invertGroupVisibility() {
        if (!this.data.rawData || !this.data.rawData.groups.length) return;
        const nextActive = new Set();
        this.data.rawData.groups.forEach(group => {
            if (!this.data.activeGroups.has(group.id)) {
                nextActive.add(group.id);
            }
        });
        this.data.activeGroups.clear();
        nextActive.forEach(groupId => this.data.activeGroups.add(groupId));
        this.applyFilter();
        this.renderGroupFilters();
    }

    openGroupDialog(mode, groupId = null) {
        if (!this.data.rawData) return;

        if (mode === 'edit' && groupId) {
            const group = this.data.rawData.groups.find(g => g.id === groupId);
            if (!group) return;
            this.groupDialogTitleEl.textContent = `Редактирование: ${group.content}`;
            document.getElementById('groupIdInput').value = group.id;
            document.getElementById('groupIdInput').readOnly = true;
            document.getElementById('groupTitleInput').value = group.content;
            const color = DataManager.GROUP_COLORS[group.id] || '#8b261d';
            document.getElementById('groupColorInput').value = color;
            document.getElementById('groupColorTextInput').value = color;
            document.getElementById('deleteGroupBtn').style.display = '';
            this._editingGroupId = group.id;
        } else {
            this.groupDialogTitleEl.textContent = 'Новая группа';
            document.getElementById('groupIdInput').value = '';
            document.getElementById('groupIdInput').readOnly = false;
            document.getElementById('groupTitleInput').value = '';
            document.getElementById('groupColorInput').value = '#8b261d';
            document.getElementById('groupColorTextInput').value = '#8b261d';
            document.getElementById('deleteGroupBtn').style.display = 'none';
            this._editingGroupId = null;
        }

        this.groupDialogEl.showModal();
    }

    saveGroupFromDialog(event) {
        event.preventDefault();

        const id = document.getElementById('groupIdInput').value.trim();
        const title = document.getElementById('groupTitleInput').value.trim();

        if (!id || !title) {
            this.showToast('Заполните ID и название группы', 'error');
            return;
        }

        if (!this._editingGroupId) {
            if (this.data.rawData.groups.some(g => g.id === id)) {
                this.showToast('Группа с таким ID уже существует', 'error');
                return;
            }
            this.data.rawData.groups.push({id, content: title});
            this.data.activeGroups.add(id);
        } else {
            const group = this.data.rawData.groups.find(g => g.id === this._editingGroupId);
            if (group) {
                group.content = title;
                if (id !== this._editingGroupId) {
                    // Обновляем ID группы во всех событиях
                    this.data.rawData.items.forEach(item => {
                        if (item.group === this._editingGroupId) item.group = id;
                    });
                    group.id = id;
                    this.data.activeGroups.delete(this._editingGroupId);
                    this.data.activeGroups.add(id);
                }
            }
        }

        this.data.rawData.groups.sort((a, b) => a.content.localeCompare(b.content, 'ru'));
        this.storage.saveToStorage(this.data.rawData);
        this.groupDialogEl.close();
        this.applyFilter();
        this.renderGroupFilters();
        this.showToast('Группа сохранена', 'info');
    }

    deleteGroupFromDialog() {
        if (!this._editingGroupId) return;
        const group = this.data.rawData.groups.find(g => g.id === this._editingGroupId);
        const name = group ? group.content : this._editingGroupId;

        if (!window.confirm(`Удалить группу "${name}" и все её события?`)) return;

        this.data.deleteGroup(this._editingGroupId);
        this.storage.saveToStorage(this.data.rawData);
        this.groupDialogEl.close();
        this.applyFilter();
        this.renderGroupFilters();
        this.showToast('Группа удалена', 'info');
    }

    fillItemDialogSelects(excludeItemId = null) {
        const groupInput = document.getElementById('itemGroupInput');
        const relatedInput = document.getElementById('itemRelatedInput');

        groupInput.innerHTML = '';
        this.data.rawData.groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = `${group.content} (${group.id})`;
            groupInput.append(option);
        });

        relatedInput.innerHTML = '';
        this.data.rawData.items
            .filter(item => String(item.id) !== String(excludeItemId))
            .forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = `${item.content} (${item.id})`;
                relatedInput.append(option);
            });
    }

    openItemDialog(mode, preferredGroupId = null) {
        if (!this.data.rawData) return;

        this.editMode = mode;
        this.editOriginalId = null;

        if (mode === 'edit') {
            if (!this.data.selectedItemId) {
                this.showToast('Сначала выберите событие для редактирования', 'error');
                return;
            }
            const item = this.data.findItemById(this.data.selectedItemId);
            if (!item) {
                this.showToast('Выбранное событие не найдено', 'error');
                return;
            }
            this.editOriginalId = item.id;
            this.itemDialogTitleEl.textContent = `Редактирование: ${item.content}`;
            this.fillItemDialogSelects(item.id);

            document.getElementById('itemIdInput').value = item.id;
            document.getElementById('itemContentInput').value = item.content;
            document.getElementById('itemGroupInput').value = item.group;
            document.getElementById('itemTypeInput').value = item.type === 'range' ? 'range' : 'point';
            document.getElementById('itemStartInput').value = item.start || '';
            document.getElementById('itemEndInput').value = item.end || '';
            document.getElementById('itemDescriptionInput').value = item.description || '';
            document.getElementById('itemTagsInput').value = (item.tags || []).join(', ');
            this.setMultipleSelect(document.getElementById('itemRelatedInput'), item.related || []);
        } else {
            this.itemDialogTitleEl.textContent = 'Создание события';
            this.fillItemDialogSelects();

            document.getElementById('itemIdInput').value = '';
            document.getElementById('itemContentInput').value = '';
            document.getElementById('itemGroupInput').value = preferredGroupId || this.data.rawData.groups[0]?.id || '';
            document.getElementById('itemTypeInput').value = 'point';
            document.getElementById('itemStartInput').value = '';
            document.getElementById('itemEndInput').value = '';
            document.getElementById('itemDescriptionInput').value = '';
            document.getElementById('itemTagsInput').value = '';
            this.setMultipleSelect(document.getElementById('itemRelatedInput'), []);
        }

        this.itemDialogEl.showModal();
    }

    saveItemFromDialog(event) {
        event.preventDefault();

        const itemId = document.getElementById('itemIdInput').value.trim();
        const content = document.getElementById('itemContentInput').value.trim();
        const group = document.getElementById('itemGroupInput').value;
        const type = document.getElementById('itemTypeInput').value === 'range' ? 'range' : 'point';
        const startRaw = document.getElementById('itemStartInput').value;
        const endRaw = document.getElementById('itemEndInput').value;
        const description = document.getElementById('itemDescriptionInput').value.trim();
        const tags = this.parseCommaSeparatedTags(document.getElementById('itemTagsInput').value);
        const related = this.getMultipleSelectValues(document.getElementById('itemRelatedInput'));

        if (!itemId || !content || !startRaw || !group) {
            this.showToast('Заполните обязательные поля события', 'error');
            return;
        }

        const start = DateUtils.normalizeFlexibleDate(startRaw);
        if (!start) {
            this.showToast('Неверная дата начала. Формат: Г (0..9999), Г-ММ или Г-ММ-ДД', 'error');
            return;
        }

        const end = endRaw.trim() ? DateUtils.normalizeFlexibleDate(endRaw) : '';
        if (endRaw.trim() && !end) {
            this.showToast('Неверная дата конца. Формат: Г (0..9999), Г-ММ или Г-ММ-ДД', 'error');
            return;
        }

        if (!this.data.rawData.groups.some(g => g.id === group)) {
            this.showToast('Выбрана несуществующая группа', 'error');
            return;
        }

        if (type === 'range' && !end) {
            this.showToast('Для range укажите дату конца', 'error');
            return;
        }

        if (type === 'range' && DateUtils.compareDateStrings(start, end) > 0) {
            this.showToast('Для range конец должен быть не раньше начала', 'error');
            return;
        }

        const conflict = this.data.rawData.items.find(item => String(item.id) === String(itemId));
        if (conflict && (this.editMode === 'create' || String(this.editOriginalId) !== String(itemId))) {
            this.showToast('Событие с таким ID уже существует', 'error');
            return;
        }

        const nextItem = {id: itemId, content, group, type, start, description, tags, related};
        if (type === 'range' && end) nextItem.end = end;

        if (this.editMode === 'create') {
            this.data.rawData.items.push(nextItem);
            this.data.selectedItemId = itemId;
        } else {
            const index = this.data.rawData.items.findIndex(item => String(item.id) === String(this.editOriginalId));
            if (index === -1) {
                this.showToast('Событие для редактирования не найдено', 'error');
                return;
            }
            this.data.rawData.items[index] = nextItem;
            if (this.editOriginalId !== itemId) {
                this.data.rawData.items.forEach(item => {
                    item.related = (item.related || []).map(rel => rel === this.editOriginalId ? itemId : rel);
                });
            }
            this.data.selectedItemId = itemId;
        }

        this.data.syncTagCatalogFromItems();
        this.finalizeDataMutation('Изменения события сохранены');
        this.itemDialogEl.close();

        this.timeline.timeline.setSelection([this.data.selectedItemId]);
        this.showDetails(this.data.selectedItemId);
        this.timeline.updateSelectionGuideLines(this.data);
    }

    deleteSelectedItem() {
        if (!this.data.selectedItemId) {
            this.showToast('Выберите событие для удаления', 'error');
            return;
        }
        if (!window.confirm('Удалить выбранное событие?')) return;

        const deletingId = this.data.selectedItemId;
        this.data.rawData.items = this.data.rawData.items.filter(item => String(item.id) !== String(deletingId));
        this.data.rawData.items.forEach(item => {
            item.related = (item.related || []).filter(rel => String(rel) !== String(deletingId));
        });

        this.data.selectedItemId = null;
        this.data.syncTagCatalogFromItems();
        this.finalizeDataMutation('Событие удалено');
        this.resetDetails('Выберите событие на таймлайне');
    }

    finalizeDataMutation(message) {
        this.renderTagsFilter();
        this.renderGroupFilters();
        this.applyFilter();

        if (this.data.selectedItemId && this.data.findItemById(this.data.selectedItemId)) {
            this.showDetails(this.data.selectedItemId);
        }

        if (this.storage.saveToStorage(this.data.rawData)) {
            this.showToast(`${message}. Данные сохранены в localStorage.`, 'info');
        } else {
            this.showToast(`${message}. Ошибка записи в localStorage.`, 'error');
        }
    }

    async importStorageFromFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const nextState = parsed && parsed.data && parsed.format ? parsed.data : parsed;

            // Автоматически создаём группы из событий, если их нет в файле
            if (!nextState.groups || !Array.isArray(nextState.groups)) {
                nextState.groups = [];
            }
            const existingGroupIds = new Set(nextState.groups.map(g => g.id));
            if (nextState.items && Array.isArray(nextState.items)) {
                nextState.items.forEach(item => {
                    const groupId = String(item.group || '').trim();
                    if (groupId && !existingGroupIds.has(groupId)) {
                        nextState.groups.push({ id: groupId, content: groupId });
                        existingGroupIds.add(groupId);
                    }
                });
            }

            this.data.setData(nextState);
            this.storage.saveToStorage(this.data.rawData);
            this.showToast(`Состояние загружено из файла: ${file.name}`, 'info');
            this.applyFilter();
            this.refreshUI();
        } catch (error) {
            this.showToast(`Ошибка импорта состояния: ${error.message}`, 'error');
        }
    }

    applyImportFromText(event) {
        event.preventDefault();
        if (!this.data.rawData) {
            this.showToast('Сначала загрузите данные', 'error');
            return;
        }

        const sourceText = this.importTextInputEl.value.trim();
        if (!sourceText) {
            this.showToast('Вставьте JSON для импорта', 'error');
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(sourceText);
        } catch (error) {
            this.showToast(`Ошибка JSON: ${error.message}`, 'error');
            return;
        }

        const incoming = this.extractImportedItems(parsed);
        if (!incoming.length) {
            this.showToast('Не найдено событий для импорта', 'error');
            return;
        }

        let added = 0, updated = 0;
        const touchedGroups = new Set();

        incoming.forEach(entry => {
            const normalized = this.normalizeImportedItem(entry);
            if (!normalized) return;

            if (!this.data.rawData.groups.some(g => g.id === normalized.group)) {
                this.data.rawData.groups.push({id: normalized.group, content: normalized.group});
                this.data.activeGroups.add(normalized.group);
                touchedGroups.add(normalized.group);
            }

            const index = this.data.rawData.items.findIndex(item => String(item.id) === String(normalized.id));
            if (index >= 0) {
                this.data.rawData.items[index] = normalized;
                updated++;
            } else {
                this.data.rawData.items.push(normalized);
                added++;
            }

            this.data.selectedItemId = normalized.id;
        });

        if (!added && !updated) {
            this.showToast('Импорт не выполнился: проверьте обязательные поля id/start', 'error');
            return;
        }

        if (touchedGroups.size) {
            this.data.rawData.groups.sort((a, b) => a.content.localeCompare(b.content, 'ru'));
        }

        this.data.syncTagCatalogFromItems();
        this.finalizeDataMutation(`Импорт завершен: добавлено ${added}, обновлено ${updated}`);

        if (this.data.selectedItemId) {
            this.timeline.timeline.setSelection([this.data.selectedItemId]);
            this.showDetails(this.data.selectedItemId);
            this.timeline.updateSelectionGuideLines(this.data);
        }
        this.importDialogEl.close();
    }

    extractImportedItems(parsed) {
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) return parsed.items;
        if (parsed && typeof parsed === 'object') return [parsed];
        return [];
    }

    normalizeImportedItem(item) {
        if (!item || typeof item !== 'object') return null;
        const id = String(item.id || '').trim();
        const content = String(item.content || id || '').trim();
        const start = DateUtils.normalizeFlexibleDate(item.start);
        const group = String(item.group || this.data.rawData.groups[0]?.id || '').trim();
        const type = item.type === 'range' ? 'range' : 'point';
        if (!id || !content || !start || !group) return null;

        const normalized = {
            id, content, group, type, start,
            description: String(item.description || '').trim(),
            tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : [],
            related: Array.isArray(item.related) ? item.related.map(r => String(r).trim()).filter(Boolean) : []
        };
        if (item.end) {
            const end = DateUtils.normalizeFlexibleDate(item.end);
            if (!end) return null;
            normalized.end = end;
        }
        if (normalized.type === 'range' && !normalized.end) return null;
        if (normalized.type === 'range' && DateUtils.compareDateStrings(normalized.start, normalized.end) > 0) return null;
        return normalized;
    }

    _rollText(el, targetText, duration = 500) {
        if (!el) return;
        const half = duration / 2;
        el.style.transition = `transform ${half}ms ease-in, opacity ${half}ms ease-in`;
        el.style.transform = 'translateY(-10px)';
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = targetText;
            el.style.transition = 'none';
            el.style.transform = 'translateY(10px)';
            el.style.opacity = '0';
            el.offsetHeight; // принудительный reflow для анимации
            el.style.transition = `transform ${half}ms ease-out, opacity ${half}ms ease-out`;
            el.style.transform = 'translateY(0)';
            el.style.opacity = '1';
        }, half);
    }

    resetTitleChangeTimer() {
        clearInterval(this.titleChangeInterval);
        this.titleChangeInterval = setInterval(() => this.applyRandomPoeticTitle(), 30000);
    }

    applyRandomPoeticTitle() {
        const title = this._randomFromArray(POETIC_TITLES, 'historicTitlesIndex');
        const subtitle = this._randomFromArray(POETIC_SUBTITLES, 'historicSubtitlesIndex');
        this._rollText(document.querySelector('.brand-title'), title, 500);
        this._rollText(document.querySelector('.small-subtitle'), subtitle, 500);
    }

    _randomFromArray(array, storageKey) {
        const previous = localStorage.getItem(storageKey);
        let index;
        do {
            index = Math.floor(Math.random() * array.length);
        } while (array.length > 1 && String(index) === previous);
        localStorage.setItem(storageKey, index);
        return array[index];
    }

}