'use client';

import { createClient } from '@supabase/supabase-js';
import { adminKey } from '@/lib/leaky';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export function Uploader() {
  async function onFile(file: File) {
    await supabase.storage.from('avatars').upload(`public/${file.name}`, file);
  }
  async function onDelete(id: string) {
    await supabase.rpc('delete_account', { p_id: id });
  }
  return (
    <div>
      <input type="file" onChange={(e) => e.target.files && onFile(e.target.files[0]!)} />
      <button onClick={() => onDelete('me')}>Delete my account {adminKey ? '' : ''}</button>
    </div>
  );
}
