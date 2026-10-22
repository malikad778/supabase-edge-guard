'use server';

import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/admin';

export async function deleteOrder(orderId: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('unauthorized');

  await supabaseAdmin.from('orders').delete().eq('id', orderId);
}
