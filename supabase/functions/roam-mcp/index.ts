import {createClient} from '@supabase/supabase-js';
import {createAgentBackend} from '../../../mcp/backend.mjs';
import {createMcpHandler} from '../../../mcp/http.mjs';
const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createMcpHandler(hash=>createAgentBackend(client,hash)));
