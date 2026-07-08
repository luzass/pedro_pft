const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

module.exports = function config(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
    }),
  );
};
