/**
 * Каталог образов — отдельная расширка.
 * Вынесено из Novarakk (wardrobeCatalog + wardrobeCatalogUi), без генератора картинок.
 * Читает сайты-гардеробы в формате wardrobe.json ({ chars, cats, items }).
 * Можно держать несколько каталогов и переключаться между ними.
 */

import { openWardrobeCatalog, fetchCatalogImageBlob } from './src/catalogUi.js';
import { SW_CATALOG_DEFAULT_URL as DEFAULT_CATALOG_URL } from './src/catalog.js';
import { openLooks } from './src/looksUi.js';
import { DEFAULT_TEMPLATE } from './src/extblocks.js';
import { addToWardrobe, addedFromWardrobe, wardrobeInstalled } from './src/target.js';

const KEY = 'wardrobe_catalog';
const MY_SITE = 'https://kiskasora.github.io/wardrobe/';

const defaults = () => ({
    catalogs: [
        { name: 'Мой гардероб', url: MY_SITE },
        { name: 'Каталог Ниэль', url: DEFAULT_CATALOG_URL },
    ],
    index: 0,
    target: 'bot',
    taken: {},
    looksUrl: MY_SITE,
    ebBlockName: 'nai_imagen',
    ebBlockRef: '',
    lookTemplate: '',
});

function ctx() { return SillyTavern.getContext(); }
function save() { ctx().saveSettingsDebounced(); }
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function getSettings() {
    const store = ctx().extensionSettings;
    if (!store[KEY]) store[KEY] = defaults();
    const s = store[KEY];
    if (!Array.isArray(s.catalogs) || !s.catalogs.length) s.catalogs = defaults().catalogs;
    s.catalogs = s.catalogs.filter(c => c && typeof c.url === 'string' && c.url.trim());
    if (!s.catalogs.length) s.catalogs = defaults().catalogs;
    if (!Number.isInteger(s.index) || s.index < 0 || s.index >= s.catalogs.length) s.index = 0;
    if (!['bot', 'user', 'download'].includes(s.target)) s.target = 'bot';
    if (!s.taken || typeof s.taken !== 'object') s.taken = {};
    if (typeof s.looksUrl !== 'string' || !s.looksUrl.trim()) s.looksUrl = MY_SITE;
    if (typeof s.ebBlockName !== 'string' || !s.ebBlockName.trim()) s.ebBlockName = 'nai_imagen';
    if (typeof s.ebBlockRef !== 'string') s.ebBlockRef = '';
    if (typeof s.lookTemplate !== 'string') s.lookTemplate = '';
    return s;
}

// ── «Взять образ»: скачать картинку + скопировать описание ──

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;left:-999px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
        return ok;
    }
}

function fileNameFor(outfit, blob) {
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
    const base = String(outfit.name || 'outfit').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'outfit';
    return `${base}.${ext || 'jpg'}`;
}

