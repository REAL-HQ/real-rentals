/** Render the real shared badge: noninteractive uses must never imply a menu. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const result = await build({entryPoints:['src/components/admin/ui.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic'});
const { StatusPill } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let checks=0;
for(const status of ['new','reviewing','approved','active','declined','onboarding',null]) {
  const plain=renderToStaticMarkup(createElement(StatusPill,{status}));
  const interactive=renderToStaticMarkup(createElement(StatusPill,{status,caret:true}));
  assert(!plain.includes('<svg'),`${status}: read-only badge has no caret`); checks++;
  assert.equal((interactive.match(/<svg/g)||[]).length,1); checks++;
  assert(interactive.includes('h-3 w-3 shrink-0')); checks++;
  assert.equal(interactive.replace(/<svg[\s\S]*?<\/svg>/,''),plain,
    `${status}: adding caret preserves exact label, colors and badge styling`); checks++;
}
console.log(`${checks} StatusPill rendering checks passed`);
