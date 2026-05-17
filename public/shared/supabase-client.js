const SUPABASE_URL = "https://qvowjtswizirfxwiwxnw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2b3dqdHN3aXppcmZ4d2l3eG53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwOTQ0NjcsImV4cCI6MjA5MTY3MDQ2N30.9ELJamNBkUB-u8JLAyvWFwX0Aawa6dSCp5qre2Z6V5I";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);