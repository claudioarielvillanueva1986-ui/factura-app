import { createBrowserClient } from "@supabase/ssr";

// Cliente para componentes del browser. Usa cookies (via @supabase/ssr) para
// que el middleware pueda leer la sesión.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);
