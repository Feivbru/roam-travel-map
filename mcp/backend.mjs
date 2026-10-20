export class AgentError extends Error {constructor(code,message){super(message);this.code=code;this.safeMessage=message}}
export function createAgentBackend(client,tokenHash){
 async function rpc(name,args={}){const {data,error}=await client.rpc(name,{new_token_hash:tokenHash,...args});if(error){
  if(error.code==='40001'||error.message?.includes('ROAM_CONFLICT'))throw new AgentError('ROAM_CONFLICT','行程版本已改变，未覆盖任何修改；请重新读取并预览。');
  if(error.message?.includes('ROAM_AGENT_RATE_LIMIT'))throw new AgentError('RATE_LIMIT','请求过于频繁，请一分钟后重试。');
  if(error.message?.includes('ROAM_AGENT_READ_ONLY'))throw new AgentError('READ_ONLY','此令牌只有读取权限。');
  if(error.code==='42501')throw new AgentError('UNAUTHORIZED','令牌无效、已撤销或已过期。');
  throw new AgentError('DATABASE_ERROR','操作未完成，请检查输入或稍后重试。');
 }return data}
 return {authenticate:()=>rpc('authenticate_roam_agent'),read:()=>rpc('read_roam_agent_state'),save:(revision,payload,summary)=>rpc('save_roam_agent_state',{expected_revision:revision,new_payload:payload,change_summary:summary}),history:()=>rpc('list_roam_agent_changes'),undo:(id,revision)=>rpc('undo_roam_agent_change',{target_change_id:id,expected_revision:revision})};
}
