import { NextRequest, NextResponse } from 'next/server';

const INK_CHAIN_ID = '57073';
// Use the CDN API endpoint (same as wallet-stats-service)
const ROUTESCAN_BASE_URL = 'https://cdn-canary.routescan.io/api';

interface RoutescanAddressResponse {
  address: string;
  token?: string; // 'ERC20' | 'ERC721' | 'ERC1155'
  decimals?: number;
  detail?: {
    alias?: string;
    description?: string;
    icon?: string;
    iconUrls?: {
      '32'?: string;
      '64'?: string;
      '256'?: string;
      '1024'?: string;
    };
    symbol?: string;
    social_profile?: {
      items?: Array<{
        type: string;
        value: string;
      }>;
    };
  };
  instances?: Array<{
    chainId: string;
    data?: {
      editorial?: {
        alias?: string;
        icon?: string;
        iconUrls?: {
          '32'?: string;
          '64'?: string;
          '256'?: string;
          '1024'?: string;
        };
        socialProfile?: {
          items?: Array<{
            type: string;
            value: string;
          }>;
        };
      };
      erc20?: {
        name?: string;
        symbol?: string;
        decimals?: number;
      };
    };
  }>;
}

// GET /api/admin/assets/lookup?address=0x...
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    // Fetch from Routescan API (blockchain/all/address endpoint)
    const url = `${ROUTESCAN_BASE_URL}/blockchain/all/address/${address}`;
    console.log('Fetching from Routescan:', url);
    
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Routescan API error:', response.status, await response.text());
      return NextResponse.json(
        { error: `Routescan API error: ${response.status}` },
        { status: 502 }
      );
    }

    const data: RoutescanAddressResponse = await response.json();

    // Find Ink chain instance for chain-specific data
    const inkInstance = data.instances?.find((i) => i.chainId === INK_CHAIN_ID);
    const inkData = inkInstance?.data;

    // Extract the best available data
    const name =
      inkData?.erc20?.name ||
      inkData?.editorial?.alias ||
      data.detail?.alias ||
      '';

    const symbol =
      inkData?.erc20?.symbol ||
      data.detail?.symbol ||
      '';

    const decimals =
      inkData?.erc20?.decimals ??
      data.decimals ??
      18;

    // Get best logo URL (prefer 256px)
    const iconUrls = inkData?.editorial?.iconUrls || data.detail?.iconUrls;
    const logo_url =
      iconUrls?.['256'] ||
      iconUrls?.['64'] ||
      iconUrls?.['1024'] ||
      iconUrls?.['32'] ||
      inkData?.editorial?.icon ||
      data.detail?.icon ||
      '';

    const description = data.detail?.description || '';

    // Extract social links
    const socialItems =
      inkData?.editorial?.socialProfile?.items ||
      data.detail?.social_profile?.items ||
      [];

    const twitter = socialItems.find((s) => s.type === 'twitter')?.value || '';
    const website = socialItems.find((s) => s.type === 'url')?.value || '';

    // Extract twitter handle from URL
    let twitter_handle = '';
    if (twitter) {
      const match = twitter.match(/twitter\.com\/([^\/\?]+)/i) ||
                    twitter.match(/x\.com\/([^\/\?]+)/i);
      if (match) {
        twitter_handle = match[1];
      }
    }

    // Determine if it's an NFT or token
    const tokenType = data.token; // 'ERC20' | 'ERC721' | 'ERC1155'
    const isNft = tokenType === 'ERC721' || tokenType === 'ERC1155';

    // Build response
    const result = {
      address: address.toLowerCase(),
      name,
      symbol: isNft ? null : symbol,
      decimals: isNft ? 0 : decimals,
      logo_url,
      description,
      website_url: website,
      twitter_handle,
      token_standard: tokenType || 'unknown',
      is_nft: isNft,
      // Raw data for debugging
      _raw: {
        token: data.token,
        has_ink_instance: !!inkInstance,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to lookup address:', error);
    return NextResponse.json(
      { error: 'Failed to lookup address' },
      { status: 500 }
    );
  }
}
