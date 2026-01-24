import { Router, Request, Response } from 'express';
import { query } from '../db';
import { responseCache } from '../cache';
import { DashboardCardData, DashboardCardsResponse } from '../types';

const router = Router();

// GET /api/dashboard/cards/:wallet - Get dashboard cards with metric data for a wallet
router.get('/cards/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `dashboard:cards:${walletAddress}`;
    const cached = responseCache.get<DashboardCardsResponse>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Fetch active cards
    const cards = await query<{
      id: number;
      row: string;
      card_type: string;
      title: string;
      subtitle: string | null;
      color: string;
      display_order: number;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT * FROM dashboard_cards
      WHERE is_active = true
      ORDER BY row, display_order, id
    `);

    if (cards.length === 0) {
      const emptyResponse: DashboardCardsResponse = { row3: [], row4: [] };
      responseCache.set(cacheKey, emptyResponse);
      return res.json(emptyResponse);
    }

    const cardIds = cards.map(c => c.id);

    // Fetch metrics for all cards
    const cardMetrics = await query<{
      id: number;
      card_id: number;
      metric_id: number;
      display_order: number;
      metric_slug: string;
      metric_name: string;
      metric_currency: string;
      metric_aggregation_type: string;
    }>(`
      SELECT 
        dcm.id,
        dcm.card_id,
        dcm.metric_id,
        dcm.display_order,
        am.slug as metric_slug,
        am.name as metric_name,
        am.currency as metric_currency,
        am.aggregation_type as metric_aggregation_type
      FROM dashboard_card_metrics dcm
      JOIN analytics_metrics am ON am.id = dcm.metric_id
      WHERE dcm.card_id = ANY($1)
      ORDER BY dcm.card_id, dcm.display_order
    `, [cardIds]);


    // Fetch platforms for all cards
    const cardPlatforms = await query<{
      id: number;
      card_id: number;
      platform_id: number;
      display_order: number;
      platform_slug: string;
      platform_name: string;
      platform_logo_url: string | null;
    }>(`
      SELECT 
        dcp.id,
        dcp.card_id,
        dcp.platform_id,
        dcp.display_order,
        p.slug as platform_slug,
        p.name as platform_name,
        p.logo_url as platform_logo_url
      FROM dashboard_card_platforms dcp
      JOIN platforms p ON p.id = dcp.platform_id
      WHERE dcp.card_id = ANY($1)
      ORDER BY dcp.card_id, dcp.display_order
    `, [cardIds]);

    // Get all metric IDs we need data for
    const metricIds = [...new Set(cardMetrics.map(m => m.metric_id))];

    // Fetch user analytics cache for these metrics
    const userMetrics = metricIds.length > 0 ? await query<{
      metric_id: number;
      total_count: number;
      total_usd_value: string;
      sub_aggregates: Record<string, {
        contract_address: string;
        contract_name?: string;
        count: number;
        eth_value: string;
        usd_value: string;
      }>;
    }>(`
      SELECT 
        metric_id,
        total_count,
        total_usd_value,
        sub_aggregates
      FROM user_analytics_cache
      WHERE wallet_address = $1 AND metric_id = ANY($2)
    `, [walletAddress, metricIds]) : [];

    // Create a map for quick lookup
    const metricDataMap = new Map(userMetrics.map(m => [m.metric_id, m]));

    // Get platform contracts mapping to calculate per-platform values
    const platformContracts = await query<{
      platform_id: number;
      contract_address: string;
    }>(`
      SELECT pc.platform_id, c.address as contract_address
      FROM platform_contracts pc
      JOIN contracts c ON c.id = pc.contract_id
    `);

    // Create platform -> contracts map
    const platformContractsMap = new Map<number, string[]>();
    platformContracts.forEach(pc => {
      const existing = platformContractsMap.get(pc.platform_id) || [];
      existing.push(pc.contract_address.toLowerCase());
      platformContractsMap.set(pc.platform_id, existing);
    });


    // Build response with data
    const cardsWithData: DashboardCardData[] = cards.map(card => {
      const cardMetricsList = cardMetrics.filter(m => m.card_id === card.id);
      const cardPlatformsList = cardPlatforms.filter(p => p.card_id === card.id);

      // Aggregate values from all metrics linked to this card
      let totalValue = 0;
      let totalCount = 0;

      // Track per-platform values
      const platformValues = new Map<number, { value: number; count: number }>();

      cardMetricsList.forEach(cm => {
        const metricData = metricDataMap.get(cm.metric_id);
        if (metricData) {
          totalValue += parseFloat(metricData.total_usd_value) || 0;
          totalCount += metricData.total_count || 0;

          // Calculate per-platform breakdown from sub_aggregates
          if (metricData.sub_aggregates) {
            Object.values(metricData.sub_aggregates).forEach(sub => {
              const contractAddr = sub.contract_address?.toLowerCase();
              if (contractAddr) {
                // Find which platform this contract belongs to
                cardPlatformsList.forEach(cp => {
                  const platformContractAddrs = platformContractsMap.get(cp.platform_id) || [];
                  if (platformContractAddrs.includes(contractAddr)) {
                    const existing = platformValues.get(cp.platform_id) || { value: 0, count: 0 };
                    existing.value += parseFloat(sub.usd_value) || 0;
                    existing.count += sub.count || 0;
                    platformValues.set(cp.platform_id, existing);
                  }
                });
              }
            });
          }
        }
      });

      // Build byPlatform array
      const byPlatform = cardPlatformsList.map(cp => {
        const values = platformValues.get(cp.platform_id) || { value: 0, count: 0 };
        return {
          platform: {
            id: cp.platform_id,
            name: cp.platform_name,
            logo_url: cp.platform_logo_url,
          },
          value: values.value,
          count: values.count,
        };
      }).sort((a, b) => b.value - a.value);

      return {
        id: card.id,
        row: card.row as 'row3' | 'row4',
        card_type: card.card_type as 'aggregate' | 'single',
        title: card.title,
        subtitle: card.subtitle,
        color: card.color,
        display_order: card.display_order,
        is_active: card.is_active,
        created_at: card.created_at,
        updated_at: card.updated_at,
        metrics: cardMetricsList.map(m => ({
          id: m.id,
          metric_id: m.metric_id,
          metric: {
            id: m.metric_id,
            slug: m.metric_slug,
            name: m.metric_name,
            currency: m.metric_currency,
            aggregation_type: m.metric_aggregation_type,
          },
        })),
        platforms: cardPlatformsList.map(p => ({
          id: p.id,
          platform_id: p.platform_id,
          platform: {
            id: p.platform_id,
            slug: p.platform_slug,
            name: p.platform_name,
            logo_url: p.platform_logo_url,
          },
        })),
        totalValue,
        totalCount,
        byPlatform,
      };
    });

    // Split by row
    const response: DashboardCardsResponse = {
      row3: cardsWithData.filter(c => c.row === 'row3'),
      row4: cardsWithData.filter(c => c.row === 'row4'),
    };

    responseCache.set(cacheKey, response);
    return res.json(response);
  } catch (error) {
    console.error('Failed to fetch dashboard card data:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard card data' });
  }
});

export default router;
