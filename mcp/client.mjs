import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export const DEFAULT_URL='https://nokkeydhtxewgtkxxnsh.supabase.co/functions/v1/roam-mcp';
export async function connectRoam({token=process.env.ROAM_MCP_TOKEN,url=process.env.ROAM_MCP_URL??DEFAULT_URL,fetch:fetchImpl}={}){
 if(!/^roam_[A-Za-z0-9_-]{43}$/.test(token??''))throw Error('请先通过 ROAM_MCP_TOKEN 环境变量提供网站生成的 Agent 令牌。');
 const endpoint=new URL(url);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)))throw Error('MCP 地址须为 HTTPS（本机调试可用 loopback HTTP），且不能包含查询参数或凭据。');
 const transport=new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{Authorization:'Bearer '+token},redirect:'error'},...(fetchImpl?{fetch:fetchImpl}:{})});
 const client=new Client({name:'roam-command-client',version:'1.0.0'});
 try{await client.connect(transport);return client}catch{await transport.close();throw Error('MCP 连接失败，请检查令牌、网络和接口地址。')}
}
