const STORAGE_KEY = 'historyTimeline:data:v1';

let rawData;
let timeline;
let fileHandle = null;
let selectedItemId = null;
let hoveredItemId = null;
let editMode = 'create';
let editOriginalId = null;
let searchQuery = '';
let highlightQuery = '';
let tagSearchQuery = '';

const activeTags = new Set();
const activeGroups = new Set();
const excludedTags = new Set();

const detailsEl = document.getElementById('details');
const fileStatusEl = document.getElementById('fileStatus');
const tagsFilterEl = document.getElementById('tags');
const groupFiltersEl = document.getElementById('groupFilters');
const timelineWrapEl = document.getElementById('timelineWrap');
const hoverLineEl = document.getElementById('hoverLine');
const hoverDateEl = document.getElementById('hoverDate');
const selectionStartLineEl = document.getElementById('selectionStartLine');
const selectionEndLineEl = document.getElementById('selectionEndLine');
const intervalLineEl = document.getElementById('intervalLine');
const intervalLabelEl = document.getElementById('intervalLabel');
const intervalArrowLeftEl = document.getElementById('intervalArrowLeft');
const intervalArrowRightEl = document.getElementById('intervalArrowRight');
// dynamic elements for hovered-item guide lines (created at runtime)
let hoverSelectionStartEl = null;
let hoverSelectionEndEl = null;

// Keep floating labels inside viewport horizontally
function clampLabelToViewport(el) {
    if (!el) return;
    try {
        const rect = el.getBoundingClientRect();
        const half = rect.width / 2;
        const min = 8 + half;
        const max = Math.max(8 + half, window.innerWidth - 8 - half);
        const leftRaw = parseFloat(String(el.style.left || '0').replace('px', ''));
        if (Number.isNaN(leftRaw)) return;
        const clamped = Math.min(Math.max(leftRaw, min), max);
        el.style.left = `${Math.round(clamped)}px`;
    } catch (e) {
        // ignore measurement errors
    }
}

function getTimelineViewportTop(offset = 8) {
    if (!timelineWrapEl) return offset;
    try {
        const rect = timelineWrapEl.getBoundingClientRect();
        return Math.max(offset, Math.round(rect.top + offset));
    } catch (e) {
        return offset;
    }
}

const itemDialogEl = document.getElementById('itemDialog');
const itemDialogTitleEl = document.getElementById('itemDialogTitle');
const itemFormEl = document.getElementById('itemForm');
const itemIdInputEl = document.getElementById('itemIdInput');
const itemContentInputEl = document.getElementById('itemContentInput');
const itemGroupInputEl = document.getElementById('itemGroupInput');
const itemTypeInputEl = document.getElementById('itemTypeInput');
const itemStartInputEl = document.getElementById('itemStartInput');
const itemEndInputEl = document.getElementById('itemEndInput');
const itemDescriptionInputEl = document.getElementById('itemDescriptionInput');
const itemTagsInputEl = document.getElementById('itemTagsInput');
const itemRelatedInputEl = document.getElementById('itemRelatedInput');
const tagSearchInputEl = document.getElementById('tagSearchInput');
const importDialogEl = document.getElementById('importDialog');
const importFormEl = document.getElementById('importForm');
const importTextInputEl = document.getElementById('importTextInput');
const stateFileInputEl = document.getElementById('stateFileInput');

// hoveredItemId is declared earlier and used to track current hovered item from timeline events

const fileApiSupported =
    'showOpenFilePicker' in window &&
    'showSaveFilePicker' in window;

initApp();

async function initApp() {
    bindSearch();
    bindTagSearch();
    bindFileActions();
    bindCrudActions();

    const cached = loadFromStorage();
    if (cached) {
        try {
            setData(cached);
            updateFileStatus('Источник: localStorage');
            return;
        } catch (error) {
            console.warn(error);
        }
    }

    await loadDefaultData();

    if (!fileApiSupported) {
        updateFileStatus('File API не поддерживается. Используется localStorage.');
    }
}

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        return JSON.parse(raw);
    } catch (error) {
        console.warn('localStorage read error:', error);
        return null;
    }
}

function saveToStorage(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        console.warn('localStorage write error:', error);
        return false;
    }
}

function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
}

async function loadDefaultData() {
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        setData(data);
        updateFileStatus('Источник: встроенный data.json');
    } catch (error) {
        updateFileStatus('Не удалось загрузить data.json', true);
        resetDetails('Ошибка загрузки данных. Откройте JSON вручную.');
        console.error(error);
    }
}

function normalizeData(data) {
    if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items)) {
        throw new Error('Ожидался объект с массивами groups и items');
    }

    const groups = data.groups
        .map(group => ({
            id: String(group.id).trim(),
            content: String(group.content || group.id).trim()
        }))
        .filter(group => group.id.length > 0);

    const seenIds = new Set();
    const items = [];

    data.items.forEach(item => {
        const id = String(item.id || '').trim();
        if (!id || seenIds.has(id)) {
            return;
        }
        seenIds.add(id);

        items.push({
            id,
            group: String(item.group || groups[0]?.id || '').trim(),
            content: String(item.content || id).trim(),
            start: String(item.start || '').trim(),
            end: item.end ? String(item.end).trim() : undefined,
            type: item.type === 'range' ? 'range' : 'point',
            tags: Array.isArray(item.tags)
                ? item.tags.map(tag => String(tag).trim()).filter(Boolean)
                : [],
            description: String(item.description || '').trim(),
            related: Array.isArray(item.related)
                ? item.related.map(rel => String(rel).trim()).filter(Boolean)
                : []
        });
    });

    const tags = new Set(
        Array.isArray(data.tags)
            ? data.tags.map(tag => String(tag).trim()).filter(Boolean)
            : []
    );

    items.forEach(item => {
        item.tags.forEach(tag => tags.add(tag));
    });

    return {
        groups,
        items,
        tags: [...tags].sort((a, b) => a.localeCompare(b, 'ru'))
    };
}

function setData(data) {
    rawData = normalizeData(data);
    selectedItemId = null;
    activeTags.clear();
    activeGroups.clear();
    rawData.groups.forEach(group => {
        activeGroups.add(group.id);
    });

    if (timeline) {
        timeline.destroy();
        timeline = null;
    }

    buildTimeline();
    renderTagsFilter();
    renderGroupFilters();
    resetDetails('Выберите событие на таймлайне');
    applyFilter();
}

