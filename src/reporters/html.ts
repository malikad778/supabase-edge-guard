import { frameworkLabel } from '../core/framework-detect.js';
import { computeScore } from '../core/score.js';
import { VERSION } from '../core/version.js';
import { lovablePromptReporter } from './lovable-prompt.js';
import type { Reporter } from './types.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root{--bg:#fff;--fg:#14181f;--muted:#5b6575;--card:#f5f7fa;--line:#dde3ea;--err:#c62828;--warn:#b26a00;--info:#0b6bcb;--ok:#1b7f3b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--fg:#e8edf3;--muted:#9aa6b6;--card:#171d25;--line:#2a323d;--err:#ff6b6b;--warn:#ffb454;--info:#6cb6ff;--ok:#4cd07d}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:22px}.sub{color:var(--muted);margin:0 0 20px}
.score{display:flex;gap:16px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.grade{font-size:44px;font-weight:700;line-height:1}.bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer}
button[aria-pressed=true]{border-color:var(--info);outline:1px solid var(--info)}
.f{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
.f.error{border-left-color:var(--err)}.f.warning{border-left-color:var(--warn)}.f.info{border-left-color:var(--info)}
.f h3{margin:0 0 4px;font-size:15px}.tag{font-weight:700;margin-right:6px}.error .tag{color:var(--err)}.warning .tag{color:var(--warn)}.info .tag{color:var(--info)}
code,pre{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;overflow:auto;margin:8px 0 0}
.loc{color:var(--muted);font-size:13px}a{color:var(--info)}.hidden{display:none}
`;

const JS = `
(function(){
  var active={error:true,warning:true,info:true};
  document.querySelectorAll('[data-sev]').forEach(function(b){
    b.addEventListener('click',function(){
      var s=b.getAttribute('data-sev');active[s]=!active[s];b.setAttribute('aria-pressed',String(active[s]));
      document.querySelectorAll('.f').forEach(function(f){f.classList.toggle('hidden',!active[f.getAttribute('data-s')]);});
    });
  });
  var copy=document.getElementById('copy');
  if(copy){copy.addEventListener('click',function(){
    var t=document.getElementById('prompt').value;
    function done(){copy.textContent='Copied!';setTimeout(function(){copy.textContent='Copy fix prompt for Lovable / Cursor';},1500);}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){fallback(t);done();});}
    else{fallback(t);done();}
  });}
  function fallback(t){var a=document.getElementById('prompt');a.hidden=false;a.select();try{document.execCommand('copy');}catch(e){}a.hidden=true;}
})();
`;

export const htmlReporter: Reporter = (result, opts) => {
  const s = computeScore(result.findings);
  const prompt = lovablePromptReporter(result, opts);
  const items = result.findings
    .map(
      (f) => `<article class="f ${f.severity}" data-s="${f.severity}">
<h3><span class="tag">${esc(f.ruleId)}</span>${esc(f.message)}</h3>
<div class="loc"><code>${esc(f.file)}:${f.line}:${f.column}</code> · <a href="${esc(f.docsUrl)}">docs</a>${f.fix ? ` · <b>${f.fix.safe ? 'safe fix available' : 'unsafe fix available'}</b>` : ''}</div>
${f.snippet ? `<pre>${esc(f.snippet)}</pre>` : ''}
${(f.related ?? []).map((r) => `<div class="loc">↳ <code>${esc(r.file)}:${r.line}</code> - ${esc(r.note)}</div>`).join('')}
</article>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>supabase-edge-guard report</title><style>${CSS}</style></head>
<body><main>
<h1>supabase-edge-guard</h1>
<p class="sub">v${esc(VERSION)} · ${esc(frameworkLabel(result.framework))} · ${result.stats.tsFiles} TS files · ${result.stats.migrations} migrations</p>
<section class="score"><div class="grade">${result.grade}</div><div><b>${result.score}/100</b><br>${s.errors} errors · ${s.warnings} warnings · ${s.infos} info</div></section>
<div class="bar">
<button data-sev="error" aria-pressed="true">Errors (${s.errors})</button>
<button data-sev="warning" aria-pressed="true">Warnings (${s.warnings})</button>
<button data-sev="info" aria-pressed="true">Info (${s.infos})</button>
<button id="copy" type="button">Copy fix prompt for Lovable / Cursor</button>
</div>
${items || '<p>✅ No issues found.</p>'}
<textarea id="prompt" hidden>${esc(prompt)}</textarea>
</main><script>${JS}</script></body></html>
`;
};
