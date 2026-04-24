import { NextResponse } from 'next/server';

export const runtime = 'edge';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const revalidate = 300;

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ranks`, {
      next: { revalidate: 60 }, // Cache for 1 minute
    });

    if (!response.ok) {
      throw new Error('Failed to fetch ranks');
    }

    const ranks = await response.json();
    return NextResponse.json(ranks, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch (error) {
    console.error('Error fetching ranks:', error);
    return NextResponse.json([], { status: 500 });
  }
}