function buildTimeline() {
    const container = document.getElementById('timeline');

    // Patch vis.Timeline.focus to be resilient against items whose start/end
    // are not Date instances (some builds may leave raw strings/undefined).
    // We patch once per page load.
    try {
        if (window.vis && vis.Timeline && !vis.Timeline.prototype._safeFocusPatched) {
            const _origFocus = vis.Timeline.prototype.focus;
            vis.Timeline.prototype.focus = function (id, options) {
                // Always call original focus implementation first to preserve
                // vertical scrolling and richer behavior. After that, ensure we
                // didn't zoom into a too-small interval for point items.
                try {
                    _origFocus.call(this, id, options);
                } catch (err) {
                    // Fallback for TypeError caused by calling valueOf on undefined
                    if (!(err instanceof TypeError) || !err.message || !err.message.includes('valueOf')) {
                        throw err;
                    }

                    if (!this.itemsData || id == undefined) return;
                    const ids = Array.isArray(id) ? id : [id];
                    const itemsData = this.itemsData.get(ids);

                    let start = null;
                    let end = null;
                    itemsData.forEach(itemData => {
                        if (!itemData || itemData.start == undefined) return;
                        const sDate = (itemData.start instanceof Date) ? itemData.start : toVisDate(itemData.start, false);
                        const eDate = (itemData.end != undefined)
                            ? (itemData.end instanceof Date ? itemData.end : toVisDate(itemData.end, true))
                            : sDate;
                        if (!(sDate instanceof Date) || !(eDate instanceof Date)) return;
                        const s = sDate.valueOf();
                        const e = eDate.valueOf();
                        if (start === null || s < start) start = s;
                        if (end === null || e > end) end = e;
                    });

                    if (start !== null && end !== null) {
                        const zoom = options && options.zoom !== undefined ? options.zoom : true;
                        let interval = zoom ? (end - start) * 1.1 : Math.max(this.range.end - this.range.start, (end - start) * 1.1);
                        // If interval is zero (point item), use a reasonable minimum (7 days)
                        const MIN_INTERVAL = 1000 * 60 * 60 * 24 * 7; // 7 days
                        if (!Number.isFinite(interval) || interval <= 0) interval = MIN_INTERVAL;
                        const middle = (start + end) / 2;
                        const animation = options && options.animation !== undefined ? options.animation : true;
                        try {
                            this.range.stopRolling();
                            this.range.setRange(new Date(middle - interval / 2), new Date(middle + interval / 2), {animation});
                        } catch (e) {
                            // ignore
                        }
                    }

                    return;
                }

                // Post-check: if original focus succeeded but produced a too-small
                // window (e.g. point item collapsed to exact time), expand to a
                // reasonable minimum interval to avoid excessive zoom.
                try {
                    const MIN_INTERVAL = 1000 * 60 * 60 * 24 * 7; // 7 days
                    const win = (typeof this.getWindow === 'function') ? this.getWindow() : {
                        start: this.range.start,
                        end: this.range.end
                    };
                    if (win && win.start instanceof Date && win.end instanceof Date) {
                        const sMs = win.start.getTime();
                        const eMs = win.end.getTime();
                        if (eMs - sMs < MIN_INTERVAL) {
                            const middle = (sMs + eMs) / 2;
                            const animation = options && options.animation !== undefined ? options.animation : true;
                            try {
                                this.setWindow(new Date(middle - MIN_INTERVAL / 2), new Date(middle + MIN_INTERVAL / 2), {animation});
                            } catch (e) {
                                // ignore
                            }
                        }
                    }
                } catch (e) {
                    // ignore
                }
            };
            vis.Timeline.prototype._safeFocusPatched = true;
        }
    } catch (e) {
        console.warn('Failed to install safe focus patch for vis.Timeline:', e);
    }

    timeline = new vis.Timeline(
        container,
        new vis.DataSet(buildTimelineItems(rawData.items)),
        new vis.DataSet(rawData.groups),
        {
            zoomKey: 'ctrlKey',
            margin: {
                item: {
                    horizontal: 4,
                    vertical: 2
                },
                axis: 4
            }
        }
    );

    // listen to vis timeline itemover/itemout events to get hovered item id directly
    try {
        timeline.on && timeline.on('itemover', props => {
            try {
                hoveredItemId = props && props.item ? String(props.item) : null;
            } catch (e) {
                hoveredItemId = null;
            }
        });

        timeline.on && timeline.on('itemout', props => {
            try {
                // itemout may provide item; clear hovered id when pointer leaves
                hoveredItemId = null;
                // hide any interval UI when pointer leaves an item
                hideIntervalVisualization();
            } catch (e) {
                hoveredItemId = null;
            }
        });
    } catch (e) {
        // ignore if timeline implementation does not support these events
    }

    bindTimelineHoverGuide();

    // itemover/itemout handled above (registered with try block)

    timeline.on('select', props => {
        if (!props.items.length) {
            selectedItemId = null;
            resetDetails('Выберите событие на таймлайне');
            hideSelectionGuideLines();
            return;
        }

        const pickedId = String(props.items[0]);
        if (pickedId.startsWith('bg-century-')) {
            selectedItemId = null;
            timeline.setSelection([]);
            hideSelectionGuideLines();
            return;
        }

        selectedItemId = pickedId;
        showDetails(selectedItemId);
        updateSelectionGuideLines();
    });

    timeline.on('doubleClick', props => {
        if (!props.item) {
            return;
        }

        const pickedId = String(props.item);
        if (pickedId.startsWith('bg-century-')) {
            return;
        }

        selectedItemId = pickedId;
        openItemDialog('edit');
    });

    timeline.on('rangechanged', () => {
        updateSelectionGuideLines();
    });
}

function resetDetails(message) {
    detailsEl.classList.add('details-empty');
    detailsEl.textContent = message;
}

function showDetails(id) {
    const item = findItemById(id);
    if (!item) {
        resetDetails('Событие не найдено');
        return;
    }

    const related = (item.related || [])
        .map(relId => {
            const rel = findItemById(relId);
            if (!rel) {
                return '';
            }
            return `<li data-id="${escapeHtml(rel.id)}" class="related-link">${escapeHtml(rel.content)}</li>`;
        })
        .join('');

    const tags = item.tags?.length
        ? item.tags.map(tag => renderTagChipHtml(tag, 'detail-tag')).join(' ')
        : '<span class="muted">Нет тегов</span>';

    const dateLabel = escapeHtml(formatDateRange(item));

    const relations = related.trim().length
        ? `<ul>${related}</ul>`
        : '<p>Связанных событий нет.</p>';

    let initialWiki = `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(item.content.trim())}`;
    detailsEl.classList.remove('details-empty');
    detailsEl.innerHTML = `
        <a id="wiki-link" href="${initialWiki}" target="_blank"><h2>${escapeHtml(item.content)}</h2></a>
        <p class="item-meta">ID: ${escapeHtml(item.id)} | Группа: ${escapeHtml(item.group)}</p>
        <p class="item-meta">Дата: ${dateLabel}</p>
        <p>${escapeHtml(item.description || 'Описание не заполнено')}</p>
        <p>Теги: ${tags}</p>
        <h3>Связи</h3>
        ${relations}
    `;

    getSmartWikipediaUrl(item.content).then(smartUrl => {
        const wikiLinkEl = document.getElementById('wiki-link');
        if (wikiLinkEl) {
            wikiLinkEl.href = smartUrl;
        }
    }).catch(err => console.error("Вики недоступна:", err));

    bindRelatedLinks();
    bindDetailsTagClicks();
}

function renderTagChipHtml(tag, extraClass = '') {
    const tagClass = [
        'tag',
        extraClass,
        activeTags.has(tag) ? 'active' : '',
        excludedTags.has(tag) ? 'excluded' : ''
    ].filter(Boolean).join(' ');

    return `<span class="${tagClass}" data-tag="${encodeURIComponent(tag)}"><span class="tag-text">${escapeHtml(tag)}</span><button type="button" class="tag-remove-btn" data-tag-action="exclude" title="Исключить тег ${escapeHtml(tag)} из видимости">—</button><button type="button" class="tag-remove-btn" data-tag-action="delete" title="Удалить тег ${escapeHtml(tag)} (удалит тег из всех событий)">x</button></span>`;
}

function getTagUsageMap() {
    const usage = new Map();
    rawData.items.forEach(item => {
        (item.tags || []).forEach(tag => {
            usage.set(tag, (usage.get(tag) || 0) + 1);
        });
    });
    rawData.tags.forEach(tag => {
        if (!usage.has(tag)) usage.set(tag, 0);
    });
    return usage;
}

