import assert from 'node:assert/strict';
let saved = 0;
const sets = [{ name: 'Default', global_blocks: [
  { id: 'a', name: 'nai_imagen', block_type: 'generated', context: [{ id: 'c1', name: 'CLUE: char', type: 'text', role: 'system', text: 'x' }] },
  { id: 'b', name: 'Another', block_type: 'generated', context: [] },
  { id: 'r', name: 'Rew', block_type: 'rewrite', context: [] },
  { id: 'ac', name: 'Acc', block_type: 'accumulation' },
  { id: 'sc', name: 'Scr', block_type: 'script' },
]}];
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { ExtBlocks: { sets } }, characterId: undefined, saveSettingsDebounced: () => { saved++; }, uuidv4: () => 'id' + Math.random() }) };
const { listTargetBlocks, pickTarget, sendLook, removeLook, toggleLook, renderTemplate, DEFAULT_TEMPLATE } = await import('../src/extblocks.js');

const look = { id: 'l1', name: 'Сора', desc: '1girl, long hair\nblue eyes' };
assert.equal(renderTemplate('', look), 'Как рисовать Сора:\n1girl, long hair\nblue eyes\n\nДУБЛИРУЙ ПОЛНОСТЬЮ ВСЕ ТЕГИ ВНЕШНОСТИ ЦЕЛИКОМ.');
assert.ok(renderTemplate('Рисуй {{name}}', look).endsWith('blue eyes'));

assert.deepEqual(listTargetBlocks().map(t => t.block.name), ['nai_imagen', 'Another', 'Rew']);
for (const name of ['nai_imagen', 'Another', 'Rew']) {
  const t = pickTarget('', name);
  assert.equal(await sendLook(t, look, DEFAULT_TEMPLATE), 'added');
  assert.equal(await sendLook(t, look, DEFAULT_TEMPLATE), 'updated');
  assert.equal(t.block.context.filter(i => i.name === 'Сора').length, 1);
}
const nai = pickTarget('', 'nai_imagen').block;
assert.equal(nai.context[nai.context.length - 1].name, 'Сора'); // в самом низу
assert.ok(nai.context[1].text.includes('ДУБЛИРУЙ ПОЛНОСТЬЮ'));
assert.equal(await toggleLook(pickTarget('', 'Rew'), look), false);
assert.equal(await removeLook(pickTarget('', 'Rew'), look), true);
assert.ok(saved > 0);
console.log('extblocks: PASS');
