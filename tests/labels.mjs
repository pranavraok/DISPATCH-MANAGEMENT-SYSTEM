import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'artifacts'),{recursive:true});process.chdir(path.join(root,'artifacts'));
const server=await createServer({root:path.join(root,'web'),configFile:false,server:{middlewareMode:true}});
try{const{labelPdf}=await server.ssrLoadModule('/src/labels.ts');await labelPdf([{companyId:'demo',id:'CT-TEST0000000000000001',revision:1,marking:'D',lines:JSON.stringify([{sku:'SND01',quantity:40,unit:'packets'},{sku:'ROS01',quantity:20,unit:'packets'}])}],'KR Vishwanath Agarbatti Works - FICTIONAL TEST',true);assert.ok((await stat('A4-label-test.pdf')).size>1000);console.log('PASS actual application label PDF function generated a fictional mixed-carton A4 test page. Physical printer/scanner validation remains pending.');}finally{await server.close();}