function parseCommaSeparatedTags(raw) {
    return [...new Set(
        String(raw || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
    )];
}

function refreshTagPanels() {
    renderTagsFilter();
    if (selectedItemId) {
        const selected = findItemById(selectedItemId);
        if (selected) {
            showDetails(selectedItemId);
        }
    }
}

function toggleTagInclusion(tag) {
    if (excludedTags.has(tag)) {
        excludedTags.delete(tag);
    }
    if (activeTags.has(tag)) {
        activeTags.delete(tag);
    } else {
        activeTags.add(tag);
    }
    applyFilter();
    refreshTagPanels();
}

function toggleTagExclusion(tag) {
    if (excludedTags.has(tag)) {
        excludedTags.delete(tag);
    } else {
        excludedTags.add(tag);
        activeTags.delete(tag);
    }
    applyFilter();
    refreshTagPanels();
}

function bindRelatedLinks() {
    document.querySelectorAll('.related-link').forEach(el => {
        el.onclick = () => {
            const id = el.dataset.id;
            if (!id) {
                return;
            }
            selectedItemId = id;
            // Center on the item without changing zoom level (avoid heavy zoom for point items)
            centerOnItemWithoutZoom(id);
            timeline.setSelection([id]);
            showDetails(id);
            updateSelectionGuideLines();
        };
    });
}

function centerOnItemWithoutZoom(id) {
    if (!timeline) return;
    const item = findItemById(id);
    if (!item) return;

    const startDate = toVisDate(item.start, false);
    const endDate = item.end ? toVisDate(item.end, true) : startDate;
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) return;

    // Keep current window interval, only recenter horizontally
    let interval = null;
    try {
        const win = (typeof timeline.getWindow === 'function') ? timeline.getWindow() : null;
        if (win && win.start instanceof Date && win.end instanceof Date) {
            interval = win.end.getTime() - win.start.getTime();
        }
    } catch (e) {
        // ignore
    }

    const middle = (startDate.getTime() + endDate.getTime()) / 2;

    if (!interval || !Number.isFinite(interval) || interval <= 0) {
        // fallback to a reasonable default (14 days)
        interval = 1000 * 60 * 60 * 24 * 14;
    }

    const newStart = new Date(middle - interval / 2);
    const newEnd = new Date(middle + interval / 2);
    try {
        timeline.setWindow(newStart, newEnd, {animation: true});
    } catch (e) {
        try {
            // older API
            timeline.setWindow(newStart, newEnd);
        } catch (err) {
            // ignore
        }
    }
}

function bindDetailsTagClicks() {
    detailsEl.querySelectorAll('.detail-tag').forEach(el => {
        const raw = el.getAttribute('data-tag');
        if (!raw) return;
        const tag = decodeURIComponent(raw);

        const excludeBtn = el.querySelector('[data-tag-action="exclude"]');
        const deleteBtn = el.querySelector('[data-tag-action="delete"]');

        if (excludeBtn) {
            excludeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleTagExclusion(tag);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!window.confirm(`Удалить тег "${tag}"? Тег будет удалён из всех событий.`)) {
                    return;
                }
                deleteTag(tag);
            });
        }

        el.addEventListener('click', () => {
            toggleTagInclusion(tag);
        });
    });
}

function applyFilter() {
    if (!timeline || !rawData) {
        return;
    }

    const filtered = getFilteredItems();

    const visibleGroups = rawData.groups.filter(group => activeGroups.has(group.id));
    timeline.setGroups(new vis.DataSet(visibleGroups));
    timeline.setItems(new vis.DataSet(buildTimelineItems(filtered)));

    const hasSelectedVisible = filtered.some(item => String(item.id) === String(selectedItemId));

    if (!filtered.length) {
        selectedItemId = null;
        timeline.setSelection([]);
        hideSelectionGuideLines();
        resetDetails('Ничего не найдено. Попробуйте снять часть фильтров.');
        return;
    }

    if (!hasSelectedVisible) {
        selectedItemId = null;
        timeline.setSelection([]);
        hideSelectionGuideLines();
        resetDetails('Выберите событие на таймлайне');
        return;
    }

    updateSelectionGuideLines();
}

function getFilteredItems() {
    return rawData.items.filter(item => {
        // group visibility
        if (!activeGroups.has(item.group)) {
            return false;
        }

        // exclude by excludedTags
        if ((item.tags || []).some(tag => excludedTags.has(tag))) {
            return false;
        }

        const matchesQuery =
            !searchQuery ||
            (item.content || '').toLowerCase().includes(searchQuery) ||
            (item.description || '').toLowerCase().includes(searchQuery) ||
            (item.tags || []).some(tag => tag.toLowerCase().includes(searchQuery));

        if (!matchesQuery) {
            return false;
        }

        if (!activeTags.size) {
            return true;
        }

        return (item.tags || []).some(tag => activeTags.has(tag));
    });
}

function bindSearch() {
    const searchInput = document.getElementById('search');
    const highlightInput = document.getElementById('highlightSearchCheckbox');
    const clearBtn = document.getElementById('clearSearch');

    searchInput.addEventListener('input', updateSearch);
    highlightInput.addEventListener('change', updateSearch);

    function updateSearch() {
        const highlightInputValue = highlightInput.checked;
        const query = searchInput.value.trim().toLowerCase();
        highlightQuery = highlightInputValue ? query : '';
        searchQuery = highlightInputValue ? '' : query;

        if (query.length > 0) {
            clearBtn.removeAttribute('hidden');
        } else {
            clearBtn.setAttribute('hidden', '');
        }

        applyFilter();
    }

    searchInput.addEventListener('input', () => {

    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.setAttribute('hidden', '');
        searchInput.focus();
        searchInput.dispatchEvent(new Event('input'));
    });
}

function isItemHighlighted(item) {
    if (!highlightQuery) {
        return false;
    }

    const haystacks = [
        item.id,
        item.content,
        item.description,
        item.group,
        ...(item.tags || [])
    ];

    return haystacks.some(value => String(value || '').toLowerCase().includes(highlightQuery));
}

function bindTagSearch() {
    if (!tagSearchInputEl) return;
    tagSearchInputEl.addEventListener('input', () => {
        tagSearchQuery = tagSearchInputEl.value.trim().toLowerCase();
        renderTagsFilter();
    });
}

function renderTagsFilter() {
    tagsFilterEl.innerHTML = '';

    const usage = getTagUsageMap();
    const filteredTags = rawData.tags
        .filter(tag => !tagSearchQuery || tag.toLowerCase().includes(tagSearchQuery))
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
            activeTags.has(tag) ? 'active' : '',
            excludedTags.has(tag) ? 'excluded' : ''
        ].filter(Boolean).join(' ');
        div.innerHTML = `<span class="tag-text">${escapeHtml(tag)}</span>`;

        // exclude button (toggle exclusion)
        const excludeBtn = document.createElement('button');
        excludeBtn.type = 'button';
        excludeBtn.className = 'tag-remove-btn';
        excludeBtn.title = `Исключить тег ${tag} из видимости`;
        excludeBtn.textContent = '—';
        excludeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTagExclusion(tag);
        });

        // remove button (delete tag from catalog and items)
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'tag-remove-btn';
        removeBtn.title = `Удалить тег ${tag} (удалит тег из всех событий)`;
        removeBtn.textContent = 'x';
        removeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!window.confirm(`Удалить тег "${tag}"? Тег будет удалён из всех событий.`)) {
                return;
            }

            deleteTag(tag);
        });

        // click toggles inclusion (active) — clears exclusion if set
        div.addEventListener('click', () => {
            toggleTagInclusion(tag);
        });

        div.append(excludeBtn, removeBtn);
        tagsFilterEl.append(div);
    });

    if (!visibleTags.length) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'tag-more-indicator';
        emptyEl.textContent = 'Ничего не найдено';
        tagsFilterEl.append(emptyEl);
        return;
    }

    if (filteredTags.length > 20) {
        const moreEl = document.createElement('div');
        moreEl.className = 'tag-more-indicator';
        moreEl.textContent = '...';
        tagsFilterEl.append(moreEl);
    }
}

function renderGroupFilters() {
    groupFiltersEl.innerHTML = '';

    rawData.groups.forEach(group => {
        const label = document.createElement('label');
        label.className = 'group-filter-item';

        const left = document.createElement('span');
        left.className = 'group-filter-left';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = activeGroups.has(group.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                activeGroups.add(group.id);
            } else {
                activeGroups.delete(group.id);
            }

            applyFilter();
        });

        const text = document.createElement('span');
        text.textContent = `${group.content} (${group.id})`;

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'group-add-btn';
        addBtn.textContent = '+';
        addBtn.title = `Добавить событие в группу ${group.content}`;
        addBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openItemDialog('create', group.id);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'group-delete-btn';
        deleteBtn.textContent = 'x';
        deleteBtn.title = `Удалить группу ${group.content}`;
        deleteBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteGroup(group.id);
        });

        const actions = document.createElement('span');
        actions.className = 'group-filter-actions';
        actions.append(addBtn, deleteBtn);

        left.append(checkbox, text);
        label.append(left, actions);
        groupFiltersEl.append(label);
    });
}

