// Run with node, not npm: stdout is reserved for MCP JSON-RPC.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {connectRoam} from './client.mjs';
import {INSTRUCTIONS} from './server.mjs';
try{
 const remote=await connectRoam();
 const bridge=new Server({name:'roam-stdio-bridge',version:'1.0.0'},{capabilities:{tools:{}},instructions:INSTRUCTIONS});
 bridge.setRequestHandler(ListToolsRequestSchema,()=>remote.listTools());
 bridge.setRequestHandler(CallToolRequestSchema,request=>remote.callTool(request.params));
 bridge.onclose=()=>{void remote.close()};
 process.on('SIGINT',async()=>{await bridge.close();await remote.close();process.exit(0)});
 process.on('SIGTERM',async()=>{await bridge.close();await remote.close();process.exit(0)});
 await bridge.connect(new StdioServerTransport());
}catch{console.error('Roam MCP 启动失败：请检查 ROAM_MCP_TOKEN、网络和接口地址。');process.exitCode=1}