async function downloadImage(outfit) {
    const blob = await fetchCatalogImageBlob(outfit.img);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(outfit, blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function markTaken(dataUrl, id) {
    const s = getSettings();
    const list = s.taken[dataUrl] || (s.taken[dataUrl] = []);
    if (!list.includes(id)) { list.push(id); save(); }
}

async function takeOutfit(outfit, c) {
    const s = getSettings();
    if (s.target === 'download' || (!wardrobeInstalled() && s.target !== 'download')) {
        await downloadImage(outfit);
        const copied = outfit.desc ? await copyText(outfit.desc) : false;
        markTaken(c.dataUrl, outfit.id);
        toastr.success(copied ? 'Картинка скачана, описание скопировано' : 'Картинка скачана', 'Каталог образов', { timeOut: 2500 });
        return;
    }
    const blob = await fetchCatalogImageBlob(outfit.img);
    const res = await addToWardrobe(s.target, outfit, blob, c);
    markTaken(c.dataUrl, outfit.id);
    toastr.success(`«${outfit.name}» добавлен в гардероб (${s.target === 'user' ? 'юзер' : 'бот'}, общий)`, 'Каталог образов', { timeOut: 2500 });
    if (res.warn) toastr.info(res.warn, 'Каталог образов', { timeOut: 5000 });
}

function showDetail(outfit, c) {
    document.getElementById('wcat-detail-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'wcat-detail-overlay';
    ov.className = 'wcat-detail-overlay';
    ov.innerHTML = `
        <div class="wcat-detail">
            <img src="${esc(outfit.img)}" alt="">
            <div class="wcat-detail-text"><b>${esc(outfit.name)}</b>${outfit.charName ? ` · ${esc(outfit.charName)}` : ''}${outfit.catName ? `\n${esc(outfit.catName)}` : ''}${outfit.desc ? `\n\n${esc(outfit.desc)}` : ''}</div>
            <div class="wcat-detail-actions">
                <button type="button" class="menu_button" data-a="take"><i class="fa-solid fa-download"></i> Взять</button>
                <button type="button" class="menu_button" data-a="copy"><i class="fa-solid fa-copy"></i> Описание</button>
                <button type="button" class="menu_button" data-a="close"><i class="fa-solid fa-xmark"></i> Закрыть</button>
            </div>
        </div>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    for (const t of ['click', 'mousedown', 'pointerdown', 'pointerup']) ov.addEventListener(t, e => e.stopPropagation());
    ov.querySelector('[data-a="close"]').addEventListener('click', close);
    ov.querySelector('[data-a="copy"]').addEventListener('click', async () => {
        const ok = await copyText(outfit.desc || '');
        ok ? toastr.success('Описание скопировано', 'Каталог образов', { timeOut: 1800 }) : toastr.error('Не удалось скопировать', 'Каталог образов');
    });
    ov.querySelector('[data-a="take"]').addEventListener('click', async () => {
        try { await takeOutfit(outfit, c); } catch (e) { toastr.error('Не удалось: ' + String(e.message || e), 'Каталог образов'); }
    });
    document.body.appendChild(ov);
}

// ── Открытие каталога ──

export function openCatalog({ side } = {}) {
    const s = getSettings();
    if (side === 'bot' || side === 'user') { s.target = side; save(); }
    openWardrobeCatalog({
        catalogs: s.catalogs,
        index: s.index,
        onIndex: (i) => { s.index = i; save(); },
        addedIds: (dataUrl) => new Set([...(s.taken[dataUrl] || []), ...addedFromWardrobe(dataUrl)]),
        target: () => s.target,
        onTarget: (v) => { s.target = v; save(); },
        quickAdd: (outfit, c) => takeOutfit(outfit, c),
        pick: (outfit, c) => showDetail(outfit, c),
        openLooks: () => openLooksWindow(),
    });
}

// ── Внешности → Context Builder (ExtBlocks) ──

export function openLooksWindow() {
    const s = getSettings();
    openLooks({
        url: s.looksUrl,
        getBlockRef: () => s.ebBlockRef,
        getBlockName: () => s.ebBlockName,
        onBlock: (ref) => { s.ebBlockRef = ref || ''; save(); },
        getTemplate: () => s.lookTemplate || DEFAULT_TEMPLATE,
        onTemplate: (text) => { s.lookTemplate = text || ''; save(); },
        copy: copyText,
    });
}

// ── Настройки (список каталогов) ──

function renderSettings(root) {
    const s = getSettings();
    const rows = s.catalogs.map((c, i) => `
        <div class="wcat-list-row" data-i="${i}">
            <input type="text" class="text_pole wcat-name" value="${esc(c.name)}" placeholder="Название">
            <input type="text" class="text_pole wcat-url" value="${esc(c.url)}" placeholder="https://…/wardrobe/">
            <div class="menu_button menu_button_icon wcat-del" title="Убрать"><i class="fa-solid fa-trash"></i></div>
        </div>`).join('');
    root.innerHTML = `
        ${rows}
        <div class="flex-container">
            <div class="menu_button wcat-add"><i class="fa-solid fa-plus"></i> Добавить каталог</div>
            <div class="menu_button wcat-open"><i class="fa-solid fa-globe"></i> Открыть каталог</div>
        </div>
        <label class="wcat-target-row">Куда добавлять «+»:
            <select class="text_pole wcat-target-set">
                <option value="bot">В гардероб бота (общий)</option>
                <option value="user">В гардероб юзера (общий)</option>
                <option value="download">Только скачать картинку и скопировать описание</option>
            </select>
        </label>
        <small>Адрес сайта или прямая ссылка на wardrobe.json.</small>
        <hr>
        <b><i class="fa-solid fa-face-smile"></i> Внешности персонажей</b>
        <label class="wcat-target-row">Ссылка на сайт с внешностями:
            <input type="text" class="text_pole wcat-looks-url" placeholder="https://…/wardrobe/">
        </label>
        <label class="wcat-target-row">Блок ExtBlocks (его Context Builder):
            <input type="text" class="text_pole wcat-eb-name" placeholder="nai_imagen">
        </label>
        <div class="flex-container">
            <div class="menu_button wcat-looks-open"><i class="fa-solid fa-face-smile"></i> Открыть внешности</div>
        </div>
        <small>Раздел «Внешности» с сайта (wardrobe.json → looks). Кнопка в окне отправляет описание в Context Builder выбранного блока.</small>`;
    root.querySelectorAll('.wcat-list-row[data-i]').forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector('.wcat-name').addEventListener('input', e => { s.catalogs[i].name = e.target.value; save(); });
        row.querySelector('.wcat-url').addEventListener('input', e => { s.catalogs[i].url = e.target.value.trim(); save(); });
        row.querySelector('.wcat-del').addEventListener('click', () => {
            if (s.catalogs.length <= 1) { toastr.info('Нужен хотя бы один каталог', 'Каталог образов'); return; }
            s.catalogs.splice(i, 1);
            if (s.index >= s.catalogs.length) s.index = 0;
            save(); renderSettings(root);
        });
    });
    const tsel = root.querySelector('.wcat-target-set');
    tsel.value = s.target;
    tsel.addEventListener('change', e => { s.target = e.target.value; save(); });
    const lu = root.querySelector('.wcat-looks-url');
    lu.value = s.looksUrl;
    lu.addEventListener('input', e => { s.looksUrl = e.target.value.trim(); save(); });
    const en = root.querySelector('.wcat-eb-name');
    en.value = s.ebBlockName;
    en.addEventListener('input', e => { s.ebBlockName = e.target.value.trim(); s.ebBlockRef = ''; save(); });
    root.querySelector('.wcat-looks-open').addEventListener('click', () => openLooksWindow());
    root.querySelector('.wcat-add').addEventListener('click', () => {
        s.catalogs.push({ name: 'Новый каталог', url: '' });
        save(); renderSettings(root);
    });
    root.querySelector('.wcat-open').addEventListener('click', () => {
        const clean = getSettings();
        if (clean.catalogs.some(c => !c.url.trim())) toastr.info('У одного из каталогов пустой адрес — он пропущен', 'Каталог образов');
        openCatalog();
    });
}

function addSettingsPanel() {
    if (document.getElementById('wcat_settings')) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'wcat_settings';
    wrap.className = 'extension_container';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Каталог образов</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content"><div id="wcat_settings_body"></div></div>
        </div>`;
    host.appendChild(wrap);
    renderSettings(wrap.querySelector('#wcat_settings_body'));
}

function addMenuButton() {
    if (document.getElementById('wcat_menu_button')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const btn = document.createElement('div');
    btn.id = 'wcat_menu_button';
    btn.className = 'list-group-item flex-container flexGap5';
    btn.innerHTML = '<div class="fa-solid fa-globe extensionsMenuExtensionButton"></div><span>Каталог образов</span>';
    btn.addEventListener('click', () => openCatalog());
    menu.appendChild(btn);

    if (document.getElementById('wcat_looks_menu_button')) return;
    const btn2 = document.createElement('div');
    btn2.id = 'wcat_looks_menu_button';
    btn2.className = 'list-group-item flex-container flexGap5';
    btn2.innerHTML = '<div class="fa-solid fa-face-smile extensionsMenuExtensionButton"></div><span>Внешности персонажей</span>';
    btn2.addEventListener('click', () => openLooksWindow());
    menu.appendChild(btn2);
}

(function init() {
    const c = ctx();
    getSettings();
    window.WardrobeCatalog = { open: openCatalog, openLooks: openLooksWindow };
    c.eventSource.on(c.event_types.APP_READY, () => {
        // Пункт меню добавляем независимо от панели настроек: сбой в одном не должен ломать другое.
        try { addMenuButton(); } catch (e) { console.error('[WCAT] menu button', e); }
        try { addSettingsPanel(); } catch (e) { console.error('[WCAT] settings panel', e); }
    });
    console.log('[WCAT] Каталог образов загружен');
})();