function invertGroupVisibility() {
    if (!rawData || !rawData.groups.length) {
        return;
    }

    const nextActive = new Set();
    rawData.groups.forEach(group => {
        if (!activeGroups.has(group.id)) {
            nextActive.add(group.id);
        }
    });

    activeGroups.clear();
    nextActive.forEach(groupId => activeGroups.add(groupId));

    applyFilter();
    renderGroupFilters();
}

function setAllGroupsVisibility(isVisible) {
    if (!rawData || !rawData.groups.length) {
        return;
    }

    activeGroups.clear();
    if (isVisible) {
        rawData.groups.forEach(group => activeGroups.add(group.id));
    }

    applyFilter();
    renderGroupFilters();
}

function bindCrudActions() {
    document.getElementById('resetZoomBtn').addEventListener('click', resetTimelineZoom);
    document.getElementById('addItemBtn').addEventListener('click', () => openItemDialog('create'));
    document.getElementById('editItemBtn').addEventListener('click', () => openItemDialog('edit'));
    document.getElementById('deleteItemBtn').addEventListener('click', deleteSelectedItem);
    document.getElementById('showAllGroupsBtn').addEventListener('click', () => setAllGroupsVisibility(true));
    document.getElementById('hideAllGroupsBtn').addEventListener('click', () => setAllGroupsVisibility(false));
    document.getElementById('invertGroupsBtn').addEventListener('click', invertGroupVisibility);


    document.getElementById('closeItemDialogBtn').addEventListener('click', () => itemDialogEl.close());
    itemFormEl.addEventListener('submit', saveItemFromDialog);

    document.getElementById('closeImportDialogBtn').addEventListener('click', () => importDialogEl.close());
    importFormEl.addEventListener('submit', applyImportFromText);
}

function resetTimelineZoom() {
    if (!timeline || !rawData) {
        return;
    }

    const filtered = getFilteredItems();
    if (!filtered.length) {
        return;
    }

    const timestamps = filtered
        .flatMap(item => [
            toVisDate(item.start, false)?.getTime?.(),
            toVisDate(item.end || item.start, true)?.getTime?.()
        ])
        .filter(ts => Number.isFinite(ts));

    if (!timestamps.length) {
        return;
    }

    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const padding = Math.max((max - min) * 0.08, 1000 * 60 * 60 * 24 * 30);

    timeline.setWindow(
        new Date(min - padding),
        new Date(max + padding),
        {animation: true}
    );
}

function openItemDialog(mode, preferredGroupId = null) {
    if (!rawData) {
        return;
    }

    editMode = mode;
    editOriginalId = null;

    if (mode === 'edit') {
        if (!selectedItemId) {
            updateFileStatus('Сначала выберите событие для редактирования', true);
            return;
        }

        const item = findItemById(selectedItemId);
        if (!item) {
            updateFileStatus('Выбранное событие не найдено', true);
            return;
        }

        editOriginalId = item.id;
        itemDialogTitleEl.textContent = `Редактирование: ${item.content}`;
        fillItemDialogSelects(item.id);

        itemIdInputEl.value = item.id;
        itemContentInputEl.value = item.content;
        itemGroupInputEl.value = item.group;
        itemTypeInputEl.value = item.type === 'range' ? 'range' : 'point';
        itemStartInputEl.value = item.start || '';
        itemEndInputEl.value = item.end || '';
        itemDescriptionInputEl.value = item.description || '';

        itemTagsInputEl.value = (item.tags || []).join(', ');
        setMultipleSelect(itemRelatedInputEl, item.related || []);
    } else {
        itemDialogTitleEl.textContent = 'Создание события';
        fillItemDialogSelects();

        itemIdInputEl.value = '';
        itemContentInputEl.value = '';
        itemGroupInputEl.value = preferredGroupId || rawData.groups[0]?.id || '';
        itemTypeInputEl.value = 'point';
        itemStartInputEl.value = '';
        itemEndInputEl.value = '';
        itemDescriptionInputEl.value = '';
        itemTagsInputEl.value = '';
        setMultipleSelect(itemRelatedInputEl, []);
    }

    itemDialogEl.showModal();
}

