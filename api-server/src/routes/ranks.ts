import { Router, Request, Response } from 'express';
import { query } from '../db';
import { responseCache } from '../cache';

const router = Router();

interface Rank {
  id: number;
  name: string;
  min_points: number;
  max_points: number | null;
  logo_url: string | null;
  color: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

// GET /api/ranks - Get all active ranks
router.get('/', async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'ranks:all';
    const cached = responseCache.get<Rank[]>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const ranks = await query<Rank>(`
      SELECT id, name, min_points, max_points, logo_url, color, description, display_order, is_active
      FROM ranks 
      WHERE is_active = true 
      ORDER BY min_points ASC
    `);

    // Parse numeric values (PostgreSQL may return them as strings)
    const parsedRanks = ranks.map(r => ({
      ...r,
      min_points: typeof r.min_points === 'string' ? parseInt(r.min_points, 10) : r.min_points,
      max_points: r.max_points === null ? null : (typeof r.max_points === 'string' ? parseInt(r.max_points, 10) : r.max_points),
    }));

    responseCache.set(cacheKey, parsedRanks);
    return res.json(parsedRanks);
  } catch (error) {
    console.error('Error fetching ranks:', error);
    return res.status(500).json({ error: 'Failed to fetch ranks' });
  }
});

export default router;
