import config from './config.mjs';
import {esc} from './core.mjs';
const $=s=>document.querySelector(s);
export async function showAgentConnections({store,modal,toast}){
 const endpoint=config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/roam-mcp';
 let secret='',closed=false;
 modal('Agent / MCP 连接',`<div class="agent-connect"><p class="help-text">让 Agent 通过 MCP 读取或修改你的行程。令牌仅访问当前账号的行程，不开放 Google Key、登录密码或收费地图 API。读写权限包含删除安排，请只交给你信任的工具。</p><label>MCP 地址<div class="agent-copy-row"><input id="agentEndpoint" readonly value="${esc(endpoint)}"><button type="button" id="copyAgentEndpoint" class="secondary">复制</button></div></label><form id="agentTokenForm"><div class="modal-section">创建连接令牌</div><label>连接名称<input name="label" value="我的 Agent" required maxlength="80" autocomplete="off"></label><div class="form-row"><label>权限<select name="scope"><option value="read">只读 · 查看和预览</option><option value="write">读写 · 可以修改和删除行程</option></select></label><label>有效期<select name="days"><option value="1">1 天</option><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option></select></label></div><button class="primary" type="submit">创建令牌</button></form><div id="issuedAgentToken" hidden><div class="modal-section">请现在复制，关闭后不再显示</div><p class="help-text">服务器只保存令牌摘要，无法找回原文。丢失后可撤销并重新创建。</p><div class="agent-copy-row"><input id="agentTokenValue" type="password" readonly autocomplete="off"><button type="button" id="copyAgentToken" class="secondary">复制令牌</button></div><button type="button" id="copyAgentConfig" class="secondary agent-config-copy">复制远程 MCP 配置</button><button type="button" id="copyAgentCodex" class="secondary agent-config-copy">复制 Codex 配置</button></div><div class="modal-section">现有连接</div><div id="agentTokenList"><p class="help-text">正在加载…</p></div><p class="help-text">命令行、stdio 和远程 MCP 的接入步骤见 <a href="https://github.com/Feivbru/roam-travel-map/blob/main/MCP.md" target="_blank" rel="noopener noreferrer">MCP 使用说明 ↗</a>。网页会自动检测 Agent 修改；有未同步草稿时保留草稿并提示冲突。</p></div>`);
 const dialog=$('#modal');
 dialog.addEventListener('close',()=>{closed=true;secret='';if($('#agentTokenValue'))$('#agentTokenValue').value='';},{once:true});
 async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制')}catch{toast('复制失败，请手动选择并复制')}}
 $('#copyAgentEndpoint').onclick=()=>copy(endpoint);
 $('#copyAgentToken').onclick=()=>copy(secret);
 $('#copyAgentConfig').onclick=()=>copy(JSON.stringify({mcpServers:{roam:{url:endpoint,headers:{Authorization:'Bearer '+secret}}}},null,2));
 $('#copyAgentCodex').onclick=()=>copy('[mcp_servers.roam]\nurl = '+JSON.stringify(endpoint)+'\nhttp_headers = { Authorization = '+JSON.stringify('Bearer '+secret)+' }\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n');
 async function refresh(){
  try{
   const tokens=await store.listAgentTokens();if(closed||!$('#agentTokenList'))return;
   $('#agentTokenList').innerHTML=tokens.length?tokens.map(t=>{
    const active=!t.revoked_at&&Date.parse(t.expires_at)>Date.now();
    return `<article class="agent-token-row"><div><b>${esc(t.label)}</b><small>${t.can_write?'读写':'只读'} · ${esc(t.token_hint)} · ${t.revoked_at?'已撤销':active?'有效至 '+new Date(t.expires_at).toLocaleDateString('zh-CN'):'已过期'}${t.last_used_at?' · 最近使用 '+new Date(t.last_used_at).toLocaleString('zh-CN'):''}</small></div>${active?`<button type="button" class="secondary" data-revoke-agent="${esc(t.id)}">撤销</button>`:''}</article>`;
   }).join(''):'<p class="help-text">还没有连接令牌。</p>';
   for(const button of $('#agentTokenList').querySelectorAll('[data-revoke-agent]'))button.onclick=async()=>{
    button.disabled=true;
    try{await store.revokeAgentToken(button.dataset.revokeAgent);secret='';if($('#agentTokenValue'))$('#agentTokenValue').value='';$('#issuedAgentToken').hidden=true;await refresh();toast('令牌已撤销，之后的请求将被拒绝。')}
    catch{button.disabled=false;toast('撤销未完成，请重试。')}
   };
  }catch{if(!closed&&$('#agentTokenList'))$('#agentTokenList').textContent='连接列表暂未读取，请重新打开重试。'}
 }
 $('#agentTokenForm').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
   const data=new FormData(form),bytes=crypto.getRandomValues(new Uint8Array(32));
   const raw='roam_'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
   await store.createAgentToken({label:data.get('label').trim(),hash,hint:'roam_…'+raw.slice(-4),write:data.get('scope')==='write',days:Number(data.get('days'))});
   if(closed)return;secret=raw;$('#agentTokenValue').value=secret;$('#issuedAgentToken').hidden=false;await refresh();toast('令牌已创建，请现在复制。');
  }catch{toast('令牌未创建，请检查网络、名称或有效连接数量（最多8个）。')}
  finally{button.disabled=false}
 };
 await refresh();
}
