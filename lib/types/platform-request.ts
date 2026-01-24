export interface PlatformListingRequest {
  submitted_at: string;
  platform_name: string;
  platform_url: string;
  email: string;
  twitter_url?: string;
  telegram_url?: string;
}

export interface CreatePlatformListingRequest {
  platform_name: string;
  platform_url: string;
  email: string;
  twitter_url?: string;
  telegram_url?: string;
}
