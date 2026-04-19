document.addEventListener('DOMContentLoaded', () => {
    const fileTree = document.getElementById('file-tree');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const welcome = document.getElementById('welcome');
    const fileHeader = document.getElementById('file-header');
    const filePath = document.getElementById('file-path');
    const fileSize = document.getElementById('file-size');
    const fileContent = document.getElementById('file-content');

    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

    let activeItem = null;
    let searchTimeout = null;

    // --- Sidebar resizer ---
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('resizer');
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        if (!isResizing) return;
        const w = Math.max(200, Math.min(600, e.clientX));
        sidebar.style.width = w + 'px';
    }

    function onMouseUp() {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // --- Load roots ---
    async function loadRoots() {
        const res = await fetch('/api/roots');
        const roots = await res.json();
        for (const root of roots) {
            fileTree.appendChild(createTreeNode(root, 0));
        }
    }

    function createTreeNode(item, depth) {
        if (item.type === 'dir') {
            const wrapper = document.createElement('div');
            const row = document.createElement('div');
            row.className = 'tree-item dir';
            row.style.paddingLeft = (12 + depth * 16) + 'px';
            row.innerHTML = `<span class="icon">▸</span><span class="name">${esc(item.name)}</span>`;

            const children = document.createElement('div');
            children.className = 'tree-children';
            let loaded = false;

            row.addEventListener('click', async () => {
                const isOpen = children.classList.contains('open');
                if (isOpen) {
                    children.classList.remove('open');
                    row.querySelector('.icon').textContent = '▸';
                } else {
                    if (!loaded) {
                        loaded = true;
                        try {
                            const res = await fetch(`/api/tree?path=${encodeURIComponent(item.path)}`);
                            const entries = await res.json();
                            for (const entry of entries) {
                                children.appendChild(createTreeNode(entry, depth + 1));
                            }
                        } catch (e) {
                            console.error('Failed to load tree', e);
                        }
                    }
                    children.classList.add('open');
                    row.querySelector('.icon').textContent = '▾';
                }
            });

            wrapper.appendChild(row);
            wrapper.appendChild(children);
            return wrapper;
        } else {
            const row = document.createElement('div');
            row.className = 'tree-item file';
            row.dataset.ext = item.ext || '';
            row.style.paddingLeft = (12 + depth * 16) + 'px';
            row.innerHTML = `<span class="icon">${fileIcon(item.ext)}</span><span class="name">${esc(item.name)}</span>`;
            row.addEventListener('click', () => openFile(item.path, row));
            return row;
        }
    }

    function fileIcon(ext) {
        const icons = { '.py': '🐍', '.md': '📄', '.json': '{ }', '.yaml': '⚙', '.yml': '⚙', '.sql': '🗃', '.sh': '⌘', '.js': 'JS', '.ts': 'TS', '.tsx': 'TX', '.html': '◇', '.css': '◈' };
        return icons[ext] || '·';
    }

    // --- Open file ---
    async function openFile(path, rowEl) {
        if (activeItem) activeItem.classList.remove('active');
        if (rowEl) { rowEl.classList.add('active'); activeItem = rowEl; }

        try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            welcome.classList.add('hidden');
            fileHeader.classList.remove('hidden');
            fileContent.classList.remove('hidden');
            filePath.textContent = data.path;
            fileSize.textContent = formatSize(data.size);

            if (data.ext === '.md') {
                renderMarkdown(data.content);
            } else {
                renderCode(data.content, data.ext);
            }
        } catch (e) {
            fileContent.innerHTML = `<div style="color:var(--red);padding:20px;">${esc(e.message)}</div>`;
        }
    }

    // --- Markdown rendering ---
    function renderMarkdown(content) {
        const renderer = new marked.Renderer();
        let mermaidId = 0;

        renderer.code = function({ text, lang }) {
            if (lang === 'mermaid') {
                const id = `mermaid-${mermaidId++}`;
                return `<div class="mermaid-container" id="${id}">${esc(text)}</div>`;
            }
            const highlighted = hljs.getLanguage(lang)
                ? hljs.highlight(text, { language: lang }).value
                : esc(text);
            return `<pre><code class="hljs language-${lang || 'text'}">${highlighted}</code></pre>`;
        };

        const html = marked.parse(content, { renderer, gfm: true, breaks: false });
        fileContent.innerHTML = `<div class="md-view">${html}</div>`;

        makeSectionsCollapsible();
        renderMermaidDiagrams();
    }

    function makeSectionsCollapsible() {
        const mdView = fileContent.querySelector('.md-view');
        if (!mdView) return;

        const headings = mdView.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach((heading) => {
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

    async function renderMermaidDiagrams() {
        const containers = fileContent.querySelectorAll('.mermaid-container');
        for (const container of containers) {
            const code = container.textContent;
            try {
                const { svg } = await mermaid.render(container.id + '-svg', code);
                container.innerHTML = svg;
            } catch (e) {
                container.innerHTML = `<pre style="color:var(--red)">Mermaid error: ${esc(e.message)}\n\n${esc(code)}</pre>`;
            }
        }
    }

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

    // --- Search ---
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = searchInput.value.trim();
        if (!q) {
            searchResults.classList.add('hidden');
            fileTree.classList.remove('hidden');
            searchResults.innerHTML = '';
            return;
        }
        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
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
                    div.addEventListener('click', () => openFile(item.path, null));
                    searchResults.appendChild(div);
                }
            } catch (e) {
                console.error('Search failed', e);
            }
        }, 200);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            searchInput.blur();
        }
    });

    // --- Keyboard shortcut ---
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    // --- Util ---
    function esc(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    loadRoots();
});
