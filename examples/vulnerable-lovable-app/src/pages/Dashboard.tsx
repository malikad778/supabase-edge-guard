import { supabase } from '../integrations/supabase/client';

export default function Dashboard() {
  supabase.from('todos').select('*');
  return <div>Dashboard</div>;
}
