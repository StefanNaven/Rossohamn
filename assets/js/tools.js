import {setText,dateTimeText} from './core.js';
import {encodeBase64,decodeBase64,unixToDate,isoToDate} from './tool-logic.js';
const el=id=>document.getElementById(id);
function bind(id,input,msg,action){el(id).addEventListener('click',()=>{try{const value=action(el(input).value);el(input).value=value;setText(msg,'Klart');}catch(e){setText(msg,e.message);}});}
bind('jsonFormat','jsonInput','jsonMessage',s=>JSON.stringify(JSON.parse(s),null,2));bind('jsonCompact','jsonInput','jsonMessage',s=>JSON.stringify(JSON.parse(s)));bind('base64Encode','base64Input','base64Message',encodeBase64);bind('base64Decode','base64Input','base64Message',decodeBase64);
for(const [id,input,msg] of [['jsonCopy','jsonInput','jsonMessage'],['base64Copy','base64Input','base64Message']])el(id).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(el(input).value);setText(msg,'Kopierat');}catch{el(input).focus();el(input).select();setText(msg,'Automatisk kopiering misslyckades. Markera och kopiera manuellt.');}});
function show(d){el('unixInput').value=el('unixUnit').value==='s'?Math.floor(+d/1000):+d;el('isoInput').value=d.toISOString();setText('unixResult',`UTC: ${d.toISOString()}\nStockholm: ${dateTimeText(d)}\nUnix (s): ${Math.floor(+d/1000)}\nUnix (ms): ${+d}`);}
function on(id,fn){el(id).addEventListener('click',()=>{try{show(fn());}catch(e){setText('unixResult',e.message);}});}
on('unixConvert',()=>unixToDate(el('unixInput').value,el('unixUnit').value));on('isoConvert',()=>isoToDate(el('isoInput').value));on('unixNow',()=>new Date());el('unixUnit').addEventListener('change',()=>{if(el('isoInput').value){try{show(isoToDate(el('isoInput').value));}catch{}}});show(new Date());
