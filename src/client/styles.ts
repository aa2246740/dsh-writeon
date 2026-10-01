/**
 * Workspace stylesheet — injected once at apply() and removed with the plugin
 * fiber's teardown effect. Design tokens per the Write On spec: canvas
 * #080B1E, panel #10152B, border #272C46, ink #BEB4AC, strong #D3C6BA,
 * muted #6E7187, accent #AA926C, active #D2CBED.
 * The three dimming models use three distinct opacities: ghost .12,
 * trim preview .18, panel-focus .40 — never shared.
 */
export const css = `
.wo-root{display:flex;flex-direction:column;height:100%;min-height:0;background:#080B1E;color:#BEB4AC;
  font-family:ui-serif,'Iowan Old Style','Songti SC','SimSun',serif;overflow:hidden}
.wo-root *{box-sizing:border-box}
.wo-toolbar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #272C46;
  background:#10152B;flex:0 0 auto}
.wo-toolbar.wo-hidden > *:not(.wo-keep){opacity:.35}
.wo-flex{flex:1}
.wo-sep{width:1px;height:18px;background:#272C46;margin:0 4px}
.wo-btn{background:#10152B;border:1px solid #272C46;color:#BEB4AC;border-radius:6px;padding:5px 12px;
  cursor:pointer;font-family:inherit;font-size:13px;transition:border-color .15s,color .15s}
.wo-btn:hover{border-color:#AA926C;color:#D3C6BA}
.wo-btn:disabled{opacity:.4;cursor:default}
.wo-btn.wo-small{padding:3px 9px;font-size:12px}
.wo-btn.wo-mini{padding:1px 7px;font-size:11px;border-radius:4px}
.wo-body{display:flex;flex:1;min-height:0}
.wo-docbar{width:200px;flex:0 0 auto;border-right:1px solid #272C46;background:#10152B;display:flex;
  flex-direction:column;padding:8px;gap:8px;overflow-y:auto}
.wo-doclist{display:flex;flex-direction:column;gap:2px;flex:1}
.wo-docitem{display:flex;align-items:center;gap:4px;width:100%;text-align:left;background:none;border:none;
  color:#6E7187;padding:6px 8px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}
.wo-docitem:hover{color:#BEB4AC;background:#1a2036}
.wo-docitem.active{color:#D3C6BA;background:#1a2036}
.wo-docitem-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wo-docitem-del{color:#6E7187;visibility:hidden}
.wo-docitem:hover .wo-docitem-del{visibility:visible}
.wo-docbar-io{display:flex;gap:6px}
.wo-canvas{flex:1;display:flex;flex-direction:column;min-width:0}
.wo-conflict{margin:8px auto;padding:8px 14px;border:1px solid #AA926C;border-radius:6px;color:#D3C6BA;
  background:#1a2036;font-size:12px;max-width:680px}
.wo-editorwrap{flex:1;overflow-y:auto;display:flex;justify-content:center;padding:24px 16px}
.wo-editor{width:100%;max-width:680px;outline:none}
.wo-editor .ProseMirror{outline:none;min-height:60vh;font-family:ui-monospace,'SF Mono',Menlo,'Sarasa Mono SC',monospace;
  font-size:17px;line-height:1.8;color:#BEB4AC;caret-color:#D2CBED}
.wo-editor .ProseMirror p{margin:0 0 1em}
.wo-editor .ProseMirror h1,.wo-editor .ProseMirror h2,.wo-editor .ProseMirror h3{color:#D3C6BA;margin:1.2em 0 .6em}
.wo-editor .ProseMirror ::selection{background:#2a3355}
.wo-editor .ProseMirror .ProseMirror-selectednode{outline:1px solid #AA926C}
/* variant boundary markers — thin brackets, visible but quiet */
.wovstart,.wovend{display:inline-block;width:0;overflow:visible;position:relative;color:#AA926C;user-select:none}
.wovstart::before{content:'⟨';opacity:.7}
.wovend::before{content:'⟩';opacity:.7}
/* paragraph variants: left-edge mark, never an underline */
.wovblock{border-left:2px solid #AA926C;padding-left:10px;margin-left:-12px}
/* ghost dim — model 1: manual ghost, opacity .12 */
.woghost{opacity:.12}
/* trim preview — model 2: AI trim, opacity .18 + dashed bottom edge */
.wod-trim{opacity:.18;border-bottom:1px dashed #AA926C}
/* panel focus dim — model 3: everything outside the focused group, .40 */
.wod-focusdim{opacity:.40}
/* diagnostics underline styles per goal */
.wod-diag{border-bottom:1px dotted #AA926C}
.wod-diag.weakest-sentences{border-bottom-color:#c77}
.wod-diag.long-sentences{border-bottom-color:#cc7}
.wod-diag.convoluted-sentences{border-bottom-color:#c7c}
.wod-diag.tone-misfit{border-bottom-color:#7cc}
.wod-diag.hedges-filler{border-bottom-color:#7c7}
.wod-hint{background:#1a2036}
.wo-stats{display:flex;align-items:center;gap:14px;padding:6px 12px;border-top:1px solid #272C46;
  background:#10152B;font-size:11px;color:#6E7187;flex:0 0 auto}
.wo-savestate{margin-left:auto}
.wo-save-clean{color:#6E7187}
.wo-save-dirty{color:#AA926C}
.wo-save-saving{color:#6E7187}
.wo-save-error{color:#c77}
.wo-modelpick{display:flex;align-items:center;gap:6px}
.wo-modelpick select{background:#080B1E;color:#BEB4AC;border:1px solid #272C46;border-radius:4px;
  font-size:11px;max-width:220px;font-family:inherit}
.wo-busy{color:#AA926C;animation:wopulse 1.4s ease-in-out infinite}
@keyframes wopulse{0%,100%{opacity:.5}50%{opacity:1}}
.wo-side{width:240px;flex:0 0 auto;border-left:1px solid #272C46;background:#10152B;overflow-y:auto;
  padding:10px;display:flex;flex-direction:column;gap:8px}
.wo-side-head{font-size:12px;color:#AA926C;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px}
.wo-side-empty{color:#6E7187;font-size:12px;padding:8px 0}
.wo-group{border:1px solid #272C46;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}
.wo-group-head{display:flex;align-items:center;gap:4px;cursor:pointer}
.wo-group-scope{font-size:10px;color:#6E7187;text-transform:uppercase;letter-spacing:.08em;flex:1}
.wo-opt{display:flex;align-items:flex-start;gap:6px;padding:4px 6px;border-radius:6px;font-size:13px}
.wo-opt.active{background:#1a2036}
.wo-opt-badge{font-size:10px;color:#AA926C;flex:0 0 auto;padding-top:3px}
.wo-opt-text{flex:1;cursor:pointer;word-break:break-word;line-height:1.5}
.wo-opt-text:hover{color:#D3C6BA}
.wo-opt-acts{display:flex;gap:4px;flex:0 0 auto;visibility:hidden}
.wo-opt:hover .wo-opt-acts{visibility:visible}
.wo-group-acts{display:flex;gap:6px;margin-top:2px}
.wo-ovitem{border:1px solid #272C46;border-radius:8px;padding:8px;cursor:grab;display:flex;
  flex-direction:column;gap:6px}
.wo-ov-text{font-size:13px;line-height:1.6;max-height:120px;overflow:hidden}
.wo-ov-acts{display:flex;gap:4px}
.wo-lab-goal{width:100%;text-align:left;margin-bottom:4px}
.wo-trimrow{display:flex;align-items:center;gap:6px;font-size:12px;color:#6E7187;margin:8px 0}
.wo-run{border:1px solid #272C46;border-radius:8px;padding:8px;font-size:12px;display:flex;flex-direction:column;gap:6px}
.wo-run-head{color:#AA926C;font-size:11px}
.wo-prop{padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12px;line-height:1.5}
.wo-prop:hover{background:#1a2036}
.wo-prop-keep{opacity:.4;text-decoration:line-through}
.wo-prop-skip{opacity:.4}
.wo-prop-q{display:block;color:#BEB4AC}
.wo-prop-r{display:block;color:#6E7187;font-size:11px}
.wo-prop-a{display:block;color:#D2CBED;font-size:11px}
.wo-prop-acts{display:flex;gap:4px;margin-top:4px}
.wo-reviewbar{display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid #272C46;padding-top:8px}
.wo-overlay{position:fixed;inset:0;background:rgba(4,6,16,.72);display:flex;align-items:center;
  justify-content:center;z-index:1000}
.wo-dialog{background:#10152B;border:1px solid #272C46;border-radius:10px;max-width:560px;width:90%;
  padding:18px;display:flex;flex-direction:column;gap:10px}
.wo-dialog-head{color:#D3C6BA;font-size:16px}
.wo-dialog-body{color:#BEB4AC;font-size:13px;line-height:1.6}
.wo-share-text{background:#080B1E;border:1px solid #272C46;border-radius:6px;padding:10px;
  font-size:12px;line-height:1.6;max-height:240px;overflow:auto;white-space:pre-wrap;color:#BEB4AC;
  font-family:inherit}
.wo-dialog-stats{color:#6E7187;font-size:11px}
.wo-dialog-acts{display:flex;gap:8px;position:relative}
.wo-notice{position:fixed;bottom:52px;left:50%;transform:translateX(-50%);background:#10152B;
  border:1px solid #AA926C;color:#D3C6BA;padding:8px 16px;border-radius:8px;font-size:12px;z-index:1100}
.wo-expandbar{display:flex;gap:8px;align-items:center}
.wo-egg{transition:transform .18s ease}
.wo-egg-boom{animation:woboom .45s ease forwards}
@keyframes woboom{0%{transform:scale(1);opacity:1}60%{transform:scale(2.4);opacity:.6}100%{transform:scale(0);opacity:0}}
@media (prefers-reduced-motion: reduce){.wo-egg{transition:none}}
`