function fillItemDialogSelects(excludeItemId = null) {
    itemGroupInputEl.innerHTML = '';
    rawData.groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = `${group.content} (${group.id})`;
        itemGroupInputEl.append(option);
    });

    itemRelatedInputEl.innerHTML = '';
    rawData.items
        .filter(item => String(item.id) !== String(excludeItemId))
        .forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.content} (${item.id})`;
            itemRelatedInputEl.append(option);
        });
}

function saveItemFromDialog(event) {
    event.preventDefault();

    const itemId = itemIdInputEl.value.trim();
    const content = itemContentInputEl.value.trim();
    const group = itemGroupInputEl.value;
    const type = itemTypeInputEl.value === 'range' ? 'range' : 'point';
    const startRaw = itemStartInputEl.value;
    const endRaw = itemEndInputEl.value;
    const description = itemDescriptionInputEl.value.trim();
    const tags = parseCommaSeparatedTags(itemTagsInputEl.value);
    const related = getMultipleSelectValues(itemRelatedInputEl);

    if (!itemId || !content || !startRaw || !group) {
        updateFileStatus('Заполните обязательные поля события', true);
        return;
    }

    const start = normalizeFlexibleDate(startRaw);
    if (!start) {
        updateFileStatus('Неверная дата начала. Формат: Г (0..9999), Г-ММ или Г-ММ-ДД', true);
        return;
    }

    const end = endRaw.trim() ? normalizeFlexibleDate(endRaw) : '';
    if (endRaw.trim() && !end) {
        updateFileStatus('Неверная дата конца. Формат: Г (0..9999), Г-ММ или Г-ММ-ДД', true);
        return;
    }

    if (!rawData.groups.some(g => g.id === group)) {
        updateFileStatus('Выбрана несуществующая группа', true);
        return;
    }

    if (type === 'range' && !end) {
        updateFileStatus('Для range укажите дату конца', true);
        return;
    }

    if (type === 'range' && compareDateStrings(start, end) > 0) {
        updateFileStatus('Для range конец должен быть не раньше начала', true);
        return;
    }

    const conflict = rawData.items.find(item => String(item.id) === String(itemId));
    if (conflict && (editMode === 'create' || String(editOriginalId) !== String(itemId))) {
        updateFileStatus('Событие с таким ID уже существует', true);
        return;
    }

    const nextItem = {
        id: itemId,
        content,
        group,
        type,
        start,
        description,
        tags,
        related
    };

    if (type === 'range' && end) {
        nextItem.end = end;
    }

    if (editMode === 'create') {
        rawData.items.push(nextItem);
        selectedItemId = itemId;
    } else {
        const index = rawData.items.findIndex(item => String(item.id) === String(editOriginalId));
        if (index === -1) {
            updateFileStatus('Событие для редактирования не найдено', true);
            return;
        }

        rawData.items[index] = nextItem;

        if (editOriginalId !== itemId) {
            rawData.items.forEach(item => {
                item.related = (item.related || []).map(rel => rel === editOriginalId ? itemId : rel);
            });
        }

        selectedItemId = itemId;
    }

    syncTagCatalogFromItems();
    finalizeDataMutation('Изменения события сохранены');
    itemDialogEl.close();

    timeline.setSelection([selectedItemId]);
    showDetails(selectedItemId);
    updateSelectionGuideLines();
}

function deleteSelectedItem() {
    if (!selectedItemId) {
        updateFileStatus('Выберите событие для удаления', true);
        return;
    }

    if (!window.confirm('Удалить выбранное событие?')) {
        return;
    }

    const deletingId = selectedItemId;
    rawData.items = rawData.items.filter(item => String(item.id) !== String(deletingId));
    rawData.items.forEach(item => {
        item.related = (item.related || []).filter(rel => String(rel) !== String(deletingId));
    });

    selectedItemId = null;
    syncTagCatalogFromItems();
    finalizeDataMutation('Событие удалено');
    resetDetails('Выберите событие на таймлайне');
}

function addGroup() {
    const idInput = document.getElementById('newGroupId');
    const contentInput = document.getElementById('newGroupContent');

    const id = idInput.value.trim();
    const content = contentInput.value.trim();

    if (!id || !content) {
        updateFileStatus('Для группы нужны id и название', true);
        return;
    }

    if (!/^[a-z0-9-_]+$/i.test(id)) {
        updateFileStatus('ID группы: латиница, цифры, - и _', true);
        return;
    }

    if (rawData.groups.some(group => group.id === id)) {
        updateFileStatus('Группа с таким ID уже существует', true);
        return;
    }

    rawData.groups.push({id, content});
    rawData.groups.sort((a, b) => a.content.localeCompare(b.content, 'ru'));
    activeGroups.add(id);

    idInput.value = '';
    contentInput.value = '';

    finalizeDataMutation('Группа добавлена');
}

function deleteGroup(groupId) {
    const group = rawData.groups.find(g => String(g.id) === String(groupId));
    const name = group ? group.content : groupId;

    if (!window.confirm(`Удалить группу "${name}"?`)) {
        return;
    }

    const usedInItems = rawData.items.some(item => String(item.group) === String(groupId));

    if (usedInItems) {
        updateFileStatus('Нельзя удалить группу: в ней есть события', true);
        return;
    }

    rawData.groups = rawData.groups.filter(group => String(group.id) !== String(groupId));
    activeGroups.delete(groupId);
    finalizeDataMutation('Группа удалена');
}

function addTag() {
    const newTagInput = document.getElementById('newTagInput');
    const tag = newTagInput.value.trim();

    if (!tag) {
        updateFileStatus('Введите тег', true);
        return;
    }

    if (rawData.tags.includes(tag)) {
        updateFileStatus('Такой тег уже есть', true);
        return;
    }

    rawData.tags.push(tag);
    rawData.tags.sort((a, b) => a.localeCompare(b, 'ru'));

    newTagInput.value = '';
    finalizeDataMutation('Тег добавлен');
}

function deleteTag(tag) {
    rawData.tags = rawData.tags.filter(x => x !== tag);
    rawData.items.forEach(item => {
        item.tags = (item.tags || []).filter(x => x !== tag);
    });

    activeTags.delete(tag);
    finalizeDataMutation('Тег удален');
}

function syncTagCatalogFromItems() {
    const next = new Set(rawData.tags);
    rawData.items.forEach(item => {
        (item.tags || []).forEach(tag => next.add(tag));
    });
    rawData.tags = [...next].sort((a, b) => a.localeCompare(b, 'ru'));
}

function finalizeDataMutation(message) {
    renderTagsFilter();
    renderGroupFilters();
    applyFilter();

    if (selectedItemId && findItemById(selectedItemId)) {
        showDetails(selectedItemId);
    }

    if (saveToStorage(rawData)) {
        updateFileStatus(`${message}. Данные сохранены в localStorage.`);
    } else {
        updateFileStatus(`${message}. Ошибка записи в localStorage.`, true);
    }
}

function bindFileActions() {
    const openBtn = document.getElementById('openFileBtn');
    const saveBtn = document.getElementById('saveFileBtn');
    const saveAsBtn = document.getElementById('saveAsFileBtn');
    const exportStorageBtn = document.getElementById('exportStorageBtn');
    const importStorageBtn = document.getElementById('importStorageBtn');
    const importTextBtn = document.getElementById('importTextBtn');
    const resetStorageBtn = document.getElementById('resetStorageBtn');

    exportStorageBtn.addEventListener('click', exportStorageToFile);
    importStorageBtn.addEventListener('click', () => stateFileInputEl.click());
    stateFileInputEl.addEventListener('change', importStorageFromFile);
    importTextBtn.addEventListener('click', () => {
        importTextInputEl.value = '';
        importDialogEl.showModal();
    });

    resetStorageBtn.addEventListener('click', async () => {
        if (!window.confirm('Очистить localStorage и загрузить исходный data.json?')) {
            return;
        }

        clearStorage();
        fileHandle = null;
        await loadDefaultData();
    });

    if (!fileApiSupported) {
        openBtn.disabled = true;
        saveBtn.disabled = true;
        saveAsBtn.disabled = true;
        return;
    }

    openBtn.addEventListener('click', openDataFile);
    saveBtn.addEventListener('click', () => saveDataFile(false));
    saveAsBtn.addEventListener('click', () => saveDataFile(true));
}

async function openDataFile() {
    try {
        const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{
                description: 'JSON файл',
                accept: {
                    'application/json': ['.json']
                }
            }]
        });

        if (!handle) {
            return;
        }

        const file = await handle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text);

        setData(parsed);
        fileHandle = handle;
        saveToStorage(rawData);
        updateFileStatus(`Файл открыт: ${file.name}. Данные также в localStorage.`);
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }

        updateFileStatus(`Ошибка открытия файла: ${error.message}`, true);
    }
}

async function saveDataFile(saveAs) {
    try {
        if (!rawData) {
            updateFileStatus('Нет данных для сохранения', true);
            return;
        }

        if (saveAs || !fileHandle) {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'data.json',
                types: [{
                    description: 'JSON файл',
                    accept: {
                        'application/json': ['.json']
                    }
                }]
            });
        }

        if (!fileHandle) {
            return;
        }

        const writable = await fileHandle.createWritable();
        await writable.write(`${JSON.stringify(rawData, null, 2)}\n`);
        await writable.close();

        updateFileStatus('Файл успешно сохранен');
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }

        updateFileStatus(`Ошибка сохранения файла: ${error.message}`, true);
    }
}

function exportStorageToFile() {
    const snapshot = loadFromStorage() || rawData;
    if (!snapshot) {
        updateFileStatus('Нет данных для экспорта', true);
        return;
    }

    const payload = {
        format: 'history-timeline-storage',
        version: 1,
        exportedAt: new Date().toISOString(),
        storageKey: STORAGE_KEY,
        data: snapshot
    };

    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
        type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `history-timeline-storage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    updateFileStatus('Состояние localStorage экспортировано в файл');
}

async function importStorageFromFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const nextState = parsed && parsed.data && parsed.format
            ? parsed.data
            : parsed;

        setData(nextState);
        saveToStorage(rawData);
        updateFileStatus(`Состояние загружено из файла: ${file.name}`);
    } catch (error) {
        updateFileStatus(`Ошибка импорта состояния: ${error.message}`, true);
    }
}

function applyImportFromText(event) {
    event.preventDefault();

    if (!rawData) {
        updateFileStatus('Сначала загрузите данные', true);
        return;
    }

    const sourceText = importTextInputEl.value.trim();
    if (!sourceText) {
        updateFileStatus('Вставьте JSON для импорта', true);
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(sourceText);
    } catch (error) {
        updateFileStatus(`Ошибка JSON: ${error.message}`, true);
        return;
    }

    const incoming = extractImportedItems(parsed);
    if (!incoming.length) {
        updateFileStatus('Не найдено событий для импорта', true);
        return;
    }

    let added = 0;
    let updated = 0;
    const touchedGroups = new Set();

    incoming.forEach(entry => {
        const normalized = normalizeImportedItem(entry);
        if (!normalized) {
            return;
        }

        if (!rawData.groups.some(group => group.id === normalized.group)) {
            rawData.groups.push({
                id: normalized.group,
                content: normalized.group
            });
            activeGroups.add(normalized.group);
            touchedGroups.add(normalized.group);
        }

        const index = rawData.items.findIndex(item => String(item.id) === String(normalized.id));
        if (index >= 0) {
            rawData.items[index] = normalized;
            updated += 1;
        } else {
            rawData.items.push(normalized);
            added += 1;
        }

        selectedItemId = normalized.id;
    });

    if (!added && !updated) {
        updateFileStatus('Импорт не выполнился: проверьте обязательные поля id/start', true);
        return;
    }

    if (touchedGroups.size) {
        rawData.groups.sort((a, b) => a.content.localeCompare(b.content, 'ru'));
    }

    syncTagCatalogFromItems();
    finalizeDataMutation(`Импорт завершен: добавлено ${added}, обновлено ${updated}`);

    if (selectedItemId) {
        timeline.setSelection([selectedItemId]);
        showDetails(selectedItemId);
        updateSelectionGuideLines();
    }

    importDialogEl.close();
}

