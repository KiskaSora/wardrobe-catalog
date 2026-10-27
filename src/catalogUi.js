import {
    catalogUrls,
    catalogResolveType,
    parseCatalogData,
    filterCatalog,
} from './catalog.js';

const WCAT_CACHE_PREFIX = 'wcat_cache_v1:';
const WCAT_CACHE_TTL_MS = 10 * 60 * 1000;
const WCAT_PAGE_SIZE = 24;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function readCache(dataUrl) {
    try {
        const parsed = JSON.parse(localStorage.getItem(WCAT_CACHE_PREFIX + dataUrl) || 'null');
        return parsed && parsed.data && typeof parsed.data === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writeCache(dataUrl, data, meta = {}) {
    try {
        localStorage.setItem(WCAT_CACHE_PREFIX + dataUrl, JSON.stringify({
            data, etag: meta.etag || '', lastModified: meta.lastModified || '', ts: Date.now(),
        }));
    } catch {
        // localStorage may be full or unavailable in embedded WebViews.
    }
}

async function fetchCatalog(dataUrl, cached = null, force = false) {
    const headers = {};
    if (!force && cached?.etag) headers['If-None-Match'] = cached.etag;
    if (!force && cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const response = await fetch(dataUrl, { headers, cache: 'no-cache' });
    if (response.status === 304 && cached) return { data: cached.data, notModified: true };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    writeCache(dataUrl, data, {
        etag: response.headers.get('ETag') || '',
        lastModified: response.headers.get('Last-Modified') || '',
    });
    return { data, notModified: false };
}

/** JSON каталога с кэшем (общий с окном каталога). */
export async function loadCatalogJson(dataUrl, force = false) {
    const cached = force ? null : readCache(dataUrl);
    if (cached && Date.now() - (cached.ts || 0) < WCAT_CACHE_TTL_MS) return cached.data;
    try {
        return (await fetchCatalog(dataUrl, cached, force)).data;
    } catch (e) {
        if (cached) return cached.data;
        throw e;
    }
}

export async function fetchCatalogImageBlob(url) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
}

export function openWardrobeCatalog(adapters) {
    const { catalogs, index = 0, onIndex = () => {}, addedIds, pick, quickAdd, target = () => 'bot', onTarget = () => {}, openLooks = null } = adapters;
    const getTypes = () => [];
    let current = Math.min(Math.max(index, 0), Math.max(catalogs.length - 1, 0));
    let { site, data: dataUrl } = catalogUrls(catalogs[current]?.url);
    const ctx = () => ({ site, dataUrl, name: catalogs[current]?.name || '' });
    document.getElementById('wcat-c-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wcat-c-overlay';
    overlay.className = 'wcat-s-overlay wcat-c-overlay';
    overlay.innerHTML = `
        <div class="wcat-s-modal wcat-c-modal">
            <div class="wcat-s-modal-head">
                <span class="wcat-s-modal-title"><i class="fa-solid fa-globe"></i> Каталог образов </span>
                <select class="text_pole wcat-switch" title="Какой каталог открыть">${catalogs.map((c, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>${esc(c.name || c.url)}</option>`).join('')}</select>
                <a class="wcat-s-source-link" href="${esc(site)}" target="_blank" rel="noopener" title="Открыть сайт"><i class="fa-solid fa-arrow-up-right-from-square"></i> Сайт</a>
                ${openLooks ? '<div class="wcat-s-refresh menu_button wcat-c-looks" title="Внешности персонажей"><i class="fa-solid fa-face-smile"></i></div>' : ''}
                <div class="wcat-s-refresh menu_button wcat-c-refresh" title="Обновить каталог"><i class="fa-solid fa-rotate"></i></div>
                <div class="wcat-s-refresh menu_button wcat-c-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="wcat-c-targetrow"><span>Добавлять в:</span><select class="text_pole wcat-target">
                    <option value="bot">гардероб бота</option><option value="user">гардероб юзера</option><option value="download">только скачать</option></select></div>
            <div class="wcat-c-filters">
                <div class="wcat-s-filters wcat-c-chars"></div>
                <div class="wcat-s-filters wcat-c-keys"></div>
            </div>
            <div class="wcat-s-body wcat-c-body"><div class="wcat-s-loading">Загрузка каталога…</div></div>
        </div>`;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.wcat-c-modal');
    const targetSel = overlay.querySelector('.wcat-target');
    targetSel.value = target();
    targetSel.addEventListener('change', () => onTarget(targetSel.value));
    const bodyEl = overlay.querySelector('.wcat-c-body');
    const charsEl = overlay.querySelector('.wcat-c-chars');
    const keysEl = overlay.querySelector('.wcat-c-keys');
    const state = { charId: '', key: '', favOnly: false, limit: WCAT_PAGE_SIZE };
    let catalog = { chars: [], keys: [], outfits: [] };

    const onKey = (event) => {
        if (event.key !== 'Escape' || document.getElementById('wcat-detail-overlay')) return;
        event.stopImmediatePropagation();
        close();
    };
    function close() {
        document.removeEventListener('keydown', onKey, true);
        // освободить картинки: окно закрыто — Таверна ничего не держит
        overlay.querySelectorAll('img').forEach(img => { img.removeAttribute('src'); });
        catalog = { chars: [], keys: [], outfits: [] };
        overlay.remove();
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    for (const type of ['click', 'mousedown', 'pointerdown', 'pointerup']) {
        modal.addEventListener(type, event => event.stopPropagation());
    }
    for (const type of ['touchstart', 'touchend']) {
        modal.addEventListener(type, event => event.stopPropagation(), { passive: true });
    }
    overlay.querySelector('.wcat-c-close').addEventListener('click', close);
    overlay.querySelector('.wcat-c-looks')?.addEventListener('click', () => openLooks());

    const typeView = (key) => {
        const { suggestion, existing } = catalogResolveType(key, getTypes());
        if (existing) return { icon: existing.icon || 'fa-tag', label: existing.label, known: true };
        return { icon: suggestion.icon || 'fa-tag', label: suggestion.label || key, known: false };
    };

    const scoped = () => filterCatalog(catalog.outfits, { charId: state.charId, favOnly: state.favOnly });

    const renderChars = () => {
        const count = id => catalog.outfits.filter(o => !id || o.charId === id).length;
        const chars = catalog.chars.length > 1 ? [{ id: '', name: 'Все персонажи' }, ...catalog.chars] : [];
        const favCount = catalog.outfits.filter(o => o.fav).length;
        if (!favCount) state.favOnly = false;
        charsEl.hidden = !favCount && !chars.length;
        charsEl.innerHTML = (favCount ? `<button type="button" class="wcat-s-chip ${state.favOnly ? 'active' : ''}" data-fav title="Только любимые на сайте"><i class="fa-solid fa-heart"></i> ${favCount}</button>` : '')
            + chars.map(c => `
            <button type="button" class="wcat-s-chip ${state.charId === c.id ? 'active' : ''}" data-char="${esc(c.id)}">
                ${c.img ? `<img class="wcat-c-avatar" src="${esc(c.img)}" alt="" loading="lazy">` : (c.id ? '' : '<i class="fa-solid fa-users"></i>')}
                ${esc(c.name)} <span class="wcat-chip-count">${count(c.id)}</span>
            </button>`).join('');
        charsEl.querySelector('[data-fav]')?.addEventListener('click', () => {
            state.favOnly = !state.favOnly;
            state.limit = WCAT_PAGE_SIZE;
            renderAll();
        });
        for (const button of charsEl.querySelectorAll('[data-char]')) {
            button.addEventListener('click', () => {
                state.charId = button.dataset.char || '';
                state.key = '';
                state.limit = WCAT_PAGE_SIZE;
                renderAll();
            });
        }
    };

    const renderKeys = () => {
        const base = scoped();
        const counts = new Map();
        for (const o of base) counts.set(o.key, (counts.get(o.key) || 0) + 1);
        if (state.key && !counts.has(state.key)) state.key = '';
        const keys = catalog.keys.filter(key => counts.has(key));
        keysEl.innerHTML = `<button type="button" class="wcat-s-chip ${state.key ? '' : 'active'}" data-key="">Все типы <span class="wcat-chip-count">${base.length}</span></button>`
            + keys.map(key => {
                const view = typeView(key);
                return `<button type="button" class="wcat-s-chip ${state.key === key ? 'active' : ''} ${view.known ? '' : 'wcat-c-new-type'}" data-key="${esc(key)}" title="${view.known ? `Тип гардероба: ${esc(view.label)}` : 'Такого типа ещё нет — создастся при добавлении'}">
                    <i class="fa-solid ${esc(view.icon)}"></i> ${esc(key)} <span class="wcat-chip-count">${counts.get(key)}</span>
                </button>`;
            }).join('');
        for (const button of keysEl.querySelectorAll('[data-key]')) {
            button.addEventListener('click', () => {
                state.key = button.dataset.key || '';
                state.limit = WCAT_PAGE_SIZE;
                renderKeys();
                renderGrid();
            });
        }
    };

    const cardHtml = (o, added) => {
        const view = typeView(o.key);
        const isAdded = added.has(o.id);
        return `<article class="wcat-c-card ${isAdded ? 'wcat-c-added' : ''}" data-id="${esc(o.id)}">
            <button type="button" class="wcat-c-preview" data-act="pick" title="Открыть крупно">
                <img src="${esc(o.img)}" alt="" loading="lazy" decoding="async" fetchpriority="low">
                ${o.fav ? '<span class="wcat-c-fav-badge"><i class="fa-solid fa-heart"></i></span>' : ''}
            </button>
            <div class="wcat-c-info">
                <span class="wcat-c-name" title="${esc(o.name)}">${esc(o.name)}</span>
                <span class="wcat-c-meta"><i class="fa-solid ${esc(view.icon)}"></i> ${esc(view.label)}${o.charName && !state.charId ? ` · ${esc(o.charName)}` : ''}</span>
                ${o.desc ? `<span class="wcat-c-desc">${esc(o.desc)}</span>` : ''}
            </div>
            <div class="wcat-c-actions">
                <button type="button" class="menu_button wcat-c-quick" data-act="quick" title="${isAdded ? 'Уже взят — взять ещё раз' : 'Взять образ: картинка и описание'}">
                    <i class="fa-solid ${isAdded ? 'fa-check' : 'fa-plus'}"></i>
                </button>
            </div>
        </article>`;
    };

    const renderGrid = () => {
        const visible = filterCatalog(catalog.outfits, state);
        if (!visible.length) {
            bodyEl.innerHTML = `<div class="wcat-s-loading">${catalog.outfits.length ? 'Ничего не нашлось' : 'Каталог пуст'}</div>`;
            return;
        }
        bodyEl.innerHTML = '<div class="wcat-c-grid"></div><button type="button" class="menu_button wcat-c-more" hidden></button>';
        const grid = bodyEl.querySelector('.wcat-c-grid');
        const more = bodyEl.querySelector('.wcat-c-more');
        let shown = 0;
        const appendUpTo = (limit) => {
            const added = addedIds(dataUrl);
            const batch = visible.slice(shown, limit);
            grid.insertAdjacentHTML('beforeend', batch.map(o => cardHtml(o, added)).join(''));
            for (const card of [...grid.children].slice(shown)) bindCard(card);
            shown += batch.length;
            const rest = visible.length - shown;
            more.hidden = rest <= 0;
            more.textContent = `Ещё ${Math.min(rest, WCAT_PAGE_SIZE)} из ${rest}`;
        };
        more.addEventListener('click', () => {
            state.limit = shown + WCAT_PAGE_SIZE;
            appendUpTo(state.limit);
        });
        appendUpTo(state.limit);
    };

    function bindCard(card) {
        const outfit = catalog.outfits.find(o => o.id === card.dataset.id);
        if (!outfit) return;
        card.querySelector('[data-act="pick"]').addEventListener('click', () => pick(outfit, ctx()));
        const quick = card.querySelector('[data-act="quick"]');
        quick.addEventListener('click', async () => {
            if (quick.disabled) return;
            quick.disabled = true;
            const icon = quick.querySelector('i');
            icon.className = 'fa-solid fa-spinner fa-spin';
            try {
                await quickAdd(outfit, ctx());
                card.classList.add('wcat-c-added');
                icon.className = 'fa-solid fa-check';
                renderKeys();
            } catch (error) {
                icon.className = 'fa-solid fa-plus';
                toastr.error('Не удалось добавить: ' + String(error.message || error), 'Каталог образов');
            } finally {
                quick.disabled = false;
            }
        });
    }

    function renderAll() {
        renderChars();
        renderKeys();
        renderGrid();
    }

    const show = (data) => {
        if (!data || !['chars', 'cats', 'items'].some(k => Array.isArray(data[k]))) {
            bodyEl.innerHTML = `<p class="hint" style="padding: 16px;">Это не похоже на wardrobe.json (нужны поля chars / cats / items): ${esc(dataUrl)}</p>`;
            charsEl.innerHTML = ''; keysEl.innerHTML = '';
            return;
        }
        catalog = parseCatalogData(data, site);
        if (state.charId && !catalog.chars.some(c => c.id === state.charId)) state.charId = '';
        renderAll();
    };

    const refreshButton = overlay.querySelector('.wcat-c-refresh');
    refreshButton.addEventListener('click', async () => {
        if (refreshButton.classList.contains('is-loading')) return;
        refreshButton.classList.add('is-loading');
        const icon = refreshButton.querySelector('i');
        icon.className = 'fa-solid fa-spinner wcat-spin-anim';
        try {
            const result = await fetchCatalog(dataUrl, null, true);
            show(result.data);
            toastr.success('Каталог обновлён', 'Каталог образов', { timeOut: 2000 });
        } catch (error) {
            toastr.error('Не удалось обновить: ' + String(error.message || error), 'Каталог образов');
        } finally {
            icon.className = 'fa-solid fa-rotate';
            refreshButton.classList.remove('is-loading');
        }
    });

    function loadCurrent() {
        const myUrl = dataUrl;
        const stale = () => !overlay.isConnected || myUrl !== dataUrl;
        bodyEl.innerHTML = '<div class="wcat-s-loading">Загрузка каталога…</div>';
        const cached = readCache(dataUrl);
        if (cached) {
            show(cached.data);
            if (Date.now() - (cached.ts || 0) > WCAT_CACHE_TTL_MS) {
                fetchCatalog(dataUrl, cached)
                    .then(result => { if (!stale() && !result.notModified) show(result.data); })
                    .catch(() => {});
            }
        } else {
            fetchCatalog(dataUrl, null, true)
                .then(result => { if (!stale()) show(result.data); })
                .catch(error => {
                    if (stale()) return;
                    bodyEl.innerHTML = `<p class="hint" style="padding: 16px;">Не удалось загрузить каталог (${esc(dataUrl)}): ${esc(error.message || error)}</p>`;
                });
        }
    }

    overlay.querySelector('.wcat-switch').addEventListener('change', (event) => {
        current = Number(event.target.value) || 0;
        ({ site, data: dataUrl } = catalogUrls(catalogs[current]?.url));
        overlay.querySelector('.wcat-s-source-link').href = site;
        Object.assign(state, { charId: '', key: '', favOnly: false, limit: WCAT_PAGE_SIZE });
        catalog = { chars: [], keys: [], outfits: [] };
        charsEl.innerHTML = ''; keysEl.innerHTML = '';
        onIndex(current);
        loadCurrent();
    });

    loadCurrent();

    // Остальные каталоги подгружаем потом, когда первый уже показан и браузер свободен.
    // Только JSON с описаниями, картинки не трогаем.
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
    idle(() => {
        catalogs.forEach((c, i) => {
            if (i === current || !overlay.isConnected) return;
            const { data: other } = catalogUrls(c.url);
            if (readCache(other)) return;
            fetchCatalog(other, null, true).catch(() => {});
        });
    });

    return { close, refresh: renderAll };
}
