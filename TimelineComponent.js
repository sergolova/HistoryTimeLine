class TimelineComponent {
    constructor(containerEl, timelineWrapEl, options = {}) {
        this.containerEl = containerEl;
        this.timelineWrapEl = timelineWrapEl;
        this.timeline = null;
        this.hoveredItemId = null;
        this.callbacks = options; // onSelect, onDoubleClick, onGroupToggle

        this.ACTUAL_DATE_START = 1700;
        this.ACTUAL_DATE_END = 2050;

        this.initGuideElements();
    }

    initGuideElements() {
        this.hoverLineEl = document.getElementById('hoverLine');
        this.hoverDateEl = document.getElementById('hoverDate');
        this.selectionStartLineEl = document.getElementById('selectionStartLine');
        this.selectionEndLineEl = document.getElementById('selectionEndLine');
        this.intervalLineEl = document.getElementById('intervalLine');
        this.intervalLabelEl = document.getElementById('intervalLabel');
        this.intervalArrowLeftEl = document.getElementById('intervalArrowLeft');
        this.intervalArrowRightEl = document.getElementById('intervalArrowRight');

        this.hoverSelectionStartEl = document.createElement('div');
        this.hoverSelectionStartEl.className = 'timeline-line selection-line hover-selection';
        this.hoverSelectionStartEl.style.opacity = '0';
        this.timelineWrapEl.appendChild(this.hoverSelectionStartEl);

        this.hoverSelectionEndEl = document.createElement('div');
        this.hoverSelectionEndEl.className = 'timeline-line selection-line hover-selection';
        this.hoverSelectionEndEl.style.opacity = '0';
        this.timelineWrapEl.appendChild(this.hoverSelectionEndEl);
    }

    patchVisTimelineFocus() {
        if (window.vis && vis.Timeline && !vis.Timeline.prototype._safeFocusPatched) {
            const _origFocus = vis.Timeline.prototype.focus;
            vis.Timeline.prototype.focus = function (id, options) {
                try {
                    _origFocus.call(this, id, options);
                } catch (err) {
                    if (!(err instanceof TypeError) || !err.message?.includes('valueOf')) throw err;
                    if (!this.itemsData || id == undefined) return;
                    const ids = Array.isArray(id) ? id : [id];
                    const itemsData = this.itemsData.get(ids);

                    let start = null, end = null;
                    itemsData.forEach(itemData => {
                        if (!itemData || itemData.start == undefined) return;
                        const sDate = itemData.start instanceof Date ? itemData.start : DateUtils.toVisDate(itemData.start, false);
                        const eDate = itemData.end != undefined ? (itemData.end instanceof Date ? itemData.end : DateUtils.toVisDate(itemData.end, true)) : sDate;
                        if (!(sDate instanceof Date) || !(eDate instanceof Date)) return;
                        if (start === null || sDate.valueOf() < start) start = sDate.valueOf();
                        if (end === null || eDate.valueOf() > end) end = eDate.valueOf();
                    });

                    if (start !== null && end !== null) {
                        const zoom = options?.zoom ?? true;
                        let interval = zoom ? (end - start) * 1.1 : Math.max(this.range.end - this.range.start, (end - start) * 1.1);
                        if (!Number.isFinite(interval) || interval <= 0) interval = 1000 * 60 * 60 * 24 * 7;
                        const middle = (start + end) / 2;
                        this.range.stopRolling();
                        this.range.setRange(new Date(middle - interval / 2), new Date(middle + interval / 2), { animation: options?.animation ?? true });
                    }
                }
            };
            vis.Timeline.prototype._safeFocusPatched = true;
        }
    }

    saveTimelineState() {
        if (!this.timeline) return null;
        try {
            const window = this.timeline.getWindow();
            const scrollTop = this.timeline.getScrollTop ? this.timeline.getScrollTop() : 0;
            return { start: window.start, end: window.end, scrollTop };
        } catch (e) {
            return null;
        }
    }

    restoreTimelineState(state) {
        if (!this.timeline || !state) return;
        try {
            this.timeline.setWindow(state.start, state.end, { animation: false });
            if (this.timeline.setScrollTop) {
                this.timeline.setScrollTop(state.scrollTop);
            }
        } catch (e) {
            // ignore restore errors
        }
    }

    render(dataManager) {
        this.patchVisTimelineFocus();

        if (!dataManager.rawData || !dataManager.rawData.groups) return;

        const filtered = dataManager.getFilteredItems() || [];
        const visibleGroups = dataManager.rawData.groups.filter(g => dataManager.activeGroups.has(g.id));

        const timelineItems = filtered.map(item => this.toTimelineItem(item, dataManager));
        const centuryBg = this.createCenturyBackgroundItems(filtered);

        // Если таймлайн уже существует — обновляем только данные, сохраняя состояние
        if (this.timeline) {
            const state = this.saveTimelineState();
            this.timeline.setItems(new vis.DataSet([...centuryBg, ...timelineItems]));
            this.timeline.setGroups(new vis.DataSet(visibleGroups));
            this.restoreTimelineState(state);
            return;
        }

        // Первое создание таймлайна
        if (this.timeline) {
            try {
                this.timeline.destroy();
            } catch (e) {
                // vis-timeline может бросать ошибку при destroy — игнорируем
            }
            this.timeline = null;
        }
        this.containerEl.innerHTML = '';

        this.timeline = new vis.Timeline(
            this.containerEl,
            new vis.DataSet([...centuryBg, ...timelineItems]),
            new vis.DataSet(visibleGroups),
            {
                zoomKey: 'ctrlKey',
                selectable: true,
                verticalScroll: true,
                stack: true,
                stackSubgroups: true,
                order: (a, b) => (a.start - b.start) || ((b.end || b.start) - (a.end || a.start)),
                margin: { item: { horizontal: 1, vertical: 1 }, axis: 2 },
                orientation: { axis: 'both', item: 'bottom' },
                min: new Date(-100, 0, 1),
                max: new Date(2100, 0, 1),
                start: new Date(this.ACTUAL_DATE_START, 0, 1),
                end: new Date(this.ACTUAL_DATE_END, 0, 1),
                maxHeight: '800px',
                zoomMin: 10 * 1000 * 60 * 60 * 24 * 30,
                locale: 'ru',
                format: {
                    minorLabels: {
                        month: 'MMM',
                        year: 'YYYY г.'
                    },
                    majorLabels: {
                        month: 'YYYY г.',
                        year: ''
                    }
                },
                groupTemplate: (group, element, data) => {
                    if (!group) {
                        return element;
                    }

                    const container = document.createElement("div");

                    const label = document.createElement("span");
                    label.innerHTML = (group.content || '') + " ";
                    container.appendChild(label);

                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = true;
                    cb.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (!cb.checked && this.callbacks.onGroupToggle) {
                            this.callbacks.onGroupToggle(group.id);
                        }
                    });
                    container.appendChild(cb);

                    return container;
                }
            }
        );

        this.bindEvents(dataManager);
    }

    bindEvents(dataManager) {
        this.timeline.on('itemover', props => { this.hoveredItemId = props?.item ? String(props.item) : null; });
        this.timeline.on('itemout', () => { this.hoveredItemId = null; this.hideIntervalVisualization(); });

        this.timeline.on('select', props => {
            if (this.callbacks.onSelect) this.callbacks.onSelect(props.items[0]);
        });
        this.timeline.on('doubleClick', props => {
            if (props.item && this.callbacks.onDoubleClick) this.callbacks.onDoubleClick(props.item);
        });
        let scrollTimeout = null;
        this.timeline.on('changed', () => {
            this.updateSelectionGuideLines(dataManager);
            if (this.callbacks.onRangeChanged) {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => this.callbacks.onRangeChanged(), 50);
            }
        });

        this.bindHoverGuides(dataManager);
    }

    bindHoverGuides(dataManager) {
        this.timelineWrapEl.onmousemove = (event) => {
            const wrapRect = this.timelineWrapEl.getBoundingClientRect();
            const x = event.clientX - wrapRect.left;
            const geometry = this.getTimelineXGeometry();

            if (x < geometry.left || x > geometry.left + geometry.width) {
                this.hideHoverGuide();
                return;
            }

            const time = this.xToTimelineTime(x - geometry.left, geometry.width);
            if (!time || Number.isNaN(time.getTime())) {
                this.hideHoverGuide();
                return;
            }

            this.hoverLineEl.style.left = `${x}px`;
            this.hoverLineEl.style.opacity = '0.5';
            this.hoverDateEl.textContent = DateUtils.formatDateFromDate(time);
            this.hoverDateEl.style.left = `${Math.round(wrapRect.left + x)}px`;
            this.hoverDateEl.style.opacity = '0.8';

            this.updateHoverInterval(event, time, geometry, dataManager);
        };

        this.timelineWrapEl.onmouseleave = () => {
            this.hideHoverGuide();
            this.hideIntervalVisualization();
        };
    }

    hideHoverGuide() {
        this.hoverLineEl.style.opacity = '0';
        this.hoverDateEl.style.opacity = '0';
    }

    hideIntervalVisualization() {
        if (this.intervalLineEl) this.intervalLineEl.style.opacity = '0';
        if (this.intervalLabelEl) this.intervalLabelEl.style.opacity = '0';
        if (this.intervalArrowLeftEl) this.intervalArrowLeftEl.style.opacity = '0';
        if (this.intervalArrowRightEl) this.intervalArrowRightEl.style.opacity = '0';
        if (this.hoverSelectionStartEl) this.hoverSelectionStartEl.style.opacity = '0';
        if (this.hoverSelectionEndEl) this.hoverSelectionEndEl.style.opacity = '0';
    }

    updateSelectionGuideLines(dataManager) {
        const selectedId = dataManager.selectedItemId;
        if (!selectedId || !this.timeline) {
            this.hideSelectionGuideLines();
            return;
        }

        const item = dataManager.findItemById(selectedId);
        if (!item || !dataManager.activeGroups.has(item.group)) {
            this.hideSelectionGuideLines();
            return;
        }

        const startDate = DateUtils.toVisDate(item.start, false);
        const endDate = item.end ? DateUtils.toVisDate(item.end, true) : startDate;

        const geometry = this.getTimelineXGeometry();
        const startX = this.timelineTimeToX(startDate, geometry);
        const endX = this.timelineTimeToX(endDate, geometry);

        if (startX === null || endX === null) {
            this.hideSelectionGuideLines();
            return;
        }

        this.selectionStartLineEl.style.left = `${startX}px`;
        this.selectionEndLineEl.style.left = `${endX}px`;
        this.selectionStartLineEl.style.opacity = '0.5';
        this.selectionEndLineEl.style.opacity = '0.5';
    }

    hideSelectionGuideLines() {
        if (this.selectionStartLineEl) this.selectionStartLineEl.style.opacity = '0';
        if (this.selectionEndLineEl) this.selectionEndLineEl.style.opacity = '0';
    }

    updateHoverInterval(event, cursorTime, geometry, dataManager) {
        if (!this.timeline || !geometry || !this.hoveredItemId) {
            this.hideIntervalVisualization();
            return;
        }

        if (String(this.hoveredItemId) === String(dataManager.selectedItemId)) {
            this.hideIntervalVisualization();
            return;
        }

        const hov = dataManager.findItemById(this.hoveredItemId);
        const sel = dataManager.findItemById(dataManager.selectedItemId);
        if (!hov || !sel) return;

        const hStart = DateUtils.toVisDate(hov.start, false);
        const hEnd = hov.end ? DateUtils.toVisDate(hov.end, true) : hStart;
        const sStart = DateUtils.toVisDate(sel.start, false);
        const sEnd = sel.end ? DateUtils.toVisDate(sel.end, true) : sStart;

        const x1 = this.timelineTimeToX(sStart, geometry);
        const x2 = this.timelineTimeToX(hStart, geometry);

        if (x1 === null || x2 === null) {
            this.hideIntervalVisualization();
            return;
        }

        const left = Math.min(x1, x2) + 1;
        const width = Math.max(2, Math.abs(x2 - x1));

        this.intervalLineEl.style.left = `${left}px`;
        this.intervalLineEl.style.width = `${width}px`;
        this.intervalLineEl.style.top = `44px`;
        this.intervalLineEl.style.opacity = '1';
    }

    getTimelineXGeometry() {
        const wrapRect = this.timelineWrapEl.getBoundingClientRect();
        const centerPanel = this.timelineWrapEl.querySelector('.vis-panel.vis-center');
        if (!centerPanel) return { left: 0, width: wrapRect.width };
        const centerRect = centerPanel.getBoundingClientRect();
        return { left: centerRect.left - wrapRect.left, width: centerRect.width };
    }

    xToTimelineTime(x, width) {
        if (!this.timeline || width <= 0) return null;
        const range = this.timeline.getWindow();
        return new Date(range.start.getTime() + (range.end.getTime() - range.start.getTime()) * Math.max(0, Math.min(1, x / width)));
    }

    timelineTimeToX(date, geometry) {
        if (!this.timeline || !geometry || geometry.width <= 0 || !(date instanceof Date)) return null;
        const range = this.timeline.getWindow();
        const ratio = (date.getTime() - range.start.getTime()) / (range.end.getTime() - range.start.getTime());
        return geometry.left + Math.max(0, Math.min(geometry.width, ratio * geometry.width));
    }

    toTimelineItem(item, dataManager) {
        const fullDate = item.type === 'point';
        const dateLabel = DateUtils.formatDateRange(item, { yearName: fullDate, dayMonth: fullDate });
        const safeContent = String(item.content || item.id || 'Без названия');
        const marker = item.type === 'range' ? '' : '<span class="item-marker" aria-hidden="true"></span>';
        const className = [`group-${item.group}`, item.className || '', dataManager.isItemHighlighted(item) ? 'highlighted-item' : ''].filter(Boolean).join(' ');

        return {
            ...item,
            start: DateUtils.toVisDate(item.start, false),
            end: item.end ? DateUtils.toVisDate(item.end, true) : undefined,
            className: className || undefined,
            content: `<div class="item-label" data-item-id="${item.id}"><div class="item-title-row">${marker}<div class="item-title">${safeContent}</div></div><div class="item-date">${dateLabel}</div></div>`,
            type: item.type,
            title: ''
        };
    }

    createCenturyBackgroundItems(items) {
        if (!items.length) return [];
        const years = items.flatMap(i => [DateUtils.getYearFromDateString(i.start), DateUtils.getYearFromDateString(i.end)]).filter(y => Number.isFinite(y));
        if (!years.length) return [];

        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);
        const startCentury = Math.floor(minYear / 100) * 100;
        const endCentury = Math.floor(maxYear / 100) * 100;

        const res = [];
        let idx = 0;
        for (let y = startCentury; y <= endCentury; y += 100) {
            res.push({
                id: `bg-century-${y}`,
                type: 'background',
                start: DateUtils.createUtcDateWithYear(y, 0, 1),
                end: DateUtils.createUtcDateWithYear(y + 100, 0, 1),
                className: idx % 2 === 0 ? 'century-even' : 'century-odd',
                selectable: false
            });
            idx++;
        }
        return res;
    }
}