function extractImportedItems(parsed) {
    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        return parsed.items;
    }

    if (parsed && typeof parsed === 'object') {
        return [parsed];
    }

    return [];
}

function normalizeImportedItem(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const id = String(item.id || '').trim();
    const content = String(item.content || id || '').trim();
    const start = normalizeFlexibleDate(item.start);
    const group = String(item.group || rawData.groups[0]?.id || '').trim();
    const type = item.type === 'range' ? 'range' : 'point';

    if (!id || !content || !start || !group) {
        return null;
    }

    const normalized = {
        id,
        content,
        group,
        type,
        start,
        description: String(item.description || '').trim(),
        tags: Array.isArray(item.tags)
            ? item.tags.map(tag => String(tag).trim()).filter(Boolean)
            : [],
        related: Array.isArray(item.related)
            ? item.related.map(rel => String(rel).trim()).filter(Boolean)
            : []
    };

    if (item.end) {
        const end = normalizeFlexibleDate(item.end);
        if (!end) {
            return null;
        }
        normalized.end = end;
    }

    if (normalized.type === 'range' && !normalized.end) {
        return null;
    }

    if (normalized.type === 'range' && compareDateStrings(normalized.start, normalized.end) > 0) {
        return null;
    }

    return normalized;
}

function updateFileStatus(message, isError = false) {
    fileStatusEl.classList.toggle('hidden', false);
    fileStatusEl.textContent = message;
    fileStatusEl.classList.toggle('error', isError);
    setTimeout(() => {
        fileStatusEl.classList.toggle('hidden', true);
    }, 2000)
}

function findItemById(id) {
    return rawData.items.find(item => String(item.id) === String(id));
}

function getMultipleSelectValues(selectEl) {
    return [...selectEl.selectedOptions].map(option => option.value);
}

function setMultipleSelect(selectEl, values) {
    const selected = new Set(values);
    [...selectEl.options].forEach(option => {
        option.selected = selected.has(option.value);
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatDateRange(item) {
    const startLabel = formatDateValue(item.start);
    const endLabel = formatDateValue(item.end);

    if (startLabel && endLabel) {
        const dur = computeDurationString(item);
        return dur ? `${startLabel} - ${endLabel} (${dur})` : `${startLabel} - ${endLabel}`;
    }

    return startLabel || 'дата не указана';
}

function computeDurationString(item) {
    if (!item || !item.start || !item.end) return '';

    const startDate = toVisDate(item.start, false);
    const endDate = toVisDate(item.end, true);

    if (!(startDate instanceof Date) || !(endDate instanceof Date)) return '';
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return '';

    // compute months difference (approx, based on calendar months)
    const y1 = startDate.getUTCFullYear();
    const m1 = startDate.getUTCMonth();
    const d1 = startDate.getUTCDate();
    const y2 = endDate.getUTCFullYear();
    const m2 = endDate.getUTCMonth();
    const d2 = endDate.getUTCDate();

    let months = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) months -= 1;
    if (months < 0) months = 0;

    const years = Math.floor(months / 12);
    const remMonths = months % 12;

    if (years >= 1) {
        return `${years} ${pluralizeYear(years)}`;
    }

    // if less than one year, show months (if 0 months, show <1 month as "менее месяца")
    if (months <= 0) {
        return 'менее месяца';
    }

    return `${months} ${pluralizeMonth(months)}`;
}

function pluralizeYear(n, short = false) {
    n = Math.abs(n) % 100;
    const n1 = n % 10;
    let result = 'лет';
    if (n > 10 && n < 20) result = 'лет';
    if (n1 > 1 && n1 < 5) result = 'года';
    if (n1 === 1) result = 'год';
    return (short ? result.slice(0, 1) : result);
}

function pluralizeMonth(n, short = false) {
    if (short) return 'м';

    n = Math.abs(n) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return 'месяцев';
    if (n1 > 1 && n1 < 5) return 'месяца';
    if (n1 === 1) return 'месяц';
    return 'месяцев';
}

function createUtcDateWithYear(year, monthIndex, day) {
    // Date.UTC(0..99, ...) maps to 1900..1999, so force real astronomical year explicitly.
    const dt = new Date(Date.UTC(0, monthIndex, day));
    dt.setUTCFullYear(year);
    return dt;
}

function formatDateValue(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    const match = raw.match(/^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!match) {
        return raw;
    }

    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;

    if (!month) {
        return `${year} г.`;
    }

    const monthName = new Intl.DateTimeFormat('ru-RU', {month: 'long'})
        .format(createUtcDateWithYear(year, month - 1, 1));

    if (!day) {
        return `${monthName} ${year} г.`;
    }

    const dayMonth = new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC'
    }).format(createUtcDateWithYear(year, month - 1, day));

    return `${dayMonth} ${year} г.`;
}

function normalizeFlexibleDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);

    if (!match) {
        return '';
    }

    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;

    if (day && !month) {
        return '';
    }

    if (month && (month < 1 || month > 12)) {
        return '';
    }

    if (day && (day < 1 || day > 31)) {
        return '';
    }

    if (day && month) {
        const dt = createUtcDateWithYear(year, month - 1, day);
        if (
            dt.getUTCFullYear() !== year ||
            dt.getUTCMonth() !== month - 1 ||
            dt.getUTCDate() !== day
        ) {
            return '';
        }
    }

    if (!month) {
        return `${year}`;
    }

    const mm = String(month).padStart(2, '0');
    if (!day) {
        return `${year}-${mm}`;
    }

    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

function compareDateStrings(a, b) {
    const parse = (value) => {
        const normalized = normalizeFlexibleDate(value);
        if (!normalized) {
            return Number.NaN;
        }
        const date = toVisDate(normalized, false);
        if (!(date instanceof Date)) return Number.NaN;
        return date.getTime();
    };

    const aTs = parse(a);
    const bTs = parse(b);
    if (Number.isNaN(aTs) || Number.isNaN(bTs)) {
        return 0;
    }

    if (aTs === bTs) {
        return 0;
    }

    return aTs > bTs ? 1 : -1;
}

function buildTimelineItems(items) {
    const timelineItems = items.map(toTimelineItem);
    const centuryBackgrounds = createCenturyBackgroundItems(items);
    return [...centuryBackgrounds, ...timelineItems];
}

function createCenturyBackgroundItems(items) {
    if (!items.length) {
        return [];
    }

    const years = items
        .flatMap(item => [getYearFromDateString(item.start), getYearFromDateString(item.end)])
        .filter(year => Number.isFinite(year));

    if (!years.length) {
        return [];
    }

    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const startCentury = Math.floor(minYear / 100) * 100;
    const endCentury = Math.floor(maxYear / 100) * 100;

    const result = [];
    let stripeIndex = 0;

    for (let year = startCentury; year <= endCentury; year += 100) {
        result.push({
            id: `bg-century-${year}`,
            type: 'background',
            start: createUtcDateWithYear(year, 0, 1),
            end: createUtcDateWithYear(year + 100, 0, 1),
            className: stripeIndex % 2 === 0 ? 'century-even' : 'century-odd',
            selectable: false
        });
        stripeIndex += 1;
    }

    return result;
}

function getYearFromDateString(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,4})/);
    return match ? Number(match[1]) : Number.NaN;
}

