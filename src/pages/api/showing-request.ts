import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleShowingRequest } from '../../lib/server/showing';

export const prerender = false;

export const POST: APIRoute = ({ request }) => handleShowingRequest(request, env);

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { Allow: 'POST', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
