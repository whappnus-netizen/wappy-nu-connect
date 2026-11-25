function textOf(r:Record<string,unknown>):string{
 return ["title","name","question","answer","content","text","body","description"].map(k=>typeof r[k]==="string"?String(r[k]):"").filter(Boolean).join("\n");
}
function tokens(q:string):string[]{
 return [...new Set(q.toLocaleLowerCase("pt-AO").normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^a-z0-9]+/).filter(x=>x.length>1))];
}
function score(q:string,c:string):number{
 const a=tokens(q);const b=new Set(tokens(c));if(!a.length||!b.size)return 0;
 let hits=0;for(const w of a)if(b.has(w))hits++;
 // Short messages such as "oi", "olá" have little lexical signal. The fallback
 // policy below intentionally bypasses score-based exclusion for these cases.
 return hits/a.length;
}
export function rankKnowledge(q:string,rows:Array<Record<string,unknown>>){
 const scored=rows.map((row,index)=>({row,score:score(q,textOf(row)),index}));
 const matched=scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,8);
 if(matched.length)return matched;
 // Never drop all of a tenant's active knowledge just because a short greeting
 // or a general question contains no overlapping words. Include the agent's
 // own active entries in stable order; tenant/agent filtering happens in DB RPC.
 return scored.slice(0,Math.min(4,scored.length)).map(x=>({...x,score:0}));
}
export function formatKnowledge(rows:Array<{row:Record<string,unknown>;score:number}>){
 return rows.map(x=>"["+ (x.score>0?"relevancia "+x.score.toFixed(2):"conhecimento da empresa") +"]\n"+textOf(x.row)).join("\n\n");
}
export function formatExamples(rows:Array<Record<string,unknown>>){
 return rows.map(r=>{
  const i=String(r.input??r.question??r.user_message??"");
  const o=String(r.expected_output??r.output??r.answer??r.assistant_message??"");
  const type=String(r.example_type??r.type??"exemplo");
  return i&&o?"Tipo: "+type+"\nCliente: "+i+"\nResposta ideal: "+o:"";
 }).filter(Boolean).slice(0,8).join("\n\n");
}
