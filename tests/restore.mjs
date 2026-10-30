import {Client} from 'pg';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const uri=new URL(process.env.DISPATCH_TEST_DATABASE??'');
if(!['127.0.0.1','localhost'].includes(uri.hostname))throw Error('This restore proof is restricted to a local isolated test database.');
const binaries=process.env.PG_BIN;if(!binaries)throw Error('Set PG_BIN to the directory containing pg_dump and pg_restore.');
const target='dispatch_restore_'+Date.now();const output=path.resolve('../.local/restore-proof');await mkdir(output,{recursive:true});const backup=path.join(output,'dispatch-test.backup');
const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:decodeURIComponent(uri.username),PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:uri.pathname.slice(1)};
async function run(tool,args){await new Promise((resolve,reject)=>{const p=spawn(path.join(binaries,tool+(process.platform==='win32'?'.exe':'')),args,{env,windowsHide:true});let stderr='';p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(tool+' failed: '+stderr)));});}
const original=new Client({connectionString:uri.toString()});await original.connect();let restored;
try{await run('pg_dump',['--format=custom','--no-owner','--file',backup]);await original.query('CREATE DATABASE "'+target+'" TEMPLATE template0 ENCODING \'UTF8\' LC_COLLATE \'C\' LC_CTYPE \'C\'');await run('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--dbname',target,backup]);const targetUri=new URL(uri);targetUri.pathname='/'+target;restored=new Client({connectionString:targetUri.toString()});await restored.connect();
const tables=(await original.query('SELECT tablename FROM pg_tables WHERE schemaname=\'public\' ORDER BY tablename')).rows.map(x=>x.tablename);const counts=[];for(const table of tables){const quoted='"'+table.replaceAll('"','""')+'"';const a=Number((await original.query('SELECT COUNT(*) FROM '+quoted)).rows[0].count);const b=Number((await restored.query('SELECT COUNT(*) FROM '+quoted)).rows[0].count);assert.equal(b,a,table+' restored count');counts.push({table,rows:a});}
assert.deepEqual((await restored.query('SELECT "Id","PayloadHash","State" FROM "Jobs" ORDER BY "Id"')).rows,(await original.query('SELECT "Id","PayloadHash","State" FROM "Jobs" ORDER BY "Id"')).rows);
console.log(JSON.stringify({status:'PASS',restoredDatabase:target,tablesCompared:tables.length,jobHashesVerified:true,counts,note:'Disposable restore target retained for inspection. No source database or Tally data was overwritten.'},null,2));
}finally{if(restored)await restored.end();await original.end();}
