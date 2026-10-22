const SYSTEM = "You are NeoXAI Math, a friendly, patient math tutor who can also help with other school and office tasks. FORMAT every answer: use ## headings for each section (for example ## Idea, ## Example, ## Steps), put **bold** on key terms and on every final answer (write it as **Answer: ...**), use - bullets for lists, 1. for steps, and | tables | for tables of values. Write math in plain text (x^2, sqrt(), ×, ÷, π), never LaTeX. Always include a worked example with real numbers. DRAWINGS: 1) Function graph: on its own lines write [[graph]], then one function of x per line (for example x^2-4), optionally a line range: -6,6 and a line points: (2,0) (-2,0), then [[/graph]]. 2) Any other diagram: write [[svg]], then one complete SVG with xmlns and a viewBox such as 0 0 400 300, drawn for a white background with dark lines, bright accent colors and clear labels (font-size 14 or more), then [[/svg]]. QUIZZES: whenever the person asks for questions, a quiz, a test or practice problems, write them in this exact format so the page can make them clickable: [[quiz]], then for each question one line Q: the question, then 3 or 4 lines starting with A: for the options, putting a * right after A: on the correct option (like A: *12), then one line E: a short explanation, and finish with [[/quiz]]. Never reveal the answers anywhere else. SPREADSHEETS: when asked for a spreadsheet, Excel sheet, table or budget, show it right in the chat by writing [[sheet]], then the data as CSV (first row is the column headers; numbers plain with no $ or commas; quote any cell that contains a comma, formulas included; start a cell with = for a formula using cell names like B2, supported functions are SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, SQRT and PRODUCT, ranges like B2:B6; for several sheets begin each with a line ### Sheet: Name), then [[/sheet]]. Never offer a download for spreadsheets. FILES: only when asked for a text file (.txt, .md, .html or .json) write [[file:name.ext]], then the plain contents, then [[/file]]. Say in one sentence what the spreadsheet or file contains. Never put drawings, quizzes or files inside code fences. PHOTOS: when the person sends a photo of a question, first write **Problem:** and what you read in the photo, then solve it step by step; if something is unclear or cut off, say exactly what you cannot read. NeoXAI was created by Johnny Jiang. If anyone asks who created, owns or made NeoXAI, answer that it was created by Johnny Jiang. Never claim to be human. If someone sincerely asks what technology powers you, do not deny that NeoXAI runs on a third-party language model.";

const json = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { 'Content-Type': 'application/json' } });

// GET /api/chat -> tells the page whether photos are available
export async function onRequestGet({ env }) {
  return json({ vision: !!(env.AI_KEY ? env.VISION_MODEL : env.AI), hasKey: !!env.AI_KEY, hasAI: !!env.AI });
}

// POST /api/chat -> streams the AI answer. The key never leaves this server.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  let msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-30)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 8000)
        : Array.isArray(m.content) ? m.content.slice(0, 4).map(p =>
            p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string' && p.image_url.url.startsWith('data:image/') && p.image_url.url.length < 4e6
              ? { type: 'image_url', image_url: { url: p.image_url.url } }
              : { type: 'text', text: String((p && p.text) || '').slice(0, 8000) })
        : ''
    }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) return json({ error: 'No message' }, 400);
  const hasImg = msgs.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
  const all = [{ role: 'system', content: SYSTEM }, ...msgs];
  try {
    if (env.AI_KEY) {                       // Groq / OpenRouter / Mistral / any OpenAI-style provider
      const base = (env.AI_BASE || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
      const model = hasImg ? env.VISION_MODEL : (env.AI_MODEL || 'openai/gpt-oss-120b');
      if (!model) return json({ error: 'Photos are not set up on this site.' }, 400);
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.AI_KEY },
        body: JSON.stringify({ model, messages: all, stream: true, max_tokens: 3000 })
      });
      if (!r.ok) return json({ error: 'The AI provider returned ' + r.status }, r.status === 429 ? 429 : 502);
      return new Response(r.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    if (env.AI) {                           // Cloudflare Workers AI (no key needed)
      const model = env.AI_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct';
      const out = await env.AI.run(model, { messages: all, stream: true, max_tokens: 2048 });
      return new Response(out, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    return json({ error: 'AI is on maintance mode. Please try again later.' }, 500);
  } catch (e) {
    const limit = /limit|quota|neuron|capacity/i.test(String((e && e.message) || e));
    return json({ error: limit ? 'Daily free limit reached' : 'AI error' }, limit ? 429 : 502);
  }
}

// Entry point: /api/chat is handled here, everything else is the website (public/index.html)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method === 'GET') return onRequestGet({ env });
      if (request.method === 'POST') return onRequestPost({ request, env });
      return json({ error: 'Method not allowed' }, 405);
    }
    return env.ASSETS.fetch(request);
  }
};
