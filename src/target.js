/**
 * Подключение к оригинальной расширке-гардеробу (ключ настроек `silly_wardrobe`).
 * Образ кладётся в «Общий» гардероб бота или юзера. Картинка уходит в файл на сервере
 * Таверны (imagePath), а не в base64 внутри настроек — так Таверна не тяжелеет.
 */

import { catalogResolveType } from './catalog.js';

const SW = 'silly_wardrobe';
const FALLBACK_TYPE = 'other';
const DEFAULT_ICONS = { casual: 'fa-shirt', formal: 'fa-gem', sport: 'fa-person-running', sleep: 'fa-bed', beach: 'fa-umbrella-beach', work: 'fa-briefcase', outer: 'fa-mitten' };

function ctx() { return SillyTavern.getContext(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 8); }

export function wardrobeInstalled() {
    return !!ctx().extensionSettings?.[SW];
}

function sw() {
    return ctx().extensionSettings?.[SW] || null;
}

function listKey(side) { return side === 'user' ? 'sharedUserWardrobe' : 'sharedBotWardrobe'; }
function useKey(side) { return side === 'user' ? 'useSharedUserWardrobe' : 'useSharedBotWardrobe'; }

/** Id образов каталога, которые уже лежат в гардеробе (для галочек). */
export function addedFromWardrobe(dataUrl) {
    const s = sw();
    const out = new Set();
    if (!s) return out;
    for (const side of ['bot', 'user']) {
        for (const o of (Array.isArray(s[listKey(side)]) ? s[listKey(side)] : [])) {
            if (o?.catalogSrc === dataUrl && o.catalogId) out.add(String(o.catalogId));
        }
    }
    return out;
}

function ensureType(key) {
    const s = sw();
    if (!s || !Array.isArray(s.outfitTypes) || !String(key || '').trim()) return FALLBACK_TYPE;
    const { suggestion, existing } = catalogResolveType(key, s.outfitTypes);
    if (existing) return existing.id;
    const label = String(key).trim();
    const tag = suggestion.builtin
        ? { id: suggestion.id, label: label.charAt(0).toLocaleUpperCase() + label.slice(1, 24), icon: DEFAULT_ICONS[suggestion.id] || 'fa-tag' }
        : { id: suggestion.id, label: suggestion.label, icon: suggestion.icon };
    const fb = s.outfitTypes.findIndex(t => t.id === FALLBACK_TYPE);
    if (fb >= 0) s.outfitTypes.splice(fb, 0, tag); else s.outfitTypes.push(tag);
    return tag.id;
}

function blobToJpegBase64(blob, maxDim, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth, h = img.naturalHeight;
            if (w > maxDim || h > maxDim) {
                const k = maxDim / Math.max(w, h);
                w = Math.round(w * k); h = Math.round(h * k);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
            canvas.width = canvas.height = 0; // отдать память сразу
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку')); };
        img.src = url;
    });
}

async function uploadToTavern(base64, label) {
    const c = ctx();
    const safe = String(label).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) || 'outfit';
    const filename = `sw_${safe}_${Date.now()}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: c.getRequestHeaders(),
        body: JSON.stringify({ image: base64, format: 'png', ch_name: 'iig_refs', filename }),
    });
    if (!response.ok) throw new Error(`Не загрузилось на сервер: ${response.status}`);
    return (await response.json()).path;
}

/**
 * @returns {Promise<{ok:true, warn?:string}>}
 */
export async function addToWardrobe(side, outfit, blob, c) {
    const s = sw();
    if (!s) throw new Error('Оригинальный гардероб не найден (нет настроек silly_wardrobe). Открой его один раз.');
    const key = listKey(side);
    if (!Array.isArray(s[key])) s[key] = [];
    const maxDim = Number(s.maxDimension) > 0 ? Number(s.maxDimension) : 512;
    const base64 = await blobToJpegBase64(blob, maxDim);
    const prefix = side === 'user' ? 'sw_user_' : 'sw_bot_';
    const imagePath = await uploadToTavern(base64, prefix + (outfit.name || 'item'));
    s[key].push({
        id: uid(),
        name: outfit.name,
        type: ensureType(outfit.key),
        description: outfit.desc || '',
        addedAt: Date.now(),
        imagePath,
        catalogId: outfit.id,
        catalogSrc: c.dataUrl,
    });
    ctx().saveSettingsDebounced();
    return { ok: true, warn: s[useKey(side)] ? '' : 'Включи «Общий» в гардеробе, чтобы увидеть этот образ.' };
}
