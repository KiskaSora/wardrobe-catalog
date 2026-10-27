import { catalogUrls, parseLooks } from './catalog.js';
import { loadCatalogJson } from './catalogUi.js';
import { extBlocksInstalled, listTargetBlocks, pickTarget, sendLook, removeLook, toggleLook, hasLook, isLookDisabled, renderTemplate, DEFAULT_TEMPLATE } from './extblocks.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Окно «Внешности»: список внешностей с сайта (wardrobe.json → looks)
 * и кнопки отправки в Context Builder выбранного блока ExtBlocks.
 * adapters: { url, getBlockRef, getBlockName, onBlock(ref), getTemplate, onTemplate(text), copy(text) }
 */
export function openLooks(adapters) {
    const { url, getBlockRef, getBlockName, onBlock, getTemplate, onTemplate, copy } = adapters;
    const { site, data: dataUrl } = catalogUrls(url);
    document.getElementById('wcat-l-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wcat-l-overlay';
    overlay.className = 'wcat-s-overlay wcat-l-overlay';
    overlay.innerHTML = `
        <div class="wcat-s-modal wcat-l-modal">
            <div class="wcat-s-modal-head">
                <span class="wcat-s-modal-title"><i class="fa-solid fa-face-smile"></i> Внешности</span>
                <a class="wcat-s-source-link" href="${esc(site)}" target="_blank" rel="noopener" title="Открыть сайт"><i class="fa-solid fa-arrow-up-right-from-square"></i> Сайт</a>
                <div class="wcat-s-refresh menu_button wcat-l-refresh" title="Обновить"><i class="fa-solid fa-rotate"></i></div>
                <div class="wcat-s-refresh menu_button wcat-l-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="wcat-l-targetrow"><span>Context Builder блока:</span><select class="text_pole wcat-l-block"></select></div>
            <details class="wcat-l-tpl">
                <summary><i class="fa-solid fa-pen-to-square"></i> Шаблон записи</summary>
                <textarea class="text_pole wcat-l-tpl-text" rows="5"></textarea>
                <small>{{name}} — имя персонажа, {{desc}} — все теги внешности целиком.</small>
                <div class="menu_button wcat-l-tpl-reset"><i class="fa-solid fa-rotate-left"></i> Вернуть стандартный</div>
            </details>
            <details class="wcat-l-custom">
                <summary><i class="fa-solid fa-user-plus"></i> Своя запись (без сайта)</summary>
                <input type="text" class="text_pole wcat-l-c-name" placeholder="Имя персонажа">
                <textarea class="text_pole wcat-l-c-desc" rows="4" placeholder="Теги внешности — вставятся целиком"></textarea>
                <div class="menu_button wcat-l-c-send"><i class="fa-solid fa-paper-plane"></i> В Context Builder</div>
            </details>
            <div class="wcat-s-body wcat-l-body"><div class="wcat-s-loading">Загрузка внешностей…</div></div>
        </div>`;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector('.wcat-l-modal');
    const bodyEl = overlay.querySelector('.wcat-l-body');
    const blockSel = overlay.querySelector('.wcat-l-block');
    let looks = [];
    const tplEl = overlay.querySelector('.wcat-l-tpl-text');
    tplEl.value = getTemplate() || DEFAULT_TEMPLATE;
    tplEl.addEventListener('input', () => { onTemplate(tplEl.value); });
    tplEl.addEventListener('change', () => render());
    overlay.querySelector('.wcat-l-tpl-reset').addEventListener('click', () => { tplEl.value = DEFAULT_TEMPLATE; onTemplate(''); render(); });
    const tpl = () => tplEl.value;

    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    function close() { document.removeEventListener('keydown', onKey, true); overlay.remove(); }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    for (const t of ['click', 'mousedown', 'pointerdown', 'pointerup']) modal.addEventListener(t, e => e.stopPropagation());
    for (const t of ['touchstart', 'touchend']) modal.addEventListener(t, e => e.stopPropagation(), { passive: true });
    overlay.querySelector('.wcat-l-close').addEventListener('click', close);

    const target = () => pickTarget(blockSel.value || getBlockRef(), getBlockName());

    function fillBlocks() {
        if (!extBlocksInstalled()) {
            blockSel.innerHTML = '<option value="">ExtBlocks не найден</option>';
            blockSel.disabled = true;
            return;
        }
        const list = listTargetBlocks();
        const cur = pickTarget(getBlockRef(), getBlockName());
        blockSel.innerHTML = list.length
            ? list.map(t => `<option value="${esc(t.ref)}" ${cur && cur.ref === t.ref ? 'selected' : ''}>${esc(t.label)}</option>`).join('')
            : '<option value="">Нет блоков</option>';
        blockSel.disabled = !list.length;
    }
    blockSel.addEventListener('change', () => { onBlock(blockSel.value); render(); });

    function card(l) {
        const t = target();
        const inBlock = !!(t && hasLook(t.block, l));
        const off = inBlock && isLookDisabled(t.block, l);
        return `<article class="wcat-l-card ${inBlock ? (off ? 'wcat-l-off' : 'wcat-l-in') : ''}" data-id="${esc(l.id)}">
            <div class="wcat-l-head">
                <b class="wcat-l-name">${esc(l.name)}</b>
                ${inBlock ? `<span class="wcat-l-state"><i class="fa-solid ${off ? 'fa-eye-slash' : 'fa-circle-check'}"></i> ${off ? 'выключена' : 'в блоке'}</span>` : ''}
            </div>
            <div class="wcat-l-desc" data-act="expand" title="Показать целиком">${l.desc ? esc(renderTemplate(tpl(), l)) : '<i>Описания пока нет</i>'}</div>
            <div class="wcat-l-actions">
                <button type="button" class="menu_button wcat-l-send" data-act="send" ${l.desc && t ? '' : 'disabled'}><i class="fa-solid fa-paper-plane"></i> ${inBlock ? 'Обновить в блоке' : 'В Context Builder'}</button>
                ${inBlock ? `<button type="button" class="menu_button" data-act="toggle" title="${off ? 'Включить пункт' : 'Выключить пункт'}"><i class="fa-solid ${off ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                <button type="button" class="menu_button" data-act="remove" title="Убрать из блока"><i class="fa-solid fa-trash"></i></button>` : ''}
                <button type="button" class="menu_button" data-act="copy" title="Копировать запись целиком" ${l.desc ? '' : 'disabled'}><i class="fa-solid fa-copy"></i></button>
            </div>
        </article>`;
    }

    function render() {
        if (!looks.length) {
            bodyEl.innerHTML = '<div class="wcat-s-loading">На сайте пока нет внешностей (раздел «Внешности»)</div>';
            return;
        }
        bodyEl.innerHTML = `<div class="wcat-l-list">${looks.map(card).join('')}</div>`;
        for (const el of bodyEl.querySelectorAll('.wcat-l-card')) {
            const look = looks.find(x => x.id === el.dataset.id);
            if (!look) continue;
            el.querySelector('[data-act="expand"]').addEventListener('click', e => e.currentTarget.classList.toggle('wcat-l-open'));
            el.querySelector('[data-act="copy"]').addEventListener('click', async () => {
                const ok = await copy(renderTemplate(tpl(), look));
                ok ? toastr.success('Запись скопирована', 'Каталог образов', { timeOut: 1800 }) : toastr.error('Не удалось скопировать', 'Каталог образов');
            });
            el.querySelector('[data-act="send"]').addEventListener('click', async () => {
                const t = target();
                if (!t) return toastr.error('Не выбран блок ExtBlocks', 'Каталог образов');
                try {
                    const res = await sendLook(t, look, tpl());
                    onBlock(t.ref);
                    toastr.success(res === 'added' ? `«${look.name}» добавлена в Context Builder` : `«${look.name}» обновлена в Context Builder`, 'Каталог образов', { timeOut: 2500 });
                    render();
                } catch (e) { toastr.error('Не удалось: ' + String(e.message || e), 'Каталог образов'); }
            });
            el.querySelector('[data-act="toggle"]')?.addEventListener('click', async () => {
                const t = target();
                if (t) { await toggleLook(t, look); render(); }
            });
            el.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
                const t = target();
                if (t) { await removeLook(t, look); toastr.info('Убрана из Context Builder', 'Каталог образов', { timeOut: 1800 }); render(); }
            });
        }
    }

    async function load(force = false) {
        bodyEl.innerHTML = '<div class="wcat-s-loading">Загрузка внешностей…</div>';
        try {
            looks = parseLooks(await loadCatalogJson(dataUrl, force));
            if (!overlay.isConnected) return;
            fillBlocks();
            render();
        } catch (e) {
            if (overlay.isConnected) bodyEl.innerHTML = `<p class="hint" style="padding:16px;">Не удалось загрузить (${esc(dataUrl)}): ${esc(e.message || e)}</p>`;
        }
    }

    overlay.querySelector('.wcat-l-c-send').addEventListener('click', async () => {
        const name = overlay.querySelector('.wcat-l-c-name').value.trim();
        const desc = overlay.querySelector('.wcat-l-c-desc').value.trim();
        if (!name || !desc) return toastr.error('Нужны имя и теги', 'Каталог образов');
        const t = target();
        if (!t) return toastr.error('Не выбран блок ExtBlocks', 'Каталог образов');
        try {
            const look = { id: 'custom:' + name.toLowerCase(), name, desc };
            const res = await sendLook(t, look, tpl());
            onBlock(t.ref);
            toastr.success(res === 'added' ? `«${name}» добавлена в Context Builder` : `«${name}» обновлена в Context Builder`, 'Каталог образов', { timeOut: 2500 });
            render();
        } catch (e) { toastr.error('Не удалось: ' + String(e.message || e), 'Каталог образов'); }
    });
    overlay.querySelector('.wcat-l-refresh').addEventListener('click', () => load(true));
    fillBlocks();
    load();
    return { close };
}
