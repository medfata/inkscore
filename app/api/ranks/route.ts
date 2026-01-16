import { NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function GET() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ranks`, {
      next: { revalidate: 60 }, // Cache for 1 minute
    });

    if (!response.ok) {
      throw new Error('Failed to fetch ranks');
    }

    const ranks = await response.json();
    return NextResponse.json(ranks);
  } catch (error) {
    console.error('Error fetching ranks:', error);
    return NextResponse.json([], { status: 500 });
  }
}
