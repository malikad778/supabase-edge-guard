import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const body = await req.json();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await admin.from('profiles').upsert(body.users);
  return new Response('ok');
});
