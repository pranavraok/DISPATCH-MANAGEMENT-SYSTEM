import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const cfg=JSON.parse(readFileSync(new URL('../.local/single-scan-qa.json',import.meta.url))).aromazon;
assert.match(cfg.url,/^http:\/\/127\.0\.0\.1:/);
let passed=0;
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
async function client(email=cfg.email,password=cfg.password){
 const login=await fetch(cfg.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const auth=await login.json();
 const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf};
 async function call(path,body){const response=await fetch(cfg.url+'/api'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});const text=await response.text();return{status:response.status,data:text?JSON.parse(text):null,response};}
 const cmd=(type,data,id=randomUUID())=>call('/commands',{requestId:id,type,data:{...data,workflow:'StockFirst'}});
 const ok=async(type,data)=>{const r=await cmd(type,data);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 return{headers,call,cmd,ok,auth};
}
const a=await client(), outsider=await client();
const state=(await a.call('/state')).data, product=state.products.find(p=>p.inTally!==false),customer=state.customers.find(c=>c.inTally!==false);
const draft={reference:'SEC-'+randomUUID().slice(0,8),customerId:customer.id,destination:'Security QA, Karnataka',warehouseId:'main'};
let shipment;
await check('authorized staff can start dispatch immediately without browser registration',async()=>{shipment=await a.ok('beginStockDispatch',draft);});
const session=await a.ok('startLoading',{shipmentId:shipment.id,station:'SECURITY-PC'});
await check('dispatch still requires CSRF',async()=>{const r=await fetch(cfg.url+'/api/commands',{method:'POST',headers:{...a.headers,'X-CSRF-Token':''},body:JSON.stringify({requestId:randomUUID(),type:'beginStockDispatch',data:{...draft,workflow:'StockFirst'}})});assert.equal(r.status,403);});
const plan=await a.ok('registerStockCartons',{name:'Security QR fixture',warehouseId:'main',notes:'',groups:[{marking:'SEC',count:3,lines:[{sku:product.sku,quantity:20,unit:product.unit}]}]});
const labels=await a.ok('createLabels',{ids:plan.cartons.map(c=>c.id),reason:'Security label fixture'});const carton=labels.cartons[0],qr=carton.qr;
const scan=(value,sessionId=session.id)=>({sessionId,station:'SECURITY-PC',qr:value,mode:'live'});
await check('QR uses a signed opaque token without product, batch or carton ID',async()=>{assert.match(qr,/^AZ2\.[A-Za-z0-9_-]{22}\.[0-9A-F]{32}$/);assert.ok(!qr.includes(product.sku));assert.ok(!qr.includes(carton.id));});
await check('reprinting preserves the exact signed QR and inventory',async()=>{const before=(await a.call('/state')).data.packedInventory;const repeat=await a.ok('createLabels',{ids:[carton.id],reason:'Reprint security fixture'});assert.equal(repeat.cartons[0].qr,qr);assert.deepEqual((await a.call('/state')).data.packedInventory,before);});
await check('unsigned reconstruction cannot bypass a signed label',async()=>assert.equal((await a.ok('scan',scan(`K1|aromazon-india|${carton.id}|1`))).outcome,'Rejected'));
await check('altered signature and unknown token are rejected without moving stock',async()=>{const bad=qr.slice(0,-1)+(qr.endsWith('0')?'1':'0');assert.equal((await a.ok('scan',scan(bad))).outcome,'Rejected');assert.equal((await a.call('/cartons/lookup?qr='+encodeURIComponent(bad))).status,400);});
await check('signed-in staff can scan directly and the audit records their login session',async()=>{assert.equal((await a.ok('scan',scan(qr))).outcome,'Accepted');const s=(await a.call('/state')).data;const audit=s.audit.find(e=>e.action==='scan'&&JSON.parse(e.data).input.qr===qr);assert.ok(JSON.parse(audit.data).loginSessionId);assert.equal(audit.actorId,a.auth.user.id);});
await check('duplicate signed scan does not add quantities again',async()=>assert.equal((await a.ok('scan',scan(qr))).outcome,'Duplicate'));
await check('another tab can start loading another order without cancelling the first',async()=>{const next=await a.ok('beginStockDispatch',{...draft,reference:draft.reference+'-2'});await a.ok('startLoading',{shipmentId:next.id,station:'SECURITY-PC'});assert.equal((await a.ok('scan',scan(labels.cartons[1].qr))).outcome,'Accepted');});
await check("a separate login cannot reuse another login session",async()=>assert.equal((await outsider.cmd('scan',scan(labels.cartons[2].qr))).status,409));
await check('old signed revision is rejected after carton contents change',async()=>{const c=labels.cartons[2];await a.ok('reviseCarton',{id:c.id,lines:[{sku:product.sku,quantity:21,unit:product.unit}],reason:'Security revision fixture'});assert.equal((await a.call('/cartons/lookup?qr='+encodeURIComponent(c.qr))).status,400);});
await check('history searches all orders and uses complete saved bill quantities',async()=>{const r=await a.call('/aromazen/orders?search='+encodeURIComponent(draft.reference)+'&status=Scanning&page=0');assert.equal(r.status,200);assert.equal(r.data.total,2);const row=r.data.orders.find(o=>o.order.reference===draft.reference);assert.ok(row);assert.equal(row.shipments[0].scannedCartons,2);assert.equal(row.shipments[0].lines[0].quantity,40);assert.ok(row.customerName);});
await check('a modified opaque token with the original signature is rejected',async()=>{const pieces=qr.split('.');pieces[1]=(pieces[1][0]==='A'?'B':'A')+pieces[1].slice(1);assert.equal((await a.call('/cartons/lookup?qr='+encodeURIComponent(pieces.join('.')))).status,400);});
await check('staff without dispatch permissions cannot start loading',async()=>{
 const email='security-viewer-'+randomUUID().slice(0,8)+'@qa.local',password=randomUUID()+'-QA';
 await a.ok('createUser',{name:'Security viewer',email,password,roles:['MD']});
 const viewer=await client(email,password);
 assert.equal((await viewer.cmd('startLoading',{shipmentId:shipment.id,station:'VIEWER'})).status,403);
});
await check('Home restores full stock, pending work, recent orders and truthful Tally status',async()=>{
 const response=await a.call('/aromazen/dashboard');assert.equal(response.status,200,JSON.stringify(response.data));
 const home=response.data,full=(await a.call('/state')).data;
 for(const key of ['availableCartons','pendingLabels','heldCartons','loadedCartons'])assert.equal(home.inventory[key],full.packedInventory[key]);
 assert.equal(home.inventory.products.length,full.packedInventory.products.length);
 assert.ok(home.inventory.products.every(p=>p.name&&p.sku&&p.unit));
 assert.ok(home.pending.dispatches.count>=2);assert.ok(home.pending.dispatches.items.length<=5);
 for(const key of ['bills','readyInvoices','tallyIssues'])assert.ok(Number.isInteger(home.pending[key].count));
 assert.ok(['Connected','Disconnected','Setup required'].includes(home.tally.status));
 assert.ok(home.recent.orders.some(row=>row.order.reference===draft.reference));
 assert.ok(home.recent.orders.every(row=>row.shipments.every(s=>!('snapshot' in s))));
});
const anonymous=await fetch(cfg.url+'/api/cartons/lookup?qr='+encodeURIComponent(qr));
await check('ordinary scanner without portal authentication cannot retrieve contents',async()=>assert.equal(anonymous.status,401));
console.log(`${passed} security checks passed; no real Tally requests were made.`);
