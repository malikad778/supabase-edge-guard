import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  return new Response(JSON.stringify({ user: session.user.id }));
});
