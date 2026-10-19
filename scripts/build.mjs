import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fileEnv={};try{fileEnv=parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const url=process.env.SUPABASE_URL??fileEnv.SUPABASE_URL??'',key=process.env.SUPABASE_PUBLISHABLE_KEY??fileEnv.SUPABASE_PUBLISHABLE_KEY??'';
if(key.startsWith('sb_secret_'))throw Error('Do not publish a Supabase secret key.');
if(key.startsWith('eyJ')){try{const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(claims.role!=='anon')throw Error('Only anon keys may be public.')}catch{throw Error('Supabase key is not a public anon key.')}}
if(url&&!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw Error('Invalid Supabase project URL');
await fs.rm(path.join(root,'dist'),{recursive:true,force:true});await fs.mkdir(path.join(root,'dist'),{recursive:true});
await build({entryPoints:[path.join(root,'app.mjs')],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:path.join(root,'dist/app.js'),minify:true,legalComments:'eof',plugins:[{name:'public-config',setup(b){b.onLoad({filter:/[/\\]config\.mjs$/},()=>({contents:`export default ${JSON.stringify({supabaseUrl:url,supabasePublishableKey:key})}`,loader:'js'}))}}]});
for(const name of ['index.html','style.css','auth.css','seed.json'])await fs.copyFile(path.join(root,name),path.join(root,'dist',name));
await fs.cp(path.join(root,'vendor'),path.join(root,'dist/vendor'),{recursive:true});
const assets={};
for(const name of ['app.js','style.css','auth.css']){
 const digest=createHash('sha256').update(await fs.readFile(path.join(root,'dist',name))).digest('hex').slice(0,12);
 const ext=path.extname(name),versioned=name.slice(0,-ext.length)+'.'+digest+ext;assets[name]=versioned;
 await fs.rename(path.join(root,'dist',name),path.join(root,'dist',versioned));
}
let html=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
html=html.replace(/src="app\.mjs\?v=[^"]+"/,`src="${assets['app.js']}"`).replace(/href="style\.css(?:\?v=[^"]+)?"/,`href="${assets['style.css']}"`).replace('href="auth.css"',`href="${assets['auth.css']}"`);
await fs.writeFile(path.join(root,'dist/index.html'),html);
await fs.writeFile(path.join(root,'dist/.nojekyll'),'');
const seed=JSON.parse(await fs.readFile(path.join(root,'dist/seed.json'),'utf8'));if(seed.trips.length)throw Error('Do not ship personal itinerary data in the public build.');
console.log(`Built public site; Supabase ${url&&key?'configured':'not configured yet (sign-in disabled)'}. No private trip data included.`);
