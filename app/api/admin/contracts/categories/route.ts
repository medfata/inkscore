import { NextResponse } from 'next/server';
import { contractsService } from '@/lib/services/contracts-service';

// GET /api/admin/contracts/categories - Get all categories
export async function GET() {
  try {
    const categories = await contractsService.getCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
