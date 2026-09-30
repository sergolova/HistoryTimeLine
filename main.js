document.addEventListener('DOMContentLoaded', () => {
    const storageService = new StorageService();
    const wikiService = new WikipediaService(storageService);
    const dataManager = new DataManager();

    const timelineWrapEl = document.getElementById('timelineWrap');
    const containerEl = document.getElementById('timeline');

    const timelineComponent = new TimelineComponent(containerEl, timelineWrapEl, {
        onSelect: (id) => {
            if (id && !id.startsWith('bg-century-')) {
                dataManager.selectedItemId = id;
                uiController.showDetails(id);
                timelineComponent.updateSelectionGuideLines(dataManager);
            }
        },
        onDoubleClick: (id) => {
            if (id && !id.startsWith('bg-century-')) {
                dataManager.selectedItemId = id;
                uiController.openItemDialog('edit');
            }
        },
        onGroupToggle: (groupId) => {
            dataManager.activeGroups.delete(groupId);
            uiController.applyFilter();
        }
    });

    const uiController = new UIController(dataManager, timelineComponent, storageService, wikiService);
    uiController.init();

    // Переключение выпадающего меню
    const dataDropdown = document.getElementById('dataDropdown');
    const dataMenuBtn = document.getElementById('dataMenuBtn');
    if (dataMenuBtn && dataDropdown) {
        dataMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dataDropdown.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!dataDropdown.contains(e.target)) {
                dataDropdown.classList.remove('open');
            }
        });
    }
});