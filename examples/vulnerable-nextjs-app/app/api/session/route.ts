import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  const { access_token, refresh_token } = await req.json();
  await supabase.auth.setSession({ access_token, refresh_token });
  const { data } = await supabase.from('profiles').select('*');
  return Response.json(data);
}
