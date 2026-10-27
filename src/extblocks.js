/**
 * Мост к расширению ExtBlocks (ключ настроек `ExtBlocks`).
 * Кладёт внешность в Context Builder ЛЮБОГО выбранного блока (generated / rewrite —
 * у них есть Context Builder; по умолчанию nai_imagen) текстовым пунктом `Имя`
 * по шаблону записи и умеет обновить/выключить/убрать его.
 */

export const DEFAULT_TEMPLATE = 'Как рисовать {{name}}:\n{{desc}}\n\nДУБЛИРУЙ ПОЛНОСТЬЮ ВСЕ ТЕГИ ВНЕШНОСТИ ЦЕЛИКОМ.';

/** Собрать текст записи из шаблона: {{name}} — имя, {{desc}} — теги/описание внешности. */
export function renderTemplate(template, look) {
    const t = (typeof template === 'string' && template.trim()) ? template : DEFAULT_TEMPLATE;
    const name = String(look.name || '').trim();
    const desc = String(look.desc || '').trim();
    let out = t.replace(/\{\{\s*name\s*\}\}/gi, () => name).replace(/\{\{\s*desc\s*\}\}/gi, () => desc);
    // если в шаблоне забыли {{desc}} — теги всё равно не теряем
    if (!/\{\{\s*desc\s*\}\}/i.test(t) && desc) out += '\n\n' + desc;
    return out.trim();
}

const EB = 'ExtBlocks';
const LEGACY_PREFIX = 'APPEARANCE: '; // старое имя пункта — только чтобы находить и переименовывать прежние записи

function ctx() { return SillyTavern.getContext(); }
function uid() { return (ctx().uuidv4 ? ctx().uuidv4() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }

export function extBlocksInstalled() {
    const s = ctx().extensionSettings?.[EB];
    return !!s && Array.isArray(s.sets);
}

function scopedArray() {
    const c = ctx();
    if (c.characterId === undefined) return null;
    const arr = c.characters?.[c.characterId]?.data?.extensions?.[EB];
    return Array.isArray(arr) ? arr : null;
}

/** Все блоки, куда можно положить внешность: [{ ref, label, block, scoped }]. */
export function listTargetBlocks() {
    if (!extBlocksInstalled()) return [];
    const s = ctx().extensionSettings[EB];
    const out = [];
    // Context Builder есть у generated и rewrite; у accumulation/script его нет.
    const ok = b => b && b.name && b.block_type !== 'accumulation' && b.block_type !== 'script'
        && (Array.isArray(b.context) || b.block_type === undefined || b.block_type === 'generated' || b.block_type === 'rewrite');
    const sc = scopedArray();
    if (sc) for (const b of sc) if (ok(b)) out.push({ ref: 's:' + b.id, label: `${b.name} (персонаж)`, block: b, scoped: true });
    s.sets.forEach((set, si) => {
        for (const b of (Array.isArray(set.global_blocks) ? set.global_blocks : [])) {
            if (ok(b)) out.push({ ref: `g:${si}:${b.id}`, label: s.sets.length > 1 ? `${b.name} · ${set.name}` : b.name, block: b, scoped: false });
        }
    });
    return out;
}

/** Выбрать блок по сохранённому ref, иначе по имени, иначе первый «generated». */
export function pickTarget(savedRef, savedName = 'nai_imagen') {
    const list = listTargetBlocks();
    return list.find(t => t.ref === savedRef)
        || list.find(t => t.block.name === savedName)
        || list[0]
        || null;
}

function findItem(block, look) {
    const ctxList = Array.isArray(block.context) ? block.context : [];
    const legacy = LEGACY_PREFIX + look.name;
    return ctxList.findIndex(it => it && (it.wcat_look === look.id || (it.type === 'text' && it.name === legacy)));
}

export function hasLook(block, look) {
    return findItem(block, look) >= 0;
}

export function isLookDisabled(block, look) {
    const i = findItem(block, look);
    return i >= 0 && !!block.context[i].disabled;
}

async function persist(target) {
    const c = ctx();
    if (target.scoped) {
        const arr = scopedArray();
        if (arr) await c.writeExtensionField(c.characterId, EB, arr);
    }
    c.saveSettingsDebounced();
}

/** Новая внешность встаёт в самый низ Context Builder, под всеми пунктами. */
function insertIndex(list) {
    return list.length;
}

/**
 * Отправить внешность в Context Builder.
 * @returns {Promise<'added'|'updated'>}
 */
export async function sendLook(target, look, template) {
    const block = target.block;
    if (!Array.isArray(block.context)) block.context = [];
    const text = renderTemplate(template, look);
    const i = findItem(block, look);
    if (i >= 0) {
        block.context[i].text = text;
        block.context[i].name = look.name;
        block.context[i].wcat_look = look.id;
        block.context[i].disabled = false;
        await persist(target);
        return 'updated';
    }
    block.context.splice(insertIndex(block.context), 0, {
        id: uid(),
        name: look.name,
        role: 'system',
        type: 'text',
        disabled: false,
        text,
        wcat_look: look.id,
    });
    await persist(target);
    return 'added';
}

export async function removeLook(target, look) {
    const block = target.block;
    const i = findItem(block, look);
    if (i < 0) return false;
    block.context.splice(i, 1);
    await persist(target);
    return true;
}

/** Включить/выключить пункт, не удаляя (удобно, когда персонажа нет в сцене). */
export async function toggleLook(target, look) {
    const block = target.block;
    const i = findItem(block, look);
    if (i < 0) return null;
    block.context[i].disabled = !block.context[i].disabled;
    await persist(target);
    return !block.context[i].disabled;
}
