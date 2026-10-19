import {createClient} from '@supabase/supabase-js';
import config from './config.mjs';
import {createCloudStore} from './cloud-store.mjs';
const $=s=>document.querySelector(s);
let client,currentUser=null,readyResolve,mode='login',isRecovery=new URL(location.href).searchParams.has('recovery'),hasStarted=false;
const ready=new Promise(resolve=>readyResolve=resolve);
export let cloudStore;
export const cloudUser=()=>currentUser;
function message(text,isError=false){$('#authMessage').textContent=text;$('#authMessage').classList.toggle('is-error',isError);}
function translate(error){
 const text=error?.message??String(error);
 if(/invalid login credentials/i.test(text))return '邮箱或密码不正确。';
 if(/email not confirmed/i.test(text))return '请先点击注册邮件中的验证链接。';
 if(/rate limit|too many requests/i.test(text))return '操作太频繁，请稍后重试。';
 if(/user already registered/i.test(text))return '这个邮箱已注册，请直接登录或重置密码。';
 if(/fetch|network/i.test(text))return '网络连接失败，请检查连接后重试。';
 return text;
}
function setMode(next){
 mode=next;
 $('#authHeading').textContent=next==='register'?'开启新的旅程':next==='reset'?'找回你的账户':next==='password'?'设置新密码':'欢迎回来';
 $('#authSubtitle').textContent=next==='register'?'注册后，行程会保存在你的私人云端空间。':next==='reset'?'我们会向你的邮箱发送重置链接。':next==='password'?'为你的账户设置一个新的密码。':'登录，在每一台设备上接着规划。';
 $('#authPasswordLabel').hidden=next==='reset';$('#authEmailLabel').hidden=next==='password';
 $('#authPassword').required=next!=='reset';$('#authEmail').required=next!=='password';
 $('#authPassword').autocomplete=next==='login'?'current-password':'new-password';$('#authPassword').minLength=next==='login'?1:8;
 $('#authSubmit').textContent=next==='register'?'创建账户':next==='reset'?'发送重置邮件':next==='password'?'保存新密码':'登录';
 $('#authRegister').hidden=next==='register'||next==='password';$('#authLogin').hidden=next==='login'||next==='password';$('#authForgot').hidden=next!=='login';
 $('#authNameLabel').hidden=next!=='register';message('');
}
function showUser(user){
 currentUser=user;cloudStore=createCloudStore(client,user.id);
 $('#accountName').textContent=user.user_metadata?.display_name||user.email||'我的账户';
 document.body.classList.remove('cloud-locked');$('#authScreen').hidden=true;
 if(!hasStarted){hasStarted=true;readyResolve(user)}
}
function onSession(event,session){
 if(event==='PASSWORD_RECOVERY'){isRecovery=true;setMode('password');document.body.classList.add('cloud-locked');$('#authScreen').hidden=false;return;}
 if(session?.user&&!isRecovery){
  if(hasStarted&&currentUser?.id!==session.user.id){location.reload();return}
  if(!hasStarted)showUser(session.user);
 }else if(event==='SIGNED_OUT'&&hasStarted){location.reload()}
}
export async function initializeCloudAuth(){
 $('#authRegister').onclick=()=>setMode('register');$('#authLogin').onclick=()=>setMode('login');$('#authForgot').onclick=()=>setMode('reset');
 $('#logoutBtn').onclick=async()=>{
  if(!confirm('退出登录？尚未同步的修改会保留在当前设备，建议先确认保存状态。'))return;
  const {error}=await client.auth.signOut({scope:'local'});if(error){alert(translate(error));return}location.reload();
 };
 if(!config.supabaseUrl||!config.supabasePublishableKey){message('在线版正在配置数据库，连接完成后即可注册和登录。');$('#authSubmit').disabled=true;return ready;}
 // Supabase refreshes sessions; database policies still authorize every request.
 client=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 client.auth.onAuthStateChange((event,session)=>queueMicrotask(()=>onSession(event,session)));
 $('#authForm').onsubmit=async event=>{
  event.preventDefault();const button=$('#authSubmit');button.disabled=true;message('正在处理…');
  try{
   const email=$('#authEmail').value.trim(),password=$('#authPassword').value,redirectTo=new URL('./',location.href).href;
   let result;
   if(mode==='register')result=await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo,data:{display_name:$('#authName').value.trim().slice(0,80)}}});
   else if(mode==='reset'){result=await client.auth.resetPasswordForEmail(email,{redirectTo:redirectTo+'?recovery=1'});if(!result.error)message('如果这个邮箱已注册，会收到重置邮件。请查看收件箱和垃圾邮件。');}
   else if(mode==='password'){result=await client.auth.updateUser({password});if(!result.error){isRecovery=false;location.replace(redirectTo);return;}}
   else result=await client.auth.signInWithPassword({email,password});
   if(result.error)throw result.error;
   $('#authPassword').value='';
   if(mode==='register'&&!result.data?.session)message('注册申请已提交，请在邮箱中确认后登录。');
  }catch(error){message(translate(error),true)}finally{button.disabled=false}
 };
 const {data,error}=await client.auth.getSession();
 if(error)message(translate(error),true);
 if(new URL(location.href).searchParams.has('recovery')){isRecovery=true;setMode('password');if(!data.session)message('请从重置邮件的链接打开此页。',true);}
 else if(data.session?.user&&!isRecovery)showUser(data.session.user);
 return ready;
}
