/* Self-contained dashboard served by `dyno view`. Vanilla JS (no build step) so
 * it works anywhere; fetches run artifacts from the local /api endpoints.
 * The client script avoids backticks so it embeds cleanly in this TS literal. */

const STYLE = `
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--dim:#8b949e;
--cyan:#39c5cf;--green:#3fb950;--red:#f85149;--yellow:#d29922;--bar1:#58a6ff;--bar2:#bc8cff;--bar3:#3fb950;--bar4:#d29922;}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
.layout{display:flex;min-height:100vh}
.side{width:280px;border-right:1px solid var(--border);padding:16px;flex-shrink:0}
.side h1{font-size:15px;margin:0 0 2px}.side .tag{color:var(--dim);font-size:12px;margin-bottom:16px}
.run{padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;margin-bottom:4px}
.run:hover{background:var(--panel)}.run.active{background:var(--panel);border-color:var(--border)}
.run .kind{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--cyan)}
.run .lbl{font-weight:600}.run .when{color:var(--dim);font-size:11px}
.main{flex:1;padding:24px 32px;max-width:1100px}
.head{margin-bottom:20px}.head h2{margin:0 0 4px;font-size:20px}.head .meta{color:var(--dim);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.card h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--cyan)}
.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.row .k{color:var(--dim)}.row .v{font-variant-numeric:tabular-nums;font-weight:600}
.k[title]{cursor:help;border-bottom:1px dotted var(--border)}th[title]{cursor:help}
.bar{display:flex;height:22px;border-radius:6px;overflow:hidden;margin:8px 0;border:1px solid var(--border)}
.bar span{display:block;height:100%}.legend{font-size:12px;color:var(--dim);display:flex;flex-wrap:wrap;gap:12px}
.legend i{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:middle}
.est{color:var(--yellow);font-size:12px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;margin-top:6px}
th,td{text-align:right;padding:7px 10px;border-bottom:1px solid var(--border);font-size:13px}
th:first-child,td:first-child{text-align:left}th{color:var(--dim);font-weight:600}
.good{color:var(--green)}.bad{color:var(--red)}.muted{color:var(--dim)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}
.pill.yes{background:rgba(63,185,80,.15);color:var(--green)}.pill.no{background:rgba(210,153,34,.15);color:var(--yellow)}
.empty{color:var(--dim);margin-top:40px}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cmpbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:20px;font-size:13px}
.cmpbar .lbl{color:var(--dim)}
select{background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font:inherit;max-width:300px}
select[multiple]{height:auto;min-width:240px;vertical-align:top}
button{background:var(--cyan);color:#06222a;border:0;border-radius:7px;padding:6px 14px;font:inherit;font-weight:700;cursor:pointer}
button:hover{filter:brightness(1.1)}
.task{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.taskhead{margin-bottom:4px}
details.attempt{margin:4px 0;border-top:1px solid var(--border);padding-top:6px}
details.attempt summary{cursor:pointer}
.turn{margin:6px 0;white-space:pre-wrap;word-break:break-word}
.role{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--bar1);font-weight:700;margin-right:6px}
.role.asst{color:var(--bar3)}
.tool{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dim);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;margin:4px 0;white-space:pre-wrap;word-break:break-word}
.tool.err{color:var(--red);border-color:var(--red)}
.verdicts{margin-top:8px;border-top:1px dashed var(--border);padding-top:6px}
.verdict{margin:3px 0;font-size:13px}
.vb{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px}
.vb.PASS{background:rgba(63,185,80,.15);color:var(--green)}
.vb.PARTIAL{background:rgba(210,153,34,.15);color:var(--yellow)}
.vb.FAIL{background:rgba(248,81,73,.15);color:var(--red)}
`;