function bindTimelineHoverGuide() {
    if (!timelineWrapEl || !timeline) {
        return;
    }

    // create hover-specific selection guide lines once
    try {
        if (!hoverSelectionStartEl) {
            hoverSelectionStartEl = document.createElement('div');
            hoverSelectionStartEl.className = 'timeline-line selection-line hover-selection';
            hoverSelectionStartEl.style.opacity = '0';
            timelineWrapEl.appendChild(hoverSelectionStartEl);
        }
        if (!hoverSelectionEndEl) {
            hoverSelectionEndEl = document.createElement('div');
            hoverSelectionEndEl.className = 'timeline-line selection-line hover-selection';
            hoverSelectionEndEl.style.opacity = '0';
            timelineWrapEl.appendChild(hoverSelectionEndEl);
        }
    } catch (e) {
        // ignore DOM append errors
    }

    timelineWrapEl.onmousemove = (event) => {
        const wrapRect = timelineWrapEl.getBoundingClientRect();
        const x = event.clientX - wrapRect.left;
        const geometry = getTimelineXGeometry();

        if (x < geometry.left || x > geometry.left + geometry.width) {
            hideHoverGuide();
            return;
        }

        const time = xToTimelineTime(x - geometry.left, geometry.width);
        if (!time || Number.isNaN(time.getTime())) {
            hideHoverGuide();
            return;
        }

        hoverLineEl.style.left = `${x}px`;
        hoverLineEl.style.opacity = '0.5';

        hoverDateEl.textContent = formatDateFromDate(time);
        try {
            hoverDateEl.style.left = `${Math.round(wrapRect.left + x)}px`;
            clampLabelToViewport(hoverDateEl);
        } catch (e) {
            hoverDateEl.style.left = `${x}px`;
        }
        hoverDateEl.style.top = `${getTimelineViewportTop(8)}px`;
        hoverDateEl.style.opacity = '0.8';

        // update horizontal interval visualization when there's a selected item
        updateHoverInterval(event, time, geometry);
    };

    timelineWrapEl.onmouseleave = () => {
        hideHoverGuide();
        hideIntervalVisualization();
    };
}

function hideHoverGuide() {
    hoverLineEl.style.opacity = '0';
    hoverDateEl.style.opacity = '0';
}

function hideIntervalVisualization() {
    if (intervalLineEl) intervalLineEl.style.opacity = '0';
    if (intervalLabelEl) intervalLabelEl.style.opacity = '0';
    if (intervalArrowLeftEl) intervalArrowLeftEl.style.opacity = '0';
    if (intervalArrowRightEl) intervalArrowRightEl.style.opacity = '0';
    if (hoverSelectionStartEl) hoverSelectionStartEl.style.opacity = '0';
    if (hoverSelectionEndEl) hoverSelectionEndEl.style.opacity = '0';
}

function formatIntervalFromDates(aDate, bDate, short = false) {
    if (!(aDate instanceof Date) || !(bDate instanceof Date)) return '';
    let start = aDate.getTime();
    let end = bDate.getTime();
    if (end < start) {
        const t = start;
        start = end;
        end = t;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // compute months difference similar to computeDurationString
    const y1 = startDate.getUTCFullYear();
    const m1 = startDate.getUTCMonth();
    const d1 = startDate.getUTCDate();
    const y2 = endDate.getUTCFullYear();
    const m2 = endDate.getUTCMonth();
    const d2 = endDate.getUTCDate();

    let months = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) months -= 1;
    if (months < 0) months = 0;

    const years = Math.floor(months / 12);
    const remMonths = months % 12;

    if (years >= 1) {
        return `${years} ${pluralizeYear(years, short)}${remMonths ? ' ' + remMonths + ' ' + pluralizeMonth(remMonths, short) : ''}`;
    }
    if (months <= 0) return (short ? '<м' : 'менее месяца');
    return `${months} ${pluralizeMonth(months, short)}`;
}

function updateHoverInterval(event, cursorTime, geometry) {
    try {
        if (!timeline || !geometry) {
            hideIntervalVisualization();
            return;
        }

        // find element under cursor; prefer timeline-provided hoveredItemId when available
        // Strategy:
        // 1) if hoveredItemId set by timeline.itemover — use it (try to find DOM node by data-item-id)
        // 2) otherwise fall back to elementFromPoint and bbox scanning
        let hoveredEl = null;
        let hoveredId = null;

        // 1) timeline-provided hoveredItemId
        if (hoveredItemId) {
            try {
                hoveredId = String(hoveredItemId);
                // try to find a node with our injected data-item-id attribute
                const selector = `[data-item-id="${String(hoveredId).replace(/"/g, '\\"')}"]`;
                hoveredEl = timelineWrapEl.querySelector(selector) || document.querySelector(selector);
                // fallback to the actual vis item wrapper
                if (!hoveredEl) {
                    const visSelector = `.vis-item[data-id="${String(hoveredId).replace(/"/g, '\\"')}"]`;
                    hoveredEl = timelineWrapEl.querySelector(visSelector) || document.querySelector(visSelector);
                }
                // last fallback: element under cursor
                if (!hoveredEl && event && event.target && typeof event.target.closest === 'function') {
                    hoveredEl = event.target.closest('.vis-item');
                }
            } catch (e) {
                hoveredEl = null;
            }
        }

        // 2) fallback: elementFromPoint / bbox scan
        if (!hoveredId) {
            hideIntervalVisualization();
            return;
        }

        if (String(hoveredId) === String(selectedItemId)) {
            hideIntervalVisualization();
            return;
        }

        const hov = findItemById(hoveredId);
        if (!hov) {
            hideIntervalVisualization();
            return;
        }

        const hStart = toVisDate(hov.start, false);
        const hEnd = hov.end ? toVisDate(hov.end, true) : hStart;
        if (!(hStart instanceof Date)) {
            hideIntervalVisualization();
            return;
        }

        // determine hovered boundary depending on cursor position within hovered element
        let chosenHTime = hStart;
        if (hoveredEl) {
            const rect = hoveredEl.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            if (event.clientX >= centerX) {
                chosenHTime = hEnd || hStart;
            } else {
                chosenHTime = hStart;
            }
        } else {
            // fallback: choose closest boundary to cursorTime
            const cursorTs = cursorTime.getTime();
            const d1 = Math.abs(cursorTs - hStart.getTime());
            const d2 = Math.abs(cursorTs - (hEnd ? hEnd.getTime() : hStart.getTime()));
            chosenHTime = d1 <= d2 ? hStart : (hEnd || hStart);
        }

        // need selected item to draw interval between selected and hovered
        const sel = findItemById(selectedItemId);
        if (!sel) {
            // nothing else to show (hover lines are already visible)
            return;
        }

        const sStart = toVisDate(sel.start, false);
        const sEnd = sel.end ? toVisDate(sel.end, true) : sStart;
        if (!(sStart instanceof Date) || !(sEnd instanceof Date)) {
            hideIntervalVisualization();
            return;
        }

        // for selected item choose closest boundary to chosenHTime
        const chTs = chosenHTime.getTime();
        const sd = Math.abs(chTs - sStart.getTime());
        const ed = Math.abs(chTs - sEnd.getTime());
        const chosenSTime = sd <= ed ? sStart : sEnd;

        // compute coordinates between selected boundary and hovered boundary
        const x1 = timelineTimeToX(chosenSTime, geometry);
        const x2 = timelineTimeToX(chosenHTime, geometry);
        if (x1 === null || x2 === null) {
            hideIntervalVisualization();
            return;
        }

        const left = Math.min(x1, x2) + 1;
        const width = Math.max(2, Math.abs(x2 - x1));

        // position relative to hovered element: compute center and line position (slightly below center)
        let lineTop = 44; // final top for the horizontal interval line
        try {
            const wrapRect = timelineWrapEl.getBoundingClientRect();
            if (hoveredEl) {
                const r = hoveredEl.getBoundingClientRect();
                // center of the item
                const center = r.top + r.height / 2 - wrapRect.top;
                // put the horizontal measuring line lower: near the bottom of hover-date badge level
                const below = Math.max(8, Math.round(r.height * 0.45));
                lineTop = Math.max(6, Math.min(wrapRect.height - 6, Math.round(center + below)));
            } else {
                // fallback to selected element center
                const selEl = timelineWrapEl.querySelector(`.vis-item[data-id="${selectedItemId}"]`) || document.querySelector(`.vis-item[data-id="${selectedItemId}"]`);
                if (selEl) {
                    const r = selEl.getBoundingClientRect();
                    const center = r.top + r.height / 2 - wrapRect.top;
                    const below = Math.max(8, Math.round(r.height * 0.45));
                    lineTop = Math.max(6, Math.min(wrapRect.height - 6, Math.round(center + below)));
                }
            }
        } catch (e) {
            // ignore
        }

        if (intervalLineEl) {
            intervalLineEl.style.left = `${left}px`;
            intervalLineEl.style.width = `${width}px`;
            intervalLineEl.style.top = `${lineTop}px`;
            intervalLineEl.style.opacity = '1';
        }

        if (intervalLabelEl) {
            const mid = left + width / 2;
            intervalLabelEl.style.left = `${mid}px`;
            intervalLabelEl.textContent = formatIntervalFromDates(chosenSTime, chosenHTime, true);
            // show interval value just above the line, matching mouse-move label badge style
            intervalLabelEl.style.top = `${Math.max(2, lineTop + 5)}px`;
            intervalLabelEl.style.opacity = '1';
        }

        // arrows: place thin vertical markers exactly at the interval edges (inside interval)
        try {
            const containerLeft = geometry.left || 0;
            const containerRight = geometry.left + geometry.width;
            const ay = lineTop - 6; // vertical center for 12px high marker

            if (intervalArrowLeftEl) {
                // put marker at the left boundary (clamped to container)
                const leftX = Math.max(containerLeft, left);
                intervalArrowLeftEl.style.left = `${leftX}px`;
                intervalArrowLeftEl.style.top = `${ay}px`;
                intervalArrowLeftEl.style.opacity = '1';
            }
            if (intervalArrowRightEl) {
                // put marker at the right boundary (clamped to container)
                const rightX = Math.min(containerRight, left + width);
                intervalArrowRightEl.style.left = `${rightX}px`;
                intervalArrowRightEl.style.top = `${ay}px`;
                intervalArrowRightEl.style.opacity = '1';
            }
        } catch (e) {
            // ignore positioning errors
        }

        // show hover-selection vertical lines at hovered item's boundaries
        try {
            const hoverXStart = timelineTimeToX(hStart, geometry);
            const hoverXEnd = timelineTimeToX(hEnd || hStart, geometry);
            if (hoverSelectionStartEl && hoverXStart !== null) {
                hoverSelectionStartEl.style.left = `${hoverXStart}px`;
                hoverSelectionStartEl.style.opacity = '0.5';
            }
            if (hoverSelectionEndEl && hoverXEnd !== null) {
                hoverSelectionEndEl.style.left = `${hoverXEnd}px`;
                hoverSelectionEndEl.style.opacity = '0.5';
            }
            if (hoverDateEl) {
                const mid = ((hoverXStart || hoverXEnd) + (hoverXEnd || hoverXStart)) / 2;
                try {
                    const wrapRect = timelineWrapEl.getBoundingClientRect();
                    if (!Number.isNaN(mid)) hoverDateEl.style.left = `${Math.round(wrapRect.left + mid)}px`;
                    clampLabelToViewport(hoverDateEl);
                } catch (e) {
                    if (!Number.isNaN(mid)) hoverDateEl.style.left = `${mid}px`;
                }
                // top will be set later (we place fixed at viewport top)
                hoverDateEl.style.top = `${getTimelineViewportTop(8)}px`;
                hoverDateEl.style.opacity = '0.8';
            }
        } catch (e) {
            // ignore
        }

        // position hover date label above hovered item (near topOffset)
        try {
            if (hoverDateEl) {
                try {
                    const wrapRect = timelineWrapEl.getBoundingClientRect();
                    hoverDateEl.style.left = `${Math.round(wrapRect.left + (x1 + x2) / 2)}px`;
                    clampLabelToViewport(hoverDateEl);
                } catch (e) {
                    hoverDateEl.style.left = `${(x1 + x2) / 2}px`;
                }
                // fixed to viewport top inside the visible timeline area
                hoverDateEl.style.top = `${getTimelineViewportTop(8)}px`;
                hoverDateEl.style.opacity = '0.8';
            }
        } catch (e) {
            // ignore
        }
    } catch (e) {
        hideIntervalVisualization();
    }
}

