SUPABASE_URL="https://mbtrwknpgqjjkyimskur.supabase.co"
SUPABASE_KEY="sb_publishable_iYItJopbARCstQiORlXBlw_NbQcg1hj"
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);