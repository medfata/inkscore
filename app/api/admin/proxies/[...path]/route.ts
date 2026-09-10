import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-api-auth';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || '';

async function forward(req: NextRequest, path: string[]) {
  const authError = checkAdminAuth(req);
  if (authError) return authError;

  if (!ADMIN_API_SECRET) {
    return NextResponse.json(
      { error: 'proxy admin not configured (ADMIN_API_SECRET missing)' },
      { status: 503 }
    );
  }

  const url = `${API_SERVER_URL}/api/admin/proxies/${path.map(encodeURIComponent).join('/')}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_API_SECRET,
    },
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      init.body = JSON.stringify(await req.json());
    } catch {
      init.body = undefined;
    }
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `api-server unreachable: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path || []);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path || []);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path || []);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path || []);
}
