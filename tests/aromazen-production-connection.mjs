import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const config=JSON.parse(readFileSync(new URL('../.local/production-qa.json',import.meta.url)));
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function client(slug){
 const cfg=config[slug];assert.match(cfg.url,/^http:\/\/127\.0\.0\.1:/);
 const response=await fetch(cfg.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:cfg.email,password:cfg.password})});
 assert.equal(response.status,200);const auth=await response.json();
 const headers={'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf};
 const command=async(type,data)=>{const r=await fetch(cfg.url+'/api/commands',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),type,data:{...data,workflow:slug==='aromazon'?'StockFirst':'OrderFirst'}})});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
 const db=new pg.Client({host:'127.0.0.1',port:55439,user:'aromazen_qa',database:cfg.database});await db.connect();
 return{cfg,command,db};
}
const a=await client('aromazon'),e=await client('electro');
const connector=await a.command('pairConnector',{name:'QA production transition',expectedCompany:'AROMAZEN QA ONLY'});
const headers={'Content-Type':'application/json','X-Connector-Id':connector.id,'X-Connector-Key':connector.secret};
const upgrade=async(body={company:'AROMAZEN QA ONLY',confirmProduction:true},h=headers,url=a.cfg.url)=>{const r=await fetch(url+'/api/connector/production-upgrade',{method:'POST',headers:h,body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
await a.db.query('UPDATE "Connectors" SET "Environment"=\'Test\' WHERE "Id"=$1',[connector.id]);
await test('upgrade requires valid paired credentials',async()=>{assert.equal((await upgrade(undefined,{'Content-Type':'application/json'})).status,401);});
await test('upgrade requires the deployment-owned exact company and explicit production intent',async()=>{
 assert.equal((await upgrade({company:'WRONG COMPANY',confirmProduction:true})).status,403);
 assert.equal((await upgrade({company:'AROMAZEN QA ONLY',confirmProduction:false})).status,403);
});
await test('Test becomes Production without changing the pairing key or enabling invoice posting',async()=>{
 const before=await a.db.query('SELECT "SecretHash" FROM "Connectors" WHERE "Id"=$1',[connector.id]);
 const r=await upgrade();assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.environment,'Production');
 const after=await a.db.query('SELECT "Environment","SecretHash" FROM "Connectors" WHERE "Id"=$1',[connector.id]);assert.equal(after.rows[0].Environment,'Production');assert.equal(after.rows[0].SecretHash,before.rows[0].SecretHash);
 const mapping=await a.db.query('SELECT "ContractValidated","Pattern" FROM "Mappings"');assert.equal(mapping.rows[0].ContractValidated,false);assert.equal(mapping.rows[0].Pattern,'Unvalidated');
});
await test('production upgrade is idempotent and audit is written once',async()=>{
 assert.equal((await upgrade()).status,200);
 const audit=await a.db.query('SELECT count(*)::int AS count FROM "Audit" WHERE "Action"=\'connectorProductionUpgrade\' AND "EntityId"=$1',[connector.id]);assert.equal(audit.rows[0].count,1);
});
await test('the upgraded connector can deliver a Production heartbeat',async()=>{
 const r=await fetch(a.cfg.url+'/api/connector/heartbeat',{method:'POST',headers,body:JSON.stringify({company:'AROMAZEN QA ONLY',environment:'Production',tallyReachable:true,version:'1.8.0-company-dispatch',detail:'Isolated local fixture'})});assert.equal(r.status,200);
});
await test('the old Test heartbeat is rejected after the verified upgrade',async()=>{
 const r=await fetch(a.cfg.url+'/api/connector/heartbeat',{method:'POST',headers,body:JSON.stringify({company:'AROMAZEN QA ONLY',environment:'Test',tallyReachable:true,version:'QA',detail:'QA'})});assert.equal(r.status,409);
});
await test('invoice jobs remain unavailable until the accountant validates mapping',async()=>{
 const r=await fetch(a.cfg.url+'/api/connector/jobs/next',{headers});assert.equal(r.status,204);
});
await test('Electro rejects the AROMAZEN connector and upgrade endpoint remains AROMAZEN-only',async()=>{
 assert.equal((await upgrade(undefined,headers,e.cfg.url)).status,401);
 const ec=await e.command('pairConnector',{name:'Electro QA',expectedCompany:'ELECTRO GROUP OF INDUSTRIES'});
 assert.equal((await upgrade({company:'ELECTRO GROUP OF INDUSTRIES',confirmProduction:true},{'Content-Type':'application/json','X-Connector-Id':ec.id,'X-Connector-Key':ec.secret},e.cfg.url)).status,403);
 const state=await e.db.query('SELECT "Environment" FROM "Connectors" WHERE "Id"=$1',[ec.id]);assert.equal(state.rows[0].Environment,'Production');
});
await test('revoked connectors cannot upgrade',async()=>{
 await a.db.query('UPDATE "Connectors" SET "Revoked"=true WHERE "Id"=$1',[connector.id]);assert.equal((await upgrade()).status,401);
});
await test('outstanding invoice jobs prevent an environment transition',async()=>{
 const suffix=randomUUID().slice(0,8);
 await a.command('saveProduct',{sku:'UPGRADE-'+suffix,name:'Upgrade QA item',unit:'Nos',reason:'Local fixture only'});
 const customer=await a.command('saveCustomer',{name:'Upgrade QA customer',address:'QA Karnataka',reason:'Local fixture only'});
 const pack=await a.command('saveManifest',{name:'Upgrade QA packing '+suffix,warehouseId:'main',notes:'',groups:[{marking:'QA',count:1,lines:[{sku:'UPGRADE-'+suffix,quantity:1,unit:'Nos'}]}]});
 await a.command('approveManifest',{id:pack.id,physicalConfirmed:true});
 const carton=(await a.db.query('SELECT * FROM "Cartons" WHERE "ManifestId"=$1',[pack.id])).rows[0];
 await a.command('attachLabels',{ids:[carton.Id],physicalConfirmed:true,contentsConfirmed:true,revisions:[{id:carton.Id,revision:1}]});
 const trip=await a.command('createTrip',{vehicle:'QA-UPGRADE',driver:'QA driver'});
 const shipment=await a.command('allocate',{tripId:trip.id,customerId:customer.id,destination:'QA Karnataka',ids:[carton.Id]});
 const loading=await a.command('startLoading',{shipmentId:shipment.id,station:'QA-UPGRADE'});
 await a.command('scan',{sessionId:loading.id,station:'QA-UPGRADE',mode:'live',qr:`K1|aromazon-india|${carton.Id}|1`});
 await a.command('approveLoad',{id:shipment.id,physicalConfirmed:true});
 const bill=await a.command('saveBilling',{shipmentId:shipment.id,version:0,rates:[{sku:'UPGRADE-'+suffix,rate:1,discountPercent:0}],freight:0,otherCharges:0,terms:'',reason:'QA pending job'});
 await a.db.query('INSERT INTO "Jobs" ("Id","CompanyId","ShipmentId","BillingId","PayloadHash","State","Detail","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',[randomUUID(),'aromazon-india',shipment.id,bill.id,'qa-hash','Queued','Local simulated pending job']);
 const pending=await a.command('pairConnector',{name:'QA pending transition',expectedCompany:'AROMAZEN QA ONLY'});
 await a.db.query('UPDATE "Connectors" SET "Environment"=\'Test\' WHERE "Id"=$1',[pending.id]);
 const r=await upgrade(undefined,{'Content-Type':'application/json','X-Connector-Id':pending.id,'X-Connector-Key':pending.secret});assert.equal(r.status,409);
 const row=await a.db.query('SELECT "Environment" FROM "Connectors" WHERE "Id"=$1',[pending.id]);assert.equal(row.rows[0].Environment,'Test');
});
await a.db.end();await e.db.end();console.log(`${passed} isolated production-connection checks passed. No real Tally vouchers were created.`);
