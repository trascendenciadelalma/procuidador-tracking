import { createClient } from '@supabase/supabase-js';

/** Cliente de servidor: usa la service_role key (salta RLS). NUNCA se expone al navegador. */
export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