const SCRIPT = [
  "var $=function(s){return document.querySelector(s);};",
  "function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'})[c];});}",
  "function clip(s,n){s=String(s==null?'':s);return s.length>n?s.slice(0,n)+'\\u2026':s;}",
  "var fmt=function(n,d){return n==null?'n/a':Number(n).toLocaleString('en-US',{maximumFractionDigits:d||0,minimumFractionDigits:d||0});};",
  "var pct=function(v){return v==null?'n/a':(v*100).toFixed(0)+'%';};",
  "var usd=function(v){return v==null?'n/a':'$'+Number(v).toFixed(4);};",
  "var DEFS={",
  "'tokens/task (median)':'Median billable tokens per task (input + cache-creation + output; cache reads excluded).',",
  "'p90 \\u00b7 IQR':'90th-percentile and interquartile range of tokens/task \\u2014 tail cost and spread.',",
  "'tool calls':'Median number of MCP tool invocations per task.',",
  "'discovery RT':'Discovery round-trips/task \\u2014 exploratory calls (search/list/describe) before acting.',",
  "'refetch RT':'Refetch round-trips/task \\u2014 repeat calls to a tool already used in the same turn (inspect-then-retry).',",
  "'latency p50/p95':'Median and tail wall-clock time per task.',",
  "'$/task':'Cost per task. reported = from the Claude CLI; priced = token usage times the model price table.',",
  "'source':'Where cost came from: reported by the CLI, or priced from token usage.',",
  "'attributable':'Share of billable tokens attributable to the MCP surface vs the fixed system-prompt floor.',",
  "'floor tokens':'Tokens NOT attributable to the MCP (system prompt + scaffolding). Large in CLI mode.',",
  "'tool-def tokens':'Estimated tokens spent on tool definitions \\u2014 the schema cost paid up front.',",
  "'hallucinated/task':'Calls/task to tools that do not exist on the server.',",
  "'schema viol./task':'Tool calls/task whose arguments violate the tool input schema.',",
  "'tool errors/task':'Tool calls/task that returned an error.',",
  "'recovery':'Of attempts that hit a tool error, the share that still produced a final answer.',",
  "'pass-rate':'LLM-judge correctness: mean over criteria (PASS=1, PARTIAL=.5, FAIL=0). Indicative if criteria were auto-generated.',",
  "'first-call success':'Share of attempts whose FIRST tool call was a real tool with valid arguments and no error \\u2014 how learnable your tool surface is from descriptions alone.'};",
  "function row(k,v){var d=DEFS[k];var t=d?(' title=\"'+esc(d)+'\"'):'';return '<div class=row><span class=k'+t+'>'+k+'</span><span class=v>'+v+'</span></div>';}",
  "function card(title,body,extra){return '<div class=card><h3>'+title+(extra||'')+'</h3>'+body+'</div>';}",
  "function bloatBar(b){var s=b.shares;var seg=function(c,w){return '<span style=\"background:'+c+';width:'+(w*100)+'%\"></span>';};",
  "  return '<div class=bar>'+seg('var(--bar1)',s.toolDef)+seg('var(--bar2)',s.toolArg)+seg('var(--bar3)',s.toolResult)+seg('var(--bar4)',s.reasoning)+'</div>'+",
  "    '<div class=legend><span><i style=\"background:var(--bar1)\"></i>tool-defs '+pct(s.toolDef)+'</span>'+",
  "    '<span><i style=\"background:var(--bar2)\"></i>args '+pct(s.toolArg)+'</span>'+",
  "    '<span><i style=\"background:var(--bar3)\"></i>results '+pct(s.toolResult)+'</span>'+",
  "    '<span><i style=\"background:var(--bar4)\"></i>reasoning '+pct(s.reasoning)+'</span></div>';}",
  "function pillars(s){var e=s.efficiency,r=s.reliability;",
  "  var eff=card('Efficiency',row('tokens/task (median)',fmt(e.tokensMedian))+row('p90 \\u00b7 IQR',fmt(e.tokensP90)+' \\u00b7 '+fmt(e.tokensIqr))+row('tool calls',fmt(e.toolCallsMedian,1))+row('discovery RT',fmt(e.discoveryMean,1))+row('refetch RT',fmt(e.refetchMean,1))+row('latency p50/p95',fmt(e.latencyP50)+' / '+fmt(e.latencyP95)+' ms'));",
  "  var cost=card('Cost',row('$/task',usd(s.cost.perTaskMean))+row('source',s.cost.source));",
  "  var est=s.estimated?' <span class=est>*estimated</span>':'';",
  "  var bloat=card('Context-bloat',bloatBar(s.bloat)+row('attributable',pct(s.bloat.attributableShareMean))+row('floor tokens',fmt(s.bloat.floorTokensMean))+row('tool-def tokens',fmt(s.bloat.toolDefTokensMean)),est);",
  "  var rel=card('Reliability',row('hallucinated/task',fmt(r.hallucinatedRate,2))+row('schema viol./task',fmt(r.schemaViolationRate,2))+row('tool errors/task',fmt(r.toolErrorRate,2))+row('recovery',pct(r.recoveryRate)));",
  "  var corr=card('Correctness',s.correctness.judged?row('pass-rate',pct(s.correctness.scoreMean)):'<div class=muted>judge disabled</div>');",
  "  return '<div class=cards>'+eff+cost+bloat+rel+corr+'</div>';}",
  "function renderAttempt(a){",
  "  var head='epoch '+a.epoch+(a.failed?' \\u2014 FAILED: '+esc(a.error||''):(a.score!=null?' \\u2014 score '+Math.round(a.score*100)+'%':''));",
  "  var body='';",
  "  if(a.log&&a.log.turns){a.log.turns.forEach(function(t){",
  "    body+='<div class=turn><span class=role>user</span>'+esc(t.userPrompt)+'</div>';",
  "    (t.toolCalls||[]).forEach(function(c){body+='<div class=\"tool'+(c.isError?' err':'')+'\">\\u2192 '+esc(c.name)+'('+esc(clip(JSON.stringify(c.args),300))+') \\u21d2 '+esc(c.result)+'</div>';});",
  "    if(t.assistantText)body+='<div class=turn><span class=\"role asst\">assistant</span>'+esc(t.assistantText)+'</div>';",
  "  });}",
  "  if(a.judge&&a.judge.length){body+='<div class=verdicts>'+a.judge.map(function(v){return '<div class=verdict><span class=\"vb '+v.verdict+'\">'+v.verdict+'</span>'+esc(v.criterion)+' <span class=muted>\\u2014 '+esc(v.reason)+'</span></div>';}).join('')+'</div>';}",
  "  return '<details class=attempt><summary>'+head+'</summary>'+(body||'<div class=muted>no transcript captured</div>')+'</details>';}",
  "function renderTasks(attempts){if(!attempts||!attempts.length)return '';",
  "  var byId={};attempts.forEach(function(a){(byId[a.taskId]=byId[a.taskId]||[]).push(a);});",
  "  var html=Object.keys(byId).map(function(id){var list=byId[id];",
  "    var sc=list.filter(function(a){return a.score!=null;}).map(function(a){return a.score;});",
  "    var avg=sc.length?Math.round(sc.reduce(function(x,y){return x+y;},0)/sc.length*100)+'%':'\\u2014';",
  "    return '<div class=task><div class=taskhead><b>'+esc(id)+'</b> <span class=muted>score '+avg+' \\u00b7 '+list.length+' attempt(s)</span></div>'+list.map(renderAttempt).join('')+'</div>';",
  "  }).join('');",
  "  return card('Tasks &amp; transcripts',html);}",
  "function ergRow(t){var flags=[];if(t.heavyPayload)flags.push('<span class=\"pill no\">heavy payload</span>');if(t.firstCalls>=2&&(t.firstCallSchemaErrorRate>=0.25||t.firstCallErrorRate>=0.25))flags.push('<span class=\"pill no\">unclear</span>');",
  "  var ferr=Math.max(t.firstCallSchemaErrorRate,t.firstCallErrorRate);",
  "  return '<tr><td>'+esc(t.name)+'</td><td>'+fmt(t.calls)+'</td><td>'+fmt(t.resultTokensMean)+'</td><td>'+fmt(t.resultTokensMax)+'</td><td>'+pct(t.resultTokenShare)+'</td><td>'+pct(ferr)+'</td><td>'+(flags.join(' ')||'<span class=muted>\\u2014</span>')+'</td></tr>';}",
  "function renderErgonomics(e){if(!e||!e.perTool||!e.perTool.length)return '';",
  "  var work='';",
  "  if(e.heavyPayloadTools&&e.heavyPayloadTools.length)work+='<div class=row><span class=k title=\"Mean result tokens/call exceeds the heavy-payload threshold \\u2014 a candidate for pagination or field-selection.\">heavy payloads</span><span class=v>'+e.heavyPayloadTools.map(esc).join(', ')+'</span></div>';",
  "  if(e.unclearTools&&e.unclearTools.length)work+='<div class=row><span class=k title=\"Frequently mis-called on first reach \\u2014 the description/schema is unclear to the model.\">unclear tools</span><span class=v>'+e.unclearTools.map(esc).join(', ')+'</span></div>';",
  "  if(!work)work='<div class=muted>no design flags \\u2014 payloads lean, tools called correctly on first reach</div>';",
  "  var th='<tr><th>tool</th><th>calls</th><th title=\"Mean estimated tokens the tool returns per call (result-payload efficiency).\">res tok/call</th><th>max</th><th title=\"This tool\\u2019s share of all tool-result tokens.\">res share</th><th title=\"First-reach error rate: schema-invalid or errored on the model\\u2019s first use of this tool.\">1st-call err</th><th>flags</th></tr>';",
  "  return card('Server ergonomics <span class=muted style=\"font-weight:400;text-transform:none;letter-spacing:0\">\\u00b7 grades the server design, not the model</span>',row('first-call success',pct(e.firstCallSuccessRate))+work+'<table>'+th+e.perTool.map(ergRow).join('')+'</table>');}",
  "function renderAnalyze(d){var s=d.summary;var jm=d.judgeModel?(' \\u00b7 judge '+esc(d.judgeModel)):'';",
  "  $('#main').innerHTML='<div class=head><h2>'+esc(s.label)+'</h2><div class=meta>analyze \\u00b7 model <b>'+esc(d.model||'?')+'</b>'+jm+' \\u00b7 auth='+esc(d.auth)+' \\u00b7 '+s.taskCount+' tasks \\u00d7 '+s.epochs+' epochs ('+s.failures+' failed)</div></div>'+pillars(s)+renderErgonomics(s.ergonomics)+renderTasks(d.attempts);}",
  "var TH={'\\u0394':'Difference head minus base.','\\u00b1SE':'Paired standard error of the difference.','p':'Two-sided p-value of the paired t-test.','perm p':'Distribution-free two-sided p (paired sign-flip permutation) \\u2014 robust at small n.','sig?':'Whether the delta is resolvable at the current n (p<0.05).','MDE':'Minimum effect detectable at the current n (80% power).','reqN':'Tasks needed to resolve the observed delta at 80% power.'};",
  "function th(h){var t=TH[h]?(' title=\"'+esc(TH[h])+'\"'):'';return '<th'+t+'>'+h+'</th>';}",
  "function cmpTable(rows){var h='<tr>'+['metric','base','head','\\u0394','%chg','\\u00b1SE','p','perm p','sig?','MDE','reqN'].map(th).join('')+'</tr>';",
  "  var body=rows.map(function(r){var d=r.head-r.base;var ch=r.base?d/r.base*100:0;var lower=r.lowerIsBetter!==false;var good=d!==0&&(lower?d<0:d>0);",
  "    var cls=d===0?'muted':good?'good':'bad';var arrow=d===0?'\\u00b7':good?'\\u25bc':'\\u25b2';",
  "    var permp=r.permutationP==null?'\\u2014':Number(r.permutationP).toFixed(3);",
  "    return '<tr><td>'+esc(r.metric)+'</td><td>'+fmt(r.base,1)+'</td><td>'+fmt(r.head,1)+'</td><td class='+cls+'>'+arrow+fmt(d,1)+'</td><td class='+cls+'>'+(ch>=0?'+':'')+ch.toFixed(0)+'%</td><td>'+fmt(r.pairedSe,1)+'</td><td>'+Number(r.p).toFixed(3)+'</td><td>'+permp+'</td><td><span class=\"pill '+(r.resolvable?'yes':'no')+'\">'+(r.resolvable?'yes':'no')+'</span></td><td>'+fmt(r.mde,1)+'</td><td>'+r.requiredN+'</td></tr>';}).join('');",
  "  return '<table>'+h+body+'</table>';}",
  "function col(label,model,s){return '<div><h3 style=\"color:var(--cyan)\">'+esc(label)+(model?' <span class=muted style=\"font-size:11px\">'+esc(model)+'</span>':'')+'</h3>'+pillars(s)+'</div>';}",
  "function showComparison(o){var rows=(o.comparison||[]).map(function(c){c.lowerIsBetter=c.metric!=='pass-rate';return c;});",
  "  var tbl=rows.length?cmpTable(rows):'<div class=muted>not enough matched tasks for paired stats (need \\u22652 shared tasks)</div>';",
  "  var cols='<div class=twocol>'+col(o.baseLabel,o.baseModel,o.baseSummary)+col(o.headLabel,o.headModel,o.headSummary)+'</div>';",
  "  $('#main').innerHTML='<div class=head><h2>'+esc(o.baseLabel)+' \\u2192 '+esc(o.headLabel)+'</h2><div class=meta>'+esc(o.meta)+'</div></div>'+card('Paired comparison',tbl)+'<p class=muted style=\"font-size:12px\">\\u25bc head better \\u00b7 \\u25b2 head worse \\u00b7 sig? = resolvable at current n (p&lt;0.05) \\u00b7 reqN = tasks at 80% power</p>'+cols;}",
  "function renderCompare(d){showComparison({baseLabel:(d.base&&d.base.label)||'base',headLabel:(d.head&&d.head.label)||'head',baseModel:d.model,headModel:d.model,meta:'compare run \\u00b7 model '+(d.model||'?')+' \\u00b7 auth='+d.auth+' \\u00b7 '+(d.matchedTasks?d.matchedTasks.length:0)+' matched tasks \\u00d7 '+d.epochs+' epochs',comparison:d.comparison,baseSummary:d.baseSummary,headSummary:d.headSummary});}",
  "function crossCompare(){var a=$('#cmpA').value,b=$('#cmpB').value;if(!a||!b){return;}if(a===b){$('#main').innerHTML='<div class=empty>Pick two different runs.</div>';return;}",
  "  fetch('/api/compare?a='+encodeURIComponent(a)+'&b='+encodeURIComponent(b)).then(function(r){return r.json();}).then(function(o){showComparison({baseLabel:o.baseLabel,headLabel:o.headLabel,baseModel:o.baseModel,headModel:o.headModel,meta:'cross-run compare \\u00b7 '+(o.matched?o.matched.length:0)+' matched tasks',comparison:o.comparison,baseSummary:o.baseSummary,headSummary:o.headSummary});}).catch(function(e){$('#main').innerHTML='<div class=empty>'+esc(e)+'</div>';});}",
  "function mtxMetrics(){return [",
  "  {k:'tokens/task (median)',g:function(s){return s.efficiency.tokensMedian;},lower:true,f:function(v){return fmt(v);}},",
  "  {k:'tool calls',g:function(s){return s.efficiency.toolCallsMedian;},lower:true,f:function(v){return fmt(v,1);}},",
  "  {k:'discovery RT',g:function(s){return s.efficiency.discoveryMean;},lower:true,f:function(v){return fmt(v,1);}},",
  "  {k:'$/task',g:function(s){return s.cost.perTaskMean;},lower:true,f:usd},",
  "  {k:'attributable',g:function(s){return s.bloat.attributableShareMean;},lower:false,f:pct},",
  "  {k:'tool-def tokens',g:function(s){return s.bloat.toolDefTokensMean;},lower:true,f:function(v){return fmt(v);}},",
  "  {k:'pass-rate',g:function(s){return s.correctness.scoreMean;},lower:false,f:pct},",
  "  {k:'hallucinated/task',g:function(s){return s.reliability.hallucinatedRate;},lower:true,f:function(v){return fmt(v,2);}},",
  "  {k:'tool errors/task',g:function(s){return s.reliability.toolErrorRate;},lower:true,f:function(v){return fmt(v,2);}}",
  "];}",
  "function matrixTable(cols){var ms=mtxMetrics();",
  "  var head='<tr><th>metric</th>'+cols.map(function(c){return '<th>'+esc(c.model||c.label||c.runId)+'<div class=muted style=\"font-weight:400;font-size:11px\">'+esc(c.label||'')+(c.summary&&c.summary.estimated?' *est':'')+'</div></th>';}).join('')+'</tr>';",
  "  var body=ms.map(function(m){var vals=cols.map(function(c){return c.summary?m.g(c.summary):null;});",
  "    var nums=vals.filter(function(v){return v!=null;});",
  "    var mn=Math.min.apply(null,nums),mx=Math.max.apply(null,nums);",
  "    var best=nums.length>1&&mn!==mx?(m.lower?mn:mx):null;",
  "    var d=DEFS[m.k];var tt=d?(' title=\"'+esc(d)+'\"'):'';",
  "    var cells=vals.map(function(v){var b=best!=null&&v===best;return '<td class='+(b?'good':'')+'>'+(v==null?'<span class=muted>n/a</span>':m.f(v))+'</td>';}).join('');",
  "    return '<tr><td'+tt+'>'+m.k+'</td>'+cells+'</tr>';}).join('');",
  "  return '<table>'+head+body+'</table>';}",
  "function showMatrix(cols){if(!cols||cols.length<2){$('#main').innerHTML='<div class=empty>Pick at least two runs for a matrix.</div>';return;}",
  "  $('#main').innerHTML='<div class=head><h2>Model matrix</h2><div class=meta>'+cols.length+' runs side-by-side \\u00b7 best for cross-model robustness on the same task set</div></div>'+card('Metrics by run',matrixTable(cols))+'<p class=muted style=\"font-size:12px\">green = best in row \\u00b7 lower is better except attributable &amp; pass-rate \\u00b7 *est = estimated decomposition</p>';}",
  "function buildMatrix(){var sel=$('#mtx');var ids=[];for(var i=0;i<sel.options.length;i++){if(sel.options[i].selected)ids.push(sel.options[i].value);}",
  "  if(ids.length<2){$('#main').innerHTML='<div class=empty>Select at least two runs (Ctrl/Cmd-click).</div>';return;}",
  "  fetch('/api/matrix?ids='+encodeURIComponent(ids.join(','))).then(function(r){return r.json();}).then(function(o){showMatrix(o.cols);}).catch(function(e){$('#main').innerHTML='<div class=empty>'+esc(e)+'</div>';});}",
  "function render(d){if(d.kind==='compare')renderCompare(d);else renderAnalyze(d);}",
  "function pick(el,id){var rs=document.querySelectorAll('.run');for(var i=0;i<rs.length;i++)rs[i].classList.remove('active');if(el)el.classList.add('active');",
  "  fetch('/api/runs/'+encodeURIComponent(id)).then(function(r){return r.json();}).then(render).catch(function(e){$('#main').innerHTML='<div class=empty>'+esc(e)+'</div>';});}",
  "fetch('/api/runs').then(function(r){return r.json();}).then(function(runs){",
  "  if(!runs.length){$('#runs').innerHTML='<div class=empty>No runs yet. Run <b>dyno analyze</b> or <b>dyno compare</b>.</div>';return;}",
  "  $('#runs').innerHTML=runs.map(function(r,i){return '<div class=\"run'+(i===0?' active':'')+'\" data-id=\"'+esc(r.runId)+'\"><div class=kind>'+esc(r.kind)+'</div><div class=lbl>'+r.labels.map(esc).join(' \\u2192 ')+'</div><div class=when>'+(r.model?esc(r.model)+' \\u00b7 ':'')+esc(r.runId)+'</div></div>';}).join('');",
  "  var rs=document.querySelectorAll('.run');for(var i=0;i<rs.length;i++){(function(el){el.onclick=function(){pick(el,el.getAttribute('data-id'));};})(rs[i]);}",
  "  var opts=runs.map(function(r){return '<option value=\"'+esc(r.runId)+'\">'+esc(r.kind)+': '+r.labels.map(esc).join(' \\u2192 ')+(r.model?' ['+esc(r.model)+']':'')+'</option>';}).join('');",
  "  $('#cmpA').innerHTML=opts;$('#cmpB').innerHTML=opts;if(runs[1]){$('#cmpB').selectedIndex=1;}",
  "  $('#mtx').innerHTML=opts;",
  "  $('#cmpBtn').onclick=crossCompare;$('#mtxBtn').onclick=buildMatrix;",
  "  pick(document.querySelector('.run'),runs[0].runId);",
  "}).catch(function(e){$('#runs').innerHTML='<div class=empty>'+esc(e)+'</div>';});",
].join("\n");

export const DASHBOARD_HTML = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>mcp-dyno</title><style>${STYLE}</style></head>
<body><div class=layout>
<aside class=side><h1>mcp-dyno</h1><div class=tag>put your MCP on the dyno</div><div id=runs></div></aside>
<main class=main>
<div class=cmpbar><span class=lbl>Compare any two runs:</span><select id=cmpA></select><span class=lbl>vs</span><select id=cmpB></select><button id=cmpBtn>Compare</button></div>
<div class=cmpbar><span class=lbl>Model matrix (pick 2+, Ctrl/Cmd-click):</span><select id=mtx multiple size=4></select><button id=mtxBtn>Build matrix</button></div>
<div id=main><div class=empty>Select a run, compare two, or build a model matrix.</div></div></main>
</div><script>${SCRIPT}</script></body></html>`;
