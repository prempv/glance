document.addEventListener('DOMContentLoaded', () => {
    const fileTree = document.getElementById('file-tree');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const scopeFilters = document.getElementById('scope-filters');
    const welcome = document.getElementById('welcome');
    const fileHeader = document.getElementById('file-header');
    const filePath = document.getElementById('file-path');
    const fileSize = document.getElementById('file-size');
    const fileContent = document.getElementById('file-content');
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('resizer');
    const overlay = document.getElementById('sidebar-overlay');

    // --- State persistence helpers ---
    function saveState(key, val) { try { localStorage.setItem('explorer-' + key, JSON.stringify(val)); } catch(e) {} }
    function loadState(key, fallback) { try { const v = localStorage.getItem('explorer-' + key); return v !== null ? JSON.parse(v) : fallback; } catch(e) { return fallback; } }

    let suppressPush = false;

    function buildHash() {
        const params = new URLSearchParams();
        if (currentFile) params.set('file', currentFile);
        if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
        if (activeExtFilter) params.set('ext', activeExtFilter);
        return params.toString();
    }

    function updateURL(push) {
        const hash = buildHash();
        const url = hash ? '#' + hash : location.pathname;
        if (push && !suppressPush) {
            history.pushState(null, '', url);
        } else {
            history.replaceState(null, '', url);
        }
    }

    function readURL() {
        const hash = location.hash.slice(1);
        if (!hash) return {};
        const params = new URLSearchParams(hash);
        return {
            file: params.get('file') || '',
            q: params.get('q') || '',
            ext: params.get('ext') || '',
        };
    }

    // --- Theme ---
    let currentTheme = loadState('theme', 'dark');
    let showHidden = loadState('showHidden', false);
    applyTheme(currentTheme);

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        saveState('theme', theme);
        const toggle = document.getElementById('theme-toggle');
        toggle.textContent = theme === 'dark' ? '\u2600' : '\u263E';
        const hljsLink = document.getElementById('hljs-theme');
        hljsLink.href = theme === 'dark'
            ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
            : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
        if (theme === 'dark') {
            mermaid.initialize({
                startOnLoad: false, securityLevel: 'loose',
                theme: 'dark',
                themeVariables: {
                    primaryTextColor: '#cdd6f4',
                    secondaryTextColor: '#bac2de',
                    tertiaryTextColor: '#a6adc8',
                    noteTextColor: '#cdd6f4',
                    noteBkgColor: '#313244',
                    noteBorderColor: '#45475a',
                    actorTextColor: '#cdd6f4',
                    actorBorder: '#89b4fa',
                    actorBkg: '#1e1e2e',
                    signalTextColor: '#cdd6f4',
                    labelTextColor: '#cdd6f4',
                    loopTextColor: '#cdd6f4',
                    activationBorderColor: '#89b4fa',
                    sequenceNumberColor: '#1e1e2e',
                    sectionBkgColor: '#181825',
                    altSectionBkgColor: '#1e1e2e',
                    taskTextColor: '#cdd6f4',
                    taskTextDarkColor: '#cdd6f4',
                    taskTextOutsideColor: '#cdd6f4',
                    lineColor: '#6c7086',
                    textColor: '#cdd6f4',
                    mainBkg: '#313244',
                    nodeBorder: '#45475a',
                    clusterBkg: '#181825',
                    titleColor: '#cdd6f4',
                    edgeLabelBackground: '#181825',
                }
            });
        } else {
            mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        }
    }

    document.getElementById('theme-toggle').addEventListener('click', () => {
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    const hiddenToggleBtn = document.getElementById('hidden-toggle');
    function applyHiddenToggle() {
        hiddenToggleBtn.classList.toggle('active', showHidden);
        hiddenToggleBtn.title = showHidden ? 'Hide hidden files' : 'Show hidden files';
    }
    function refreshTree() {
        if (!allRoots || !allRoots.length) return;
        fileTree.innerHTML = '';
        for (const root of allRoots) {
            fileTree.appendChild(createTreeNode(root, 0));
        }
    }
    applyHiddenToggle();
    hiddenToggleBtn.addEventListener('click', () => {
        showHidden = !showHidden;
        saveState('showHidden', showHidden);
        applyHiddenToggle();
        refreshTree();
        if (searchInput.value.trim()) triggerSearch();
    });

    let activeItem = null;
    let searchTimeout = null;
    let allRoots = [];
    let activeExtFilter = '';
    let currentFile = '';
    let openFolders = new Set(loadState('openFolders', []));
    let sidebarWidth = loadState('sidebarWidth', 300);

    sidebar.style.width = sidebarWidth + 'px';

    // --- Content zoom ---
    const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250];
    let contentZoom = loadState('contentZoom', 100);
    const zoomLevelEl = document.getElementById('zoom-level');

    function applyZoom() {
        fileContent.style.zoom = contentZoom + '%';
        zoomLevelEl.textContent = contentZoom + '%';
        saveState('contentZoom', contentZoom);
    }

    function zoomIn() {
        const next = ZOOM_STEPS.find(s => s > contentZoom);
        contentZoom = next || ZOOM_STEPS[ZOOM_STEPS.length - 1];
        applyZoom();
    }

    function zoomOut() {
        const prev = [...ZOOM_STEPS].reverse().find(s => s < contentZoom);
        contentZoom = prev || ZOOM_STEPS[0];
        applyZoom();
    }

    function zoomReset() {
        contentZoom = 100;
        applyZoom();
    }

    applyZoom();

    document.getElementById('zoom-in').addEventListener('click', zoomIn);
    document.getElementById('zoom-out').addEventListener('click', zoomOut);
    document.getElementById('zoom-reset').addEventListener('click', zoomReset);

    // Ctrl+= / Ctrl+- for zoom when content is focused
    document.addEventListener('keydown', (e) => {
        if (!currentFile) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
        if (e.key === '-') { e.preventDefault(); zoomOut(); }
        if (e.key === '0') { e.preventDefault(); zoomReset(); }
    });

    // --- Mobile sidebar ---
    function isMobile() { return window.innerWidth <= 768; }

    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.remove('hidden');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.add('hidden');
    }

    let sidebarCollapsed = loadState('sidebarCollapsed', false);
    if (sidebarCollapsed && !isMobile()) sidebar.classList.add('collapsed');

    function toggleSidebar() {
        if (isMobile()) {
            if (sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        } else {
            sidebarCollapsed = !sidebarCollapsed;
            sidebar.classList.toggle('collapsed', sidebarCollapsed);
            saveState('sidebarCollapsed', sidebarCollapsed);
        }
    }

    overlay.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-toggle-welcome').addEventListener('click', openSidebar);

    // --- Sidebar resizer (mouse + touch) ---
    let isResizing = false;
    let resizeStartX = 0;
    let resizeStartW = 0;

    function startResize(clientX) {
        isResizing = true;
        resizeStartX = clientX;
        resizeStartW = sidebar.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.classList.add('resizing');
    }

    function doResize(clientX) {
        if (!isResizing) return;
        const delta = clientX - resizeStartX;
        const newW = Math.max(200, Math.min(800, resizeStartW + delta));
        sidebar.style.width = newW + 'px';
    }

    function endResize() {
        if (!isResizing) return;
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.classList.remove('resizing');
        sidebarWidth = sidebar.getBoundingClientRect().width;
        saveState('sidebarWidth', Math.round(sidebarWidth));
    }

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startResize(e.clientX);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) { doResize(e.clientX); }
    function onMouseUp() {
        endResize();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    resizer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        startResize(e.touches[0].clientX);
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isResizing) return;
        e.preventDefault();
        doResize(e.touches[0].clientX);
    }, { passive: false });

    document.addEventListener('touchend', () => endResize());
    document.addEventListener('touchcancel', () => endResize());

    // --- Quick filter pills ---
    document.querySelectorAll('.quick-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            const ext = btn.dataset.ext;
            if (activeExtFilter === ext) {
                activeExtFilter = '';
                btn.classList.remove('active');
            } else {
                document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'));
                activeExtFilter = ext;
                btn.classList.add('active');
            }
            saveState('extFilter', activeExtFilter);
            updateURL();
            triggerSearch();
        });
    });

    // --- Scope filters (checkboxes per root) ---
    async function loadRoots() {
        const res = await fetch('/api/roots');
        allRoots = await res.json();
        const savedScopes = loadState('scopes', null);

        scopeFilters.innerHTML = '';
        const scopeCollapsed = loadState('scopeCollapsed', false);

        const header = document.createElement('div');
        header.className = 'scope-header';
        header.innerHTML = `
            <span class="scope-toggle-label"><span class="scope-arrow">${scopeCollapsed ? '\u25B8' : '\u25BE'}</span> Search scope</span>
            <span class="scope-actions">
                <button class="scope-btn" id="scope-all">All</button>
                <button class="scope-btn" id="scope-none">None</button>
            </span>
        `;
        scopeFilters.appendChild(header);

        const scopeBody = document.createElement('div');
        scopeBody.className = 'scope-body';
        if (scopeCollapsed) scopeBody.classList.add('collapsed');
        scopeFilters.appendChild(scopeBody);

        header.querySelector('.scope-toggle-label').addEventListener('click', () => {
            const isCollapsed = scopeBody.classList.toggle('collapsed');
            header.querySelector('.scope-arrow').textContent = isCollapsed ? '\u25B8' : '\u25BE';
            saveState('scopeCollapsed', isCollapsed);
        });

        for (const root of allRoots) {
            const label = document.createElement('label');
            label.className = 'scope-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = savedScopes ? savedScopes.includes(root.path) : true;
            cb.dataset.root = root.path;
            cb.addEventListener('change', () => { persistScopes(); triggerSearch(); });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(root.name));
            scopeBody.appendChild(label);
        }

        document.getElementById('scope-all').addEventListener('click', () => {
            scopeFilters.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            persistScopes();
            triggerSearch();
        });

        document.getElementById('scope-none').addEventListener('click', () => {
            scopeFilters.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            persistScopes();
            triggerSearch();
        });

        for (const root of allRoots) {
            const node = createTreeNode(root, 0);
            fileTree.appendChild(node);
        }

        restoreFromURL();
    }

    function persistScopes() {
        const roots = getSelectedRoots();
        saveState('scopes', roots);
    }

    function getSelectedRoots() {
        const checked = scopeFilters.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checked).map(cb => cb.dataset.root);
    }

    // --- Restore state from URL + localStorage ---
    function restoreFromURL() {
        const url = readURL();
        const savedExt = url.ext || loadState('extFilter', '');
        const savedQuery = url.q || loadState('searchQuery', '');

        if (savedExt) {
            activeExtFilter = savedExt;
            document.querySelectorAll('.quick-filter').forEach(b => {
                b.classList.toggle('active', b.dataset.ext === savedExt);
            });
        }

        if (savedQuery) {
            searchInput.value = savedQuery;
        }

        if (savedQuery || savedExt) {
            triggerSearch();
        }

        const fileToOpen = url.file || loadState('currentFile', '');
        if (fileToOpen) {
            openFile(fileToOpen, null);
            expandPathInTree(fileToOpen);
        }

        const savedScroll = loadState('contentScroll', 0);
        if (savedScroll && fileToOpen) {
            setTimeout(() => { fileContent.scrollTop = savedScroll; }, 100);
        }

        const savedSidebarScroll = loadState('sidebarScroll', 0);
        if (savedSidebarScroll) {
            setTimeout(() => { fileTree.scrollTop = savedSidebarScroll; }, 100);
        }
    }

    async function expandPathInTree(filePath) {
        const parts = filePath.split('/');
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
            openFolders.add(currentPath);
        }
        saveState('openFolders', Array.from(openFolders));
    }

    // --- Scroll persistence ---
    let scrollSaveTimeout = null;
    fileContent.addEventListener('scroll', () => {
        clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => saveState('contentScroll', fileContent.scrollTop), 300);
    });

    let sidebarScrollTimeout = null;
    fileTree.addEventListener('scroll', () => {
        clearTimeout(sidebarScrollTimeout);
        sidebarScrollTimeout = setTimeout(() => saveState('sidebarScroll', fileTree.scrollTop), 300);
    });

    // --- Search ---
    function triggerSearch() {
        const q = searchInput.value.trim();
        saveState('searchQuery', q);
        if (!q && !activeExtFilter) {
            searchResults.classList.add('hidden');
            fileTree.classList.remove('hidden');
            searchResults.innerHTML = '';
            updateURL();
            return;
        }
        const query = q || '*';
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => doSearch(query), 200);
    }

    async function doSearch(q) {
        const roots = getSelectedRoots().join(',');
        const params = new URLSearchParams({ q });
        if (roots) params.set('roots', roots);
        if (activeExtFilter) params.set('ext', activeExtFilter);
        if (showHidden) params.set('show_hidden', '1');

        try {
            const res = await fetch(`/api/search?${params}`);
            const results = await res.json();
            searchResults.innerHTML = '';
            fileTree.classList.add('hidden');
            searchResults.classList.remove('hidden');

            if (results.length === 0) {
                searchResults.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:13px;">No files found</div>';
                return;
            }

            for (const item of results) {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = `<span class="search-name">${esc(item.name)}</span><span class="search-path">${esc(item.path)}</span>`;
                div.addEventListener('click', () => {
                    openFile(item.path, null);
                    if (isMobile()) closeSidebar();
                });
                searchResults.appendChild(div);
            }
        } catch (e) {
            console.error('Search failed', e);
        }
    }

    // --- Tree ---
    function createTreeNode(item, depth) {
        if (item.type === 'dir') {
            const wrapper = document.createElement('div');
            const row = document.createElement('div');
            row.className = 'tree-item dir';
            row.style.paddingLeft = (12 + depth * 16) + 'px';
            row.innerHTML = `<span class="icon">\u25B8</span><span class="name">${esc(item.name)}</span>`;

            const children = document.createElement('div');
            children.className = 'tree-children';
            let loaded = false;

            const shouldOpen = openFolders.has(item.path);

            async function expandFolder() {
                if (!loaded) {
                    loaded = true;
                    try {
                        const treeParams = new URLSearchParams({ path: item.path });
                        if (showHidden) treeParams.set('show_hidden', '1');
                        const res = await fetch(`/api/tree?${treeParams}`);
                        const entries = await res.json();
                        for (const entry of entries) {
                            children.appendChild(createTreeNode(entry, depth + 1));
                        }
                    } catch (e) {
                        console.error('Failed to load tree', e);
                    }
                }
                children.classList.add('open');
                row.querySelector('.icon').textContent = '\u25BE';
                openFolders.add(item.path);
                saveState('openFolders', Array.from(openFolders));
            }

            row.addEventListener('click', async () => {
                const isOpen = children.classList.contains('open');
                if (isOpen) {
                    children.classList.remove('open');
                    row.querySelector('.icon').textContent = '\u25B8';
                    openFolders.delete(item.path);
                    saveState('openFolders', Array.from(openFolders));
                } else {
                    await expandFolder();
                }
            });

            wrapper.appendChild(row);
            wrapper.appendChild(children);

            if (shouldOpen) {
                expandFolder();
            }

            return wrapper;
        } else {
            const row = document.createElement('div');
            row.className = 'tree-item file';
            row.dataset.ext = item.ext || '';
            row.dataset.path = item.path;
            row.style.paddingLeft = (12 + depth * 16) + 'px';
            row.innerHTML = `<span class="icon">${fileIcon(item.ext)}</span><span class="name">${esc(item.name)}</span>`;
            row.addEventListener('click', () => {
                openFile(item.path, row);
                if (isMobile()) closeSidebar();
            });

            if (item.path === currentFile) {
                row.classList.add('active');
                activeItem = row;
            }

            return row;
        }
    }

    function fileIcon(ext) {
        const icons = { '.py': '\u{1F40D}', '.md': '\u{1F4DD}', '.json': '{ }', '.yaml': '\u2699', '.yml': '\u2699', '.sql': '\u{1F5C3}', '.sh': '$_', '.bash': '$_', '.js': 'JS', '.ts': 'TS', '.tsx': 'TX', '.jsx': 'JX', '.html': '\u25C7', '.css': '\u25C8', '.txt': '\u2261', '.toml': '\u2699', '.cfg': '\u2699', '.ini': '\u2699', '.env': '\u26A0', '.dockerfile': '\u{1F433}' };
        return icons[ext] || '\u00B7';
    }

    // --- Open file ---
    async function openFile(path, rowEl) {
        if (activeItem) activeItem.classList.remove('active');
        if (rowEl) { rowEl.classList.add('active'); activeItem = rowEl; }

        if (!rowEl) {
            const found = fileTree.querySelector(`[data-path="${CSS.escape(path)}"]`);
            if (found) { found.classList.add('active'); activeItem = found; }
        }

        currentFile = path;
        saveState('currentFile', path);
        saveState('contentScroll', 0);
        findOriginalHTML = '';
        findMatches = [];
        findCurrentIdx = -1;
        updateURL(true);

        try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
            if (!res.ok) {
                const raw = await res.text();
                let detail = raw;
                try { detail = JSON.parse(raw).detail || raw; } catch(_) {}
                const err = new Error(detail || res.statusText);
                err.status = res.status;
                throw err;
            }
            const data = await res.json();

            welcome.classList.add('hidden');
            fileHeader.classList.remove('hidden');
            fileContent.classList.remove('hidden');
            document.getElementById('content-toolbar').classList.remove('hidden');
            filePath.textContent = data.path;
            fileSize.textContent = formatSize(data.size);

            if (data.ext === '.md') {
                renderMarkdown(data.content);
            } else {
                document.getElementById('md-toolbar-slot').innerHTML = '';
                renderCode(data.content, data.ext);
            }
        } catch (e) {
            showNotFound(path, e);
        }
    }

    function showNotFound(path, err) {
        currentFile = '';
        saveState('currentFile', '');
        if (activeItem) { activeItem.classList.remove('active'); activeItem = null; }
        welcome.classList.add('hidden');
        fileHeader.classList.add('hidden');
        document.getElementById('content-toolbar').classList.add('hidden');
        fileContent.classList.remove('hidden');
        const status = err && err.status;
        const title = status === 404 ? '404 Not Found' : (status ? `${status} Error` : 'Error');
        const detail = (err && err.message) || 'Unable to load file.';
        fileContent.innerHTML = `
            <div class="not-found-panel">
                <h2>${esc(title)}</h2>
                <p class="not-found-path">${esc(path)}</p>
                <p class="not-found-detail">${esc(detail)}</p>
                <button class="not-found-home" type="button">Go to home</button>
            </div>`;
        fileContent.querySelector('.not-found-home').addEventListener('click', goHome);
    }

    function goHome() {
        currentFile = '';
        saveState('currentFile', '');
        history.replaceState(null, '', location.pathname);
        fileContent.innerHTML = '';
        fileContent.classList.add('hidden');
        fileHeader.classList.add('hidden');
        document.getElementById('content-toolbar').classList.add('hidden');
        closeFindBar();
        welcome.classList.remove('hidden');
        if (activeItem) { activeItem.classList.remove('active'); activeItem = null; }
    }

    // --- Markdown rendering ---
    let mermaidCounter = 0;

    function renderMarkdown(content) {
        const mermaidBlocks = [];
        mermaidCounter = 0;

        const renderer = new marked.Renderer();

        renderer.code = function(code, lang) {
            if (typeof code === 'object') { lang = code.lang; code = code.text; }
            const langStr = (lang || '').trim().toLowerCase();
            if (langStr === 'mermaid') {
                const id = `mermaid-${mermaidCounter++}`;
                mermaidBlocks.push({ id, code });
                return `<div class="mermaid-wrapper" id="${id}"><pre class="mermaid-src">${esc(code)}</pre></div>`;
            }
            const highlighted = hljs.getLanguage(langStr)
                ? hljs.highlight(code, { language: langStr }).value
                : esc(code);
            return `<pre><code class="hljs language-${langStr || 'text'}">${highlighted}</code></pre>`;
        };

        const html = marked.parse(content, { renderer, gfm: true, breaks: false });

        fileContent.innerHTML = `<div class="md-view">${html}</div>`;

        makeSectionsCollapsible();
        buildMdToolbar();
        renderMermaidDiagrams(mermaidBlocks);
    }

    function buildMdToolbar() {
        const toolbar = document.getElementById('md-toolbar-slot');
        if (!toolbar) return;

        toolbar.innerHTML = `
            <div class="md-tb-group">
                <button id="md-expand-all">Expand All</button>
                <button id="md-collapse-all">Collapse All</button>
            </div>
            <div class="md-tb-sep"></div>
            <div class="md-tb-group">
                <span class="md-tb-label">Collapse at:</span>
                <button class="md-level-btn" data-level="1">H1</button>
                <button class="md-level-btn" data-level="2">H2</button>
                <button class="md-level-btn" data-level="3">H3</button>
                <button class="md-level-btn" data-level="4">H4</button>
                <button class="md-level-btn" data-level="5">H5</button>
                <button class="md-level-btn" data-level="6">H6</button>
            </div>
        `;

        toolbar.querySelector('#md-expand-all').addEventListener('click', () => {
            fileContent.querySelectorAll('.md-section-toggle.collapsed').forEach(h => {
                h.classList.remove('collapsed');
                const content = h.nextElementSibling;
                if (content && content.classList.contains('md-section-content')) {
                    content.classList.remove('collapsed');
                }
            });
            toolbar.querySelectorAll('.md-level-btn').forEach(b => b.classList.remove('active'));
        });

        toolbar.querySelector('#md-collapse-all').addEventListener('click', () => {
            fileContent.querySelectorAll('.md-section-toggle').forEach(h => {
                h.classList.add('collapsed');
                const content = h.nextElementSibling;
                if (content && content.classList.contains('md-section-content')) {
                    content.classList.add('collapsed');
                }
            });
            toolbar.querySelectorAll('.md-level-btn').forEach(b => b.classList.remove('active'));
        });

        toolbar.querySelectorAll('.md-level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = parseInt(btn.dataset.level);
                const isActive = btn.classList.contains('active');

                toolbar.querySelectorAll('.md-level-btn').forEach(b => b.classList.remove('active'));

                if (isActive) {
                    fileContent.querySelectorAll('.md-section-toggle').forEach(h => {
                        h.classList.remove('collapsed');
                        const content = h.nextElementSibling;
                        if (content && content.classList.contains('md-section-content')) {
                            content.classList.remove('collapsed');
                        }
                    });
                    return;
                }

                btn.classList.add('active');

                fileContent.querySelectorAll('.md-section-toggle').forEach(h => {
                    const hLevel = parseInt(h.tagName[1]);
                    const content = h.nextElementSibling;
                    if (!content || !content.classList.contains('md-section-content')) return;

                    if (hLevel >= level) {
                        h.classList.add('collapsed');
                        content.classList.add('collapsed');
                    } else {
                        h.classList.remove('collapsed');
                        content.classList.remove('collapsed');
                    }
                });
            });
        });
    }

    function makeSectionsCollapsible() {
        const mdView = fileContent.querySelector('.md-view');
        if (!mdView) return;

        const headings = mdView.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const usedIds = new Set();
        headings.forEach((heading) => {
            if (!heading.id) {
                const base = slugify(heading.textContent);
                if (base) {
                    let id = base;
                    let n = 2;
                    while (usedIds.has(id)) id = `${base}-${n++}`;
                    heading.id = id;
                    usedIds.add(id);
                }
            } else {
                usedIds.add(heading.id);
            }
            heading.classList.add('md-section-toggle');
            const level = parseInt(heading.tagName[1]);
            const contentDiv = document.createElement('div');
            contentDiv.className = 'md-section-content';

            let sibling = heading.nextElementSibling;
            while (sibling) {
                const next = sibling.nextElementSibling;
                if (sibling.tagName && /^H[1-6]$/.test(sibling.tagName)) {
                    const sibLevel = parseInt(sibling.tagName[1]);
                    if (sibLevel <= level) break;
                }
                contentDiv.appendChild(sibling);
                sibling = next;
            }

            heading.after(contentDiv);
            heading.addEventListener('click', () => {
                heading.classList.toggle('collapsed');
                contentDiv.classList.toggle('collapsed');
            });
        });
    }

    async function renderMermaidDiagrams(blocks) {
        if (!blocks || blocks.length === 0) return;

        for (const { id, code } of blocks) {
            const container = document.getElementById(id);
            if (!container) continue;
            try {
                const renderResult = await mermaid.render(id + '-svg', code);
                container.innerHTML = renderResult.svg;
                container.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openMermaidModal(container);
                });
            } catch (e) {
                container.innerHTML = `<pre class="mermaid-error">Mermaid rendering error: ${esc(String(e))}\n\nSource:\n${esc(code)}</pre>`;
            }
        }
    }

    // --- Mermaid modal with pan/zoom ---
    const modal = document.getElementById('mermaid-modal');
    const modalViewport = document.getElementById('mermaid-modal-viewport');
    const modalContent = document.getElementById('mermaid-modal-content');
    const zoomLabel = document.getElementById('mermaid-modal-zoom-label');

    let mzoom = 1;
    let mpanX = 0;
    let mpanY = 0;
    let mdragging = false;
    let mdragStartX = 0;
    let mdragStartY = 0;
    let mpanStartX = 0;
    let mpanStartY = 0;

    function updateModalTransform() {
        modalContent.style.transform = `translate(${mpanX}px, ${mpanY}px) scale(${mzoom})`;
        zoomLabel.textContent = Math.round(mzoom * 100) + '%';
    }

    function openMermaidModal(wrapper) {
        const svg = wrapper.querySelector('svg');
        if (!svg) return;
        modalContent.innerHTML = svg.outerHTML;
        modal.classList.remove('hidden');
        mzoom = 1;
        mpanX = 0;
        mpanY = 0;

        requestAnimationFrame(() => {
            const svgEl = modalContent.querySelector('svg');
            if (svgEl) {
                const vb = svgEl.getAttribute('viewBox');
                let natW, natH;
                if (vb) {
                    const parts = vb.split(/[\s,]+/).map(Number);
                    natW = parts[2];
                    natH = parts[3];
                } else {
                    const bb = svgEl.getBBox();
                    natW = bb.width || 800;
                    natH = bb.height || 600;
                }
                svgEl.removeAttribute('width');
                svgEl.removeAttribute('height');
                svgEl.removeAttribute('style');
                svgEl.setAttribute('width', natW);
                svgEl.setAttribute('height', natH);
            }
            fitToScreen();
        });
    }

    function closeMermaidModal() {
        modal.classList.add('hidden');
        modalContent.innerHTML = '';
    }

    function getSvgNaturalSize(svgEl) {
        const w = parseFloat(svgEl.getAttribute('width'));
        const h = parseFloat(svgEl.getAttribute('height'));
        if (w && h) return { width: w, height: h };
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
            const parts = vb.split(/[\s,]+/).map(Number);
            return { width: parts[2] || 800, height: parts[3] || 600 };
        }
        return { width: svgEl.scrollWidth || 800, height: svgEl.scrollHeight || 600 };
    }

    function fitToScreen() {
        const svgEl = modalContent.querySelector('svg');
        if (!svgEl) return;
        const vp = modalViewport.getBoundingClientRect();
        const { width: sw, height: sh } = getSvgNaturalSize(svgEl);
        const pad = 40;
        mzoom = Math.min((vp.width - pad) / sw, (vp.height - pad) / sh, 2);
        mpanX = (vp.width - sw * mzoom) / 2;
        mpanY = (vp.height - sh * mzoom) / 2;
        updateModalTransform();
    }

    document.getElementById('mermaid-modal-close').addEventListener('click', closeMermaidModal);
    document.getElementById('mermaid-modal-backdrop').addEventListener('click', closeMermaidModal);

    document.getElementById('mermaid-modal-zoom-in').addEventListener('click', () => {
        mzoom = Math.min(mzoom * 1.25, 5);
        updateModalTransform();
    });

    document.getElementById('mermaid-modal-zoom-out').addEventListener('click', () => {
        mzoom = Math.max(mzoom / 1.25, 0.1);
        updateModalTransform();
    });

    document.getElementById('mermaid-modal-fit').addEventListener('click', fitToScreen);

    document.getElementById('mermaid-modal-reset').addEventListener('click', () => {
        mzoom = 1;
        const vp = modalViewport.getBoundingClientRect();
        const svgEl = modalContent.querySelector('svg');
        if (svgEl) {
            const bb = svgEl.getBBox ? svgEl.getBBox() : { width: svgEl.scrollWidth, height: svgEl.scrollHeight };
            mpanX = (vp.width - (bb.width || 800)) / 2;
            mpanY = Math.max(20, (vp.height - (bb.height || 600)) / 2);
        }
        updateModalTransform();
    });

    // Pan with mouse
    modalViewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        mdragging = true;
        mdragStartX = e.clientX;
        mdragStartY = e.clientY;
        mpanStartX = mpanX;
        mpanStartY = mpanY;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!mdragging) return;
        mpanX = mpanStartX + (e.clientX - mdragStartX);
        mpanY = mpanStartY + (e.clientY - mdragStartY);
        updateModalTransform();
    });

    document.addEventListener('mouseup', () => { mdragging = false; });

    // Pan with touch
    modalViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            mdragging = true;
            mdragStartX = e.touches[0].clientX;
            mdragStartY = e.touches[0].clientY;
            mpanStartX = mpanX;
            mpanStartY = mpanY;
        }
    }, { passive: true });

    modalViewport.addEventListener('touchmove', (e) => {
        if (mdragging && e.touches.length === 1) {
            mpanX = mpanStartX + (e.touches[0].clientX - mdragStartX);
            mpanY = mpanStartY + (e.touches[0].clientY - mdragStartY);
            updateModalTransform();
            e.preventDefault();
        }
    }, { passive: false });

    modalViewport.addEventListener('touchend', () => { mdragging = false; });

    // Zoom with scroll wheel
    modalViewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = modalViewport.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const prevZoom = mzoom;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        mzoom = Math.max(0.1, Math.min(5, mzoom * delta));
        const ratio = mzoom / prevZoom;
        mpanX = mx - ratio * (mx - mpanX);
        mpanY = my - ratio * (my - mpanY);
        updateModalTransform();
    }, { passive: false });

    // Pinch zoom on touch
    let lastPinchDist = 0;
    modalViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            mdragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        }
    }, { passive: true });

    modalViewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (lastPinchDist > 0) {
                const rect = modalViewport.getBoundingClientRect();
                const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
                const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
                const prevZoom = mzoom;
                mzoom = Math.max(0.1, Math.min(5, mzoom * (dist / lastPinchDist)));
                const ratio = mzoom / prevZoom;
                mpanX = cx - ratio * (cx - mpanX);
                mpanY = cy - ratio * (cy - mpanY);
                updateModalTransform();
            }
            lastPinchDist = dist;
        }
    }, { passive: false });

    modalViewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) lastPinchDist = 0;
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeMermaidModal();
            e.stopPropagation();
        }
    });

    // --- Code rendering ---
    function renderCode(content, ext) {
        const langMap = { '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.sql': 'sql', '.sh': 'bash', '.bash': 'bash', '.html': 'xml', '.css': 'css' };
        const lang = langMap[ext] || '';
        const lines = content.split('\n');

        let html = '<div class="code-view"><pre>';
        for (let i = 0; i < lines.length; i++) {
            const lineContent = lang && hljs.getLanguage(lang)
                ? hljs.highlight(lines[i], { language: lang }).value
                : esc(lines[i]);
            html += `<div class="code-line"><span class="code-lineno">${i + 1}</span><span>${lineContent || ' '}</span></div>`;
        }
        html += '</pre></div>';
        fileContent.innerHTML = html;
    }

    // --- Search input ---
    searchInput.addEventListener('input', () => { updateURL(); triggerSearch(); });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            activeExtFilter = '';
            saveState('extFilter', '');
            document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'));
            triggerSearch();
            searchInput.blur();
        }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
            if (isMobile()) openSidebar();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            if (!currentFile) return;
            if (!modal.classList.contains('hidden')) return;
            e.preventDefault();
            openFindBar();
        }
    });

    // --- Find in page ---
    const findBar = document.getElementById('find-bar');
    const findInput = document.getElementById('find-input');
    const findCount = document.getElementById('find-count');
    const findCaseCheckbox = document.getElementById('find-case');
    const findToggleBtn = document.getElementById('find-toggle');
    let findMatches = [];
    let findCurrentIdx = -1;
    let findOriginalHTML = '';

    function openFindBar() {
        findBar.classList.remove('hidden');
        findInput.focus();
        findInput.select();
    }

    function closeFindBar() {
        findBar.classList.add('hidden');
        findInput.value = '';
        clearHighlights();
    }

    function clearHighlights() {
        if (findOriginalHTML) {
            const container = fileContent.querySelector('.md-view') || fileContent.querySelector('.code-view');
            if (container) container.innerHTML = findOriginalHTML;
            findOriginalHTML = '';
        }
        findMatches = [];
        findCurrentIdx = -1;
        findCount.textContent = '';
    }

    function performFind() {
        const query = findInput.value;
        if (!query) { clearHighlights(); return; }

        const container = fileContent.querySelector('.md-view') || fileContent.querySelector('.code-view');
        if (!container) return;

        if (findOriginalHTML) {
            container.innerHTML = findOriginalHTML;
        } else {
            findOriginalHTML = container.innerHTML;
        }

        const caseSensitive = findCaseCheckbox.checked;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.parentElement && (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE')) continue;
            textNodes.push(node);
        }

        findMatches = [];
        const flags = caseSensitive ? 'g' : 'gi';
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, flags);

        for (let i = textNodes.length - 1; i >= 0; i--) {
            const tNode = textNodes[i];
            const text = tNode.textContent;
            const matches = [...text.matchAll(regex)];
            if (matches.length === 0) continue;

            const parent = tNode.parentNode;
            const frag = document.createDocumentFragment();
            let lastIdx = 0;

            for (const match of matches) {
                if (match.index > lastIdx) {
                    frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
                }
                const mark = document.createElement('mark');
                mark.className = 'find-highlight';
                mark.textContent = match[0];
                frag.appendChild(mark);
                lastIdx = match.index + match[0].length;
            }

            if (lastIdx < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx)));
            }

            parent.replaceChild(frag, tNode);
        }

        findMatches = Array.from(container.querySelectorAll('.find-highlight'));

        if (findMatches.length > 0) {
            findCurrentIdx = 0;
            highlightCurrent();
        } else {
            findCurrentIdx = -1;
        }

        updateFindCount();
    }

    function expandCollapsedAncestors(el) {
        let node = el.parentElement;
        while (node && node !== fileContent) {
            if (node.classList.contains('md-section-content') && node.classList.contains('collapsed')) {
                node.classList.remove('collapsed');
                const heading = node.previousElementSibling;
                if (heading && heading.classList.contains('md-section-toggle')) {
                    heading.classList.remove('collapsed');
                }
            }
            node = node.parentElement;
        }
    }

    function highlightCurrent() {
        findMatches.forEach(m => m.classList.remove('find-highlight-current'));
        if (findCurrentIdx >= 0 && findCurrentIdx < findMatches.length) {
            const el = findMatches[findCurrentIdx];
            expandCollapsedAncestors(el);
            el.classList.add('find-highlight-current');
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    function updateFindCount() {
        if (findMatches.length === 0 && findInput.value) {
            findCount.textContent = 'No results';
        } else if (findMatches.length > 0) {
            findCount.textContent = `${findCurrentIdx + 1} / ${findMatches.length}`;
        } else {
            findCount.textContent = '';
        }
    }

    function findNext() {
        if (findMatches.length === 0) return;
        findCurrentIdx = (findCurrentIdx + 1) % findMatches.length;
        highlightCurrent();
        updateFindCount();
    }

    function findPrev() {
        if (findMatches.length === 0) return;
        findCurrentIdx = (findCurrentIdx - 1 + findMatches.length) % findMatches.length;
        highlightCurrent();
        updateFindCount();
    }

    let findDebounce = null;
    findInput.addEventListener('input', () => {
        clearTimeout(findDebounce);
        findDebounce = setTimeout(performFind, 150);
    });

    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) findPrev(); else findNext();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeFindBar();
        }
    });

    findCaseCheckbox.addEventListener('change', performFind);
    document.getElementById('find-next').addEventListener('click', findNext);
    document.getElementById('find-prev').addEventListener('click', findPrev);
    document.getElementById('find-close').addEventListener('click', closeFindBar);

    findToggleBtn.addEventListener('click', () => {
        if (findBar.classList.contains('hidden')) {
            openFindBar();
        } else {
            closeFindBar();
        }
    });

    // --- Handle back/forward ---
    window.addEventListener('popstate', () => {
        const url = readURL();
        suppressPush = true;
        if (url.file && url.file !== currentFile) {
            openFile(url.file, null);
        } else if (!url.file && currentFile) {
            goHome();
        }
        suppressPush = false;
    });

    // --- In-file anchor links (markdown) ---
    fileContent.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#"]');
        if (!link || !fileContent.contains(link)) return;
        const href = link.getAttribute('href');
        if (!href || href.length < 2) return;
        e.preventDefault();
        const targetId = decodeURIComponent(href.slice(1));
        const container = fileContent.querySelector('.md-view') || fileContent;
        const target = container.querySelector(`[id="${CSS.escape(targetId)}"]`);
        if (!target) return;
        expandCollapsedAncestors(target);
        if (target.classList.contains('md-section-toggle') && target.classList.contains('collapsed')) {
            target.classList.remove('collapsed');
            const next = target.nextElementSibling;
            if (next && next.classList.contains('md-section-content')) next.classList.remove('collapsed');
        }
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    // --- Util ---
    function esc(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function slugify(text) {
        return text.toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    loadRoots();
});