function updateSelectionGuideLines() {
    if (!selectedItemId || !timeline) {
        hideSelectionGuideLines();
        return;
    }

    const item = findItemById(selectedItemId);
    if (!item || !activeGroups.has(item.group)) {
        hideSelectionGuideLines();
        return;
    }

    const startDate = toVisDate(item.start, false);
    const endDate = item.end
        ? toVisDate(item.end, true)
        : toVisDate(item.start, false);

    const geometry = getTimelineXGeometry();
    const startX = timelineTimeToX(startDate, geometry);
    const endX = timelineTimeToX(endDate, geometry);

    if (startX === null || endX === null) {
        hideSelectionGuideLines();
        return;
    }

    selectionStartLineEl.style.left = `${startX}px`;
    selectionEndLineEl.style.left = `${endX}px`;
    selectionStartLineEl.style.opacity = '0.5';
    selectionEndLineEl.style.opacity = '0.5';
}

function hideSelectionGuideLines() {
    selectionStartLineEl.style.opacity = '0';
    selectionEndLineEl.style.opacity = '0';
}

function formatDateFromDate(date) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date);
}

function xToTimelineTime(x, width) {
    if (!timeline || width <= 0) {
        return null;
    }

    const windowRange = timeline.getWindow();
    const startMs = windowRange.start.getTime();
    const endMs = windowRange.end.getTime();
    const ratio = Math.max(0, Math.min(1, x / width));

    return new Date(startMs + (endMs - startMs) * ratio);
}

function timelineTimeToX(date, geometry) {
    if (!timeline || !geometry || geometry.width <= 0 || !(date instanceof Date)) {
        return null;
    }

    const windowRange = timeline.getWindow();
    const startMs = windowRange.start.getTime();
    const endMs = windowRange.end.getTime();
    const dateMs = date.getTime();

    if (endMs <= startMs) {
        return null;
    }

    const ratio = (dateMs - startMs) / (endMs - startMs);
    const localX = Math.max(0, Math.min(geometry.width, ratio * geometry.width));
    return geometry.left + localX;
}

function getTimelineXGeometry() {
    const wrapRect = timelineWrapEl.getBoundingClientRect();
    const centerPanel = timelineWrapEl.querySelector('.vis-panel.vis-center');

    if (!centerPanel) {
        return {
            left: 0,
            width: wrapRect.width
        };
    }

    const centerRect = centerPanel.getBoundingClientRect();
    return {
        left: centerRect.left - wrapRect.left,
        width: centerRect.width
    };
}

function toTimelineItem(item) {
    const dateLabel = formatDateRange(item);
    const safeContent = String(item.content || item.id || 'Без названия');
    const titleText = `${safeContent}\n${dateLabel}`;
    const marker = item.type === 'range' ? '' : '<span class="item-marker" aria-hidden="true"></span>';
    const className = [
        String(item.className || '').trim(),
        isItemHighlighted(item) ? 'highlighted-item' : ''
    ].filter(Boolean).join(' ');

    return {
        ...item,
        start: toVisDate(item.start, false),
        end: item.end ? toVisDate(item.end, true) : undefined,
        className: className || undefined,
        // include data-item-id on the inner wrapper so we can reliably find the DOM node later
        content: `<div class="item-label" data-item-id="${escapeHtml(String(item.id))}"><div class="item-title-row">${marker}<div class="item-title">${escapeHtml(safeContent)}</div></div><div class="item-date">${escapeHtml(dateLabel)}</div></div>`,
        title: ''//titleText
    };
}

function toVisDate(value, isEnd) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/);

    if (!match) {
        return raw;
    }

    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;

    if (!month) {
        return isEnd
            ? createUtcDateWithYear(year, 11, 31)
            : createUtcDateWithYear(year, 0, 1);
    }

    if (!day) {
        const lastDay = createUtcDateWithYear(year, month, 0).getUTCDate();
        return isEnd
            ? createUtcDateWithYear(year, month - 1, lastDay)
            : createUtcDateWithYear(year, month - 1, 1);
    }

    return createUtcDateWithYear(year, month - 1, day);
}

async function getSmartWikipediaUrl(content) {
    const query = content.trim();
    const apiUrl = `https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json&origin=*`;
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        // data[3] — это массив со ссылками на найденные статьи
        if (data[3] && data[3].length > 0) {
            return data[3][0]; // Возвращаем прямую ссылку на первую точную статью
        }
    } catch (error) {
        console.error("Ошибка API Википедии, переключаемся на обычный поиск", error);
    }

    // Если точной статьи нет или API упал — отдаем ссылку на страницу поиска
    return `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}
