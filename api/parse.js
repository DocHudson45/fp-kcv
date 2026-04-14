export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check both naming conventions for the API key in Edge Runtime
  const apiKey = process.env.GEMINI_API_KEY || process.env.REACT_APP_GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ 
        error: "GEMINI_API_KEY not configured", 
        tip: "Add GEMINI_API_KEY or REACT_APP_GEMINI_API_KEY to your Vercel project settings." 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Proxy Error", message: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}