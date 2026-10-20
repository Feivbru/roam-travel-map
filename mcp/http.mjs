import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {createRoamMcpServer} from './server.mjs';
export async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('')}
const MAX_BODY=1024*1024;
export function createMcpHandler(backendForHash,{origins=['https://feivbru.github.io','http://127.0.0.1:8190']}={}){
 return async function handle(request){
  const origin=request.headers.get('origin');
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin&&!origins.includes(origin))return Response.json({error:'Origin not allowed'},{status:403,headers});
  if(origin){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type,mcp-protocol-version,mcp-session-id';headers['Access-Control-Allow-Methods']='POST,OPTIONS';headers['Access-Control-Expose-Headers']='mcp-session-id';}
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return Response.json({error:'Use MCP Streamable HTTP POST'},{status:405,headers:{...headers,Allow:'POST,OPTIONS'}});
  const match=/^Bearer (roam_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')??'');
  if(!match)return Response.json({error:'Use a Roam Agent bearer token from the website.'},{status:401,headers:{...headers,'WWW-Authenticate':'Bearer realm="roam-mcp"'}});
  let server,transport;
  try{
   const backend=backendForHash(await sha256(match[1])),access=await backend.authenticate();
   if(Number(request.headers.get('content-length'))>MAX_BODY)return Response.json({error:'Request too large'},{status:413,headers});
   const reader=request.body?.getReader();let size=0;const chunks=[];
   if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return Response.json({error:'Request too large'},{status:413,headers})}chunks.push(value)}}
   const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength}
   server=createRoamMcpServer(backend,access);transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);
   // One server/transport per request: no state or authenticated data leaks between callers.
   const response=await transport.handleRequest(new Request(request.url,{method:'POST',headers:request.headers,body:bytes}));
   for(const [k,v]of Object.entries(headers))response.headers.set(k,v);
   return response;
  }catch(error){
   const status=error.code==='RATE_LIMIT'?429:error.code==='UNAUTHORIZED'?401:500;
   return Response.json({error:status===500?'MCP request failed':error.safeMessage},{status,headers:{...headers,...(status===429?{'Retry-After':'60'}:status===401?{'WWW-Authenticate':'Bearer realm="roam-mcp"'}:{})}});
  }finally{await server?.close()}
 };
}
