// Netlify serverless proxy for the official DonutSMP API.
// The API token is a secret env var (DONUT_TOKEN) and never reaches the browser.
export default async (req) => {
  const token = process.env.DONUT_TOKEN;
    const cors = {
        'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300'
                  };
                    if (!token) {
                        return new Response(JSON.stringify({ error: 'no token configured' }), { status: 500, headers: cors });
                          }
                            const url = new URL(req.url);
                              const type = url.searchParams.get('type') || 'auction/list';
                                const page = url.searchParams.get('page') || '1';
                                  const target = 'https://api.donutsmp.net/v1/' + type + '/' + page;
                                    try {
                                        const r = await fetch(target, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
                                            const body = await r.text();
                                                return new Response(body, { status: r.status, headers: cors });
                                                  } catch (e) {
                                                      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
                                                        }
                                                        };
