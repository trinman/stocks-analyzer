import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnalysisStream } from '../src/services/analysisService.ts';
import analysis from '../netlify/functions/analysis.mts';
import marketData from '../netlify/functions/market-data.mts';
import { createRunSnapshot, analysisContext } from '../src/services/runSnapshot.ts';
import { calculateAllIndicators, runBacktest } from '../src/services/tradingService.ts';
import { defaultStrategyParams } from '../src/defaults.ts';

function stream(text: string) { const bytes=new TextEncoder().encode(text);return new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}); }
const sse='data: {"type":"response.output_text.delta","delta":"Hello 世界"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n';
test('stream handles split UTF-8 and SSE frames',async()=>{let text='';await readAnalysisStream(stream(sse),s=>text+=s);assert.equal(text,'Hello 世界');});
test('stream rejects failed, incomplete, empty and interrupted responses',async()=>{
  for(const s of ['data: {"type":"response.failed"}\n\n','data: {"type":"response.incomplete"}\n\n','data: {"type":"response.completed"}\n\n','data: {"type":"response.output_text.delta","delta":"partial"}\n\n']) await assert.rejects(readAnalysisStream(stream(s),()=>{}));
});
function context(){const a=Array(40).fill(100);const data={dates:a.map((_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10)),o:a,h:a,l:a,c:a,v:a};const p={...defaultStrategyParams,useTrendFilter:false,useMomentumEntry:false};return analysisContext(createRunSnapshot('AAPL','daily',data,p,runBacktest(data,calculateAllIndicators(data,p),p,'daily'),{equity:a,ret:0,cagr:0}));}
function request(body: unknown){return new Request('https://test.netlify.app/.netlify/functions/analysis',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test.netlify.app'},body:JSON.stringify(body)});}
test('analysis validates method, origin, body and unavailable configuration',async()=>{
  assert.equal((await analysis(new Request('https://test.netlify.app'))).status,405);
  assert.equal((await analysis(request({}))).status,400);
  assert.equal((await analysis(new Request('https://test.netlify.app',{method:'POST',headers:{Origin:'https://other.example'}}))).status,403);
  (globalThis as any).Netlify={env:{get:()=>undefined}};
  assert.equal((await analysis(request({context:context(),messages:[{role:'user',content:'Analyze'}]}))).status,503);
});
test('analysis uses server-only model/key and forwards complete context without storing response',async()=>{
  (globalThis as any).Netlify={env:{get:(key:string)=>key==='OPENAI_MODEL'?'configured-model':'test-key'}};
  const original=globalThis.fetch;let sent:any;
  globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init!.body as string);assert.equal((init!.headers as any).Authorization,'Bearer test-key');return new Response(stream(sse));};
  try {const res=await analysis(request({context:context(),messages:[{role:'user',content:'Analyze'}]}));assert.equal(res.status,200);assert.equal(sent.model,'configured-model');assert.equal(sent.store,false);assert.match(sent.input[0].content,/useTakeProfit/);assert.match(sent.instructions,/untrusted/);assert.equal(res.headers.get('cache-control'),'no-store');await res.body?.cancel();}finally{globalThis.fetch=original;}
});
test('provider errors are sanitized',async()=>{
  (globalThis as any).Netlify={env:{get:()=> 'test'}};const original=globalThis.fetch;globalThis.fetch=async()=>new Response('secret upstream detail',{status:401});
  try{const res=await analysis(request({context:context(),messages:[{role:'user',content:'Analyze'}]}));assert.equal(res.status,502);assert.doesNotMatch(await res.text(),/secret/);}finally{globalThis.fetch=original;}
});
test('market endpoint rejects invalid symbols and missing configuration',async()=>{
  (globalThis as any).Netlify={env:{get:()=>undefined}};
  assert.equal((await marketData(new Request('https://test.netlify.app/?symbol=bad%20symbol'))).status,400);
  assert.equal((await marketData(new Request('https://test.netlify.app/?symbol=AAPL'))).status,503);
});
