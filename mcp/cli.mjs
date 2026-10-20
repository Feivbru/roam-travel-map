import fs from 'node:fs/promises';
import {connectRoam} from './client.mjs';
const [command,...args]=process.argv.slice(2);
if(!command||command==='help'){
 console.log(`Roam 命令行（先设置 ROAM_MCP_TOKEN）\n  node mcp/cli.mjs tools\n  node mcp/cli.mjs trips\n  node mcp/cli.mjs trip TRIP_ID\n  node mcp/cli.mjs day TRIP_ID DAY_ID\n  node mcp/cli.mjs history\n  node mcp/cli.mjs call TOOL_NAME --file arguments.json\n  node mcp/cli.mjs call TOOL_NAME --json '{...}'\n\n修改用 roam_apply_changes，默认 dry_run:true；显式 dry_run:false 才会保存。`);
}else{
 let client;
 try{
  let name,input={};
  if(command==='trips')name='roam_list_trips';
  else if(command==='trip'){if(!args[0])throw Error('缺少 TRIP_ID');name='roam_get_trip';input={trip_id:args[0]}}
  else if(command==='day'){if(!args[0]||!args[1])throw Error('缺少 TRIP_ID / DAY_ID');name='roam_get_day';input={trip_id:args[0],day_id:args[1]}}
  else if(command==='history')name='roam_list_changes';
  else if(command==='call'){
   name=args[0];if(!name)throw Error('缺少工具名称');
   if(args[1]==='--file'&&args[2])input=JSON.parse(await fs.readFile(args[2],'utf8'));
   else if(args[1]==='--json'&&args[2])input=JSON.parse(args[2]);
   else if(args.length>1)throw Error('参数请使用 --file 或 --json');
  }else if(command!=='tools')throw Error('未知命令，请运行 help');
  client=await connectRoam();
  if(command==='tools')console.log(JSON.stringify(await client.listTools(),null,2));
  else{
   const result=await client.callTool({name,arguments:input});
   if(result.structuredContent)console.log(JSON.stringify(result.structuredContent,null,2));
   else for(const c of result.content??[])if(c.type==='text')console.log(c.text);
   if(result.isError)process.exitCode=1;
  }
 }catch(error){console.error(String(error.message).replace(/roam_[A-Za-z0-9_-]{43}/g,'[令牌已隐藏]'));process.exitCode=1}
 finally{await client?.close()}
}
