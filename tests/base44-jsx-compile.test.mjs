import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const pages=[
 "integrations/base44/pages/GateKeeper.jsx",
 "integrations/base44/components/AdversarialLab.jsx",
 "integrations/base44/components/ControlDeck.jsx",
 "integrations/base44/components/LearningLab.jsx",
 "integrations/base44/components/GateKeeperConnectionPanel.jsx",
 "integrations/base44/components/GateKeeperBenchmark.jsx",
];

for(const path of pages){
 test(path+" parses as JSX and resolves local styles",()=>{
  const absolute=resolve(root,path);
  const source=readFileSync(absolute,"utf8");
  const result=ts.transpileModule(source,{
    fileName:path,
    reportDiagnostics:true,
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,allowJs:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
  });
  const failures=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.deepEqual(failures.map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[]);
  assert.match(result.outputText,/function|export|const/);
  for(const match of source.matchAll(/import\s+["'](\.\/[^"']+\.css)["']/g))
    assert.equal(existsSync(resolve(dirname(absolute),match[1])),true,match[1]+" should exist");
 });
}
