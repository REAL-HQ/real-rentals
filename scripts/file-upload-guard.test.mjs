// Existing file entrypoints have explicit drop ownership. The root bridge only
// prevents accidental navigation; it never infers a destination from the DOM.
import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const allowed=new Set(['src/components/FileUploader.tsx','src/components/site/ApplicationWizard.tsx']);let count=0;const owners=new Set();
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const file=dir+'/'+e.name;if(e.isDirectory()){walk(file);continue}if(!/\.[jt]sx?$/.test(file))continue;const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);function visit(n){if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const type=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text==='type');if(type?.initializer&&ts.isStringLiteral(type.initializer)&&type.initializer.text==='file'){assert(allowed.has(file),'Use FileUploader instead of adding a raw input: '+file);count++;owners.add(file)}}ts.forEachChild(n,visit)}visit(tree)}}walk('src');assert.equal(count,4,'Two shared chooser/camera inputs plus two explicit wizard inputs');assert.equal(owners.size,2);console.log('file-upload-guard: 4 actual JSX file inputs / 2 files (comments and string selectors excluded)');
