import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.DISPATCH_TEST_URL;
assert.ok(base?.startsWith('http://127.0.0.1:'),'Use the isolated local API.');
const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@electrogroup.test',password:process.env.DISPATCH_TEST_PASSWORD})});
assert.equal(response.status,200); const login=await response.json();
const headers={'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.csrf};
const request=async(flow,type,data,id=randomUUID())=>{const r=await fetch(base+'/api/commands',{method:'POST',headers,body:JSON.stringify({requestId:id,type,data:{...data,workflow:flow}})});return {status:r.status,data:await r.json()};};
const ok=async(flow,type,data)=>{const r=await request(flow,type,data);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const state=async flow=>{const r=await fetch(base+'/api/state?workflow='+flow,{headers});assert.equal(r.status,200);return r.json();};
const S='StockFirst',O='OrderFirst',suffix=randomUUID().slice(0,8);
const initial=await state(S),customerId=initial.customers[0].id,warehouseId=initial.warehouses[0].id;
const lines=[{sku:'SND01',quantity:10,unit:'packets'}];
const orderInput=(reference,count=2)=>({reference:reference+'-'+suffix,customerId,warehouseId,destination:'Fictional dual-workflow depot',expectedCartons:count,lines:[{sku:'SND01',quantity:count*10,unit:'packets'}],notes:'Fictional software QA only'});
const packing=(name,count=2,order)=>({name:name+'-'+suffix,warehouseId,customerId:order?customerId:null,orderId:order?.id??null,notes:'Fictional software QA only',groups:[{marking:'A',count,lines}]});
assert.equal((await request('BadWorkflow','createTrip',{vehicle:'QA-1234',driver:'Fictional driver'})).status,400);
assert.equal((await request(O,'saveManifest',packing('Missing order'))).status,400);
assert.equal((await request(S,'saveManifest',{...packing('Premature customer'),customerId})).status,400);

// Pack and label stock with no order. The order is deliberately created afterwards.
const stock=await ok(S,'saveManifest',packing('Pack before order',3));
await ok(S,'approveManifest',{id:stock.id,physicalConfirmed:true});
const stockBoxes=(await state(S)).cartons.filter(c=>c.manifestId===stock.id);assert.equal(stockBoxes.length,3);assert.ok(stockBoxes.every(c=>c.customerId==null));
const label=async(flow,boxes)=>{const job=await ok(flow,'createLabels',{ids:boxes.map(c=>c.id),reason:'Fictional batch labels'});await ok(flow,'attachLabels',{ids:boxes.map(c=>c.id),physicalConfirmed:true,contentsConfirmed:true,revisions:boxes.map(c=>({id:c.id,revision:c.revision}))});return job;};
await label(S,stockBoxes);
assert.equal((await state(O)).manifests.some(m=>m.id===stock.id),false);
const stockOrder=await ok(S,'createOrder',orderInput('SHARED-REFERENCE'));

// The same reference may exist in the other test workflow, with a distinct order identity.
const customerOrder=await ok(O,'createOrder',orderInput('SHARED-REFERENCE'));
assert.notEqual(customerOrder.id,stockOrder.id);
assert.equal((await request(O,'createOrder',orderInput('SHARED-REFERENCE'))).status,409);
assert.equal((await request(O,'createOrder',{...orderInput('Invalid count'),expectedCartons:0})).status,400);
const first=await ok(O,'saveManifest',packing('Order before packing',2,customerOrder));
await ok(O,'approveManifest',{id:first.id,physicalConfirmed:true});
const orderBoxes=(await state(O)).cartons.filter(c=>c.manifestId===first.id);await label(O,orderBoxes);
assert.equal((await state(S)).cartons.some(c=>orderBoxes.some(o=>o.id===c.id)),false);
assert.equal((await request(S,'holdCarton',{id:orderBoxes[0].id,held:true,reason:'Cross-workflow guard'})).status,409);
const wrongRead=await fetch(base+'/api/work/packing/'+first.id+'?workflow='+S,{headers});assert.equal(wrongRead.status,404);
const correctRead=await fetch(base+'/api/work/packing/'+first.id+'?workflow='+O,{headers});assert.equal(correctRead.status,200);assert.equal((await correctRead.json()).cartons.length,2);
assert.equal((await state(O)).orderProgress.find(p=>p.orderId===customerOrder.id).packedCartons,2);

const otherOrder=await ok(O,'createOrder',orderInput('SAME-CUSTOMER-OTHER-ORDER',1));
const otherPack=await ok(O,'saveManifest',packing('Other order',1,otherOrder));await ok(O,'approveManifest',{id:otherPack.id,physicalConfirmed:true});
const otherBoxes=(await state(O)).cartons.filter(c=>c.manifestId===otherPack.id);await label(O,otherBoxes);
const trip=await ok(O,'createTrip',{vehicle:'QA-ORDER-'+suffix,driver:'Fictional order driver'});
const allocation={tripId:trip.id,orderId:customerOrder.id,customerId,destination:orderInput('').destination,ids:orderBoxes.map(c=>c.id)};
assert.equal((await request(O,'allocate',{...allocation,ids:otherBoxes.map(c=>c.id)})).status,400);
assert.equal((await request(O,'allocate',{...allocation,ids:[stockBoxes[0].id]})).status,409);
const shipment=await ok(O,'allocate',allocation);
const session=await ok(O,'startLoading',{shipmentId:shipment.id,station:'SHARED-SCANNER-QA'});
const qr=c=>'Q'+Buffer.from(c.id.slice(3),'hex').toString('base64url')+'.'+c.revision;
const scan=c=>({sessionId:session.id,station:'SHARED-SCANNER-QA',qr:qr(c),mode:'live'});
assert.equal((await ok(O,'scan',scan(stockBoxes[0]))).outcome,'Rejected');
assert.equal((await request(S,'scan',scan(orderBoxes[0]))).status,409);
assert.equal((await ok(O,'scan',scan(orderBoxes[0]))).outcome,'Accepted');
assert.equal((await ok(O,'scan',scan(orderBoxes[0]))).outcome,'Duplicate');
assert.equal((await request(O,'approveLoad',{id:shipment.id,physicalConfirmed:true})).status,400);
assert.equal((await ok(O,'scan',scan(orderBoxes[1]))).outcome,'Accepted');
await ok(O,'approveLoad',{id:shipment.id,physicalConfirmed:true});

const stockTrip=await ok(S,'createTrip',{vehicle:'QA-STOCK-'+suffix,driver:'Fictional stock driver'});
const stockShipment=await ok(S,'allocate',{...allocation,tripId:stockTrip.id,orderId:stockOrder.id,ids:stockBoxes.slice(0,2).map(c=>c.id)});
const stockSession=await ok(S,'startLoading',{shipmentId:stockShipment.id,station:'SHARED-SCANNER-QA'});
for(const box of stockBoxes.slice(0,2))assert.equal((await ok(S,'scan',{sessionId:stockSession.id,station:'SHARED-SCANNER-QA',qr:qr(box),mode:'live'})).outcome,'Accepted');
await ok(S,'approveLoad',{id:stockShipment.id,physicalConfirmed:true});
assert.equal((await state(S)).cartons.find(c=>c.id===stockBoxes[2].id).state,'Available');

// Both workflows use the same company-wide accounting and master records.
await ok(O,'saveMapping',{expectedCompany:'ISOLATED TEST COMPANY',tallyVersion:'Not installed for this QA',salesLedger:'Shared QA Sales',voucherType:'Sales',notes:'Fictional configuration only',statutoryRequired:true,reason:'Shared integration software QA'});
const pairing=await ok(S,'pairConnector',{name:'One shared test connector',expectedCompany:'ISOLATED TEST COMPANY'});
const sharedProduct=await ok(O,'saveProduct',{sku:'DUAL-'+suffix,name:'Shared fictional product',unit:'Nos',reason:'Shared masters QA'});
const a=await state(S),b=await state(O);
assert.equal(a.mapping.id,b.mapping.id);assert.equal(a.mapping.salesLedger,'Shared QA Sales');assert.deepEqual(a.connectors.map(c=>c.id),b.connectors.map(c=>c.id));assert.ok(b.connectors.some(c=>c.id===pairing.id));
assert.ok(a.products.some(p=>p.id===sharedProduct.id));assert.deepEqual(a.customers.map(c=>c.id),b.customers.map(c=>c.id));
for(const [flow,sh] of [[S,stockShipment],[O,shipment]]){
  const bill=await ok(flow,'saveBilling',{shipmentId:sh.id,rates:[{sku:'SND01',rate:25,discountPercent:0}],freight:0,otherCharges:0,terms:'Fictional QA',reason:'Authorised fictional rate',version:0});
  assert.equal(bill.total,500);await ok(flow,'approveBilling',{id:bill.id,physicalConfirmed:true});const job=await ok(flow,'queueInvoice',{id:sh.id});assert.equal(job.state,'Blocked');
}
const capped=await ok(O,'createOrder',orderInput('CONTENTS-GUARD'));
assert.equal((await request(O,'saveManifest',{...packing('Underfilled full order',2,capped),groups:[{marking:'A',count:2,lines:[{sku:'SND01',quantity:5,unit:'packets'}]}]})).status,400);
assert.equal((await request(O,'saveManifest',packing('Excess cartons',3,capped))).status,400);
assert.equal((await request(O,'deleteOrder',{id:customerOrder.id,reason:'Used order guard',confirmed:true})).status,400);
const unused=await ok(O,'createOrder',orderInput('UNUSED-DELETE'));await ok(O,'deleteOrder',{id:unused.id,reason:'Unused fictional record',confirmed:true});
console.log(JSON.stringify({status:'PASS',workflows:2,oneScanPerCarton:true,sharedTallyMapping:true,sharedConnector:true,sharedMasters:true,crossWorkflowAndOrderGuards:true,partialStockPreserved:true,billingTotalsVerified:true,realTallyPosting:false}));